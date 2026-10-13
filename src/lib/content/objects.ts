/**
 * Page content as a list of independent objects.
 *
 * The interpreter walks a content stream with a full graphics state and cuts
 * it into objects: a text line, a painted path, an image, a form XObject or a
 * shading. Each object records the complete state it was painted with (CTM,
 * clipping paths, graphics state parameters, colours, marked content), so it
 * can be written back on its own inside q … Q, then moved, restyled,
 * reordered or deleted without affecting the others.
 */
import { IDENTITY, apply, inv, isIdentity, maxScale, mul, translate, type M } from './matrix';
import { isName, isStr, name as nm, num, str, type Op, type Operand } from './syntax';
import type { FontInfo } from './fonts';
import type { Rect } from '../types';

export type ParamSrc = { op: Op } | { gs: string; seq: number };

export interface Clip {
  ctm: M;
  ops: Op[];
  rule: 'W' | 'W*';
}

export interface GState {
  ctm: M;
  clips: Clip[];
  /** Graphics-state parameters and which operator last set them. */
  params: Record<string, ParamSrc>;
  fill: Op[];
  stroke: Op[];
  font?: string;
  size: number;
  Tc: number;
  Tw: number;
  Tz: number;
  TL: number;
  Ts: number;
  Tr: number;
  lineWidth: number;
}

export interface TextRun {
  font: string;
  size: number;
  /** Text matrix at the start of the run. */
  tm: M;
  Tc: number;
  Tw: number;
  Tz: number;
  Ts: number;
  Tr: number;
  /** A Tj or TJ operator. */
  show: Op;
  text: string;
  /** Advance in text space. */
  advance: number;
}

export type ObjectKind = 'text' | 'path' | 'image' | 'form' | 'shading';

export interface ContentObject {
  kind: ObjectKind;
  state: GState;
  /** Open marked-content operators (BMC/BDC) around the object. */
  mc: Op[];
  /** Painting operators (path construction + paint, Do, BI or sh). */
  ops: Op[];
  runs: TextRun[];
  /** Transform applied by editing, in user space (applied last). */
  user: M;
  /** Bounding box in user space, before `user`. */
  bbox: Rect;
}

export interface Resources {
  font(key: string): FontInfo | undefined;
  xobject(key: string): { subtype: 'Image' | 'Form' | 'Other'; bbox?: number[]; matrix?: M } | undefined;
  /** Parameters an ExtGState sets, with numeric values where known. */
  extGState(key: string): Map<string, number | undefined>;
}

const GS_KEYS: Record<string, string> = { LW: 'w', LC: 'J', LJ: 'j', ML: 'M', D: 'd', RI: 'ri', FL: 'i', Font: 'Tf' };
const PARAM_OPS = new Set(['w', 'J', 'j', 'M', 'd', 'ri', 'i']);
const PATH_OPS = new Set(['m', 'l', 'c', 'v', 'y', 're', 'h']);
const PAINT_OPS = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n']);
const STROKING = new Set(['S', 's', 'B', 'B*', 'b', 'b*']);

export function initialState(): GState {
  return { ctm: IDENTITY, clips: [], params: {}, fill: [], stroke: [], size: 0, Tc: 0, Tw: 0, Tz: 100, TL: 0, Ts: 0, Tr: 0, lineWidth: 1 };
}

const nums = (args: Operand[]) => args.map((a) => num(a));
const asM = (args: Operand[]): M => nums(args).slice(0, 6) as M;

// ---------------------------------------------------------------- bounds

function boundsOf(pts: { x: number; y: number }[]): Rect {
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const quad = (m: M, x0: number, y0: number, x1: number, y1: number) => [apply(m, x0, y0), apply(m, x1, y0), apply(m, x1, y1), apply(m, x0, y1)];

function pathPoints(ops: Op[]): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (const o of ops) {
    const a = nums(o.args);
    if (o.op === 're') pts.push({ x: a[0], y: a[1] }, { x: a[0] + a[2], y: a[1] + a[3] });
    else for (let i = 0; i + 1 < a.length; i += 2) pts.push({ x: a[i], y: a[i + 1] });
  }
  return pts;
}

export function runBounds(r: TextRun, ctm: M, font?: FontInfo): Rect {
  const m = mul(r.tm, ctm);
  const asc = font?.ascent ?? 0.75;
  const desc = font?.descent ?? -0.25;
  return boundsOf(quad(m, 0, r.Ts + desc * r.size, r.advance || r.size * 0.3, r.Ts + asc * r.size));
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Bounding box of an object as displayed (including its edit transform). */
export function objectBounds(o: ContentObject): Rect {
  if (isIdentity(o.user)) return o.bbox;
  const b = o.bbox;
  return boundsOf(quad(o.user, b.x, b.y, b.x + b.w, b.y + b.h));
}

// ---------------------------------------------------------------- text measuring

/** Measure a show operator: its text and advance in text space. */
export function measureShow(show: Op, font: FontInfo | undefined, st: { size: number; Tc: number; Tw: number; Tz: number }): { text: string; advance: number } {
  const th = st.Tz / 100;
  let text = '';
  let adv = 0;
  const glyphs = (s: Operand) => {
    if (!isStr(s)) return;
    const codes = font ? font.codes(s.bytes) : Array.from(s.bytes, (code) => ({ code, len: 1 }));
    for (const { code, len } of codes) {
      font?.used.add(code);
      const w0 = font ? font.width(code) : 0.5;
      adv += (w0 * st.size + st.Tc + (len === 1 && code === 32 ? st.Tw : 0)) * th;
      text += font ? font.unicode(code) : String.fromCharCode(code);
    }
  };
  if (show.op === 'TJ') {
    for (const item of (show.args[0] as Operand[]) ?? []) {
      if (typeof item === 'number') {
        adv -= (item / 1000) * st.size * th;
        // A large negative adjustment is a visual space.
        if (item < -180 && text && !text.endsWith(' ')) text += ' ';
      } else glyphs(item);
    }
  } else glyphs(show.args[0]);
  return { text, advance: adv };
}

// ---------------------------------------------------------------- interpreter

export interface ParseResult {
  objects: ContentObject[];
  /** Operators the interpreter did not understand (the page may not round-trip exactly). */
  unknown: string[];
}

export function interpret(ops: Op[], res: Resources, pageBox: Rect): ParseResult {
  let gs = initialState();
  const stack: GState[] = [];
  let mc: Op[] = [];
  const objects: ContentObject[] = [];
  const unknown: string[] = [];
  let path: Op[] = [];
  let pendingClip: 'W' | 'W*' | null = null;
  let seq = 0;
  // text
  let tm: M = IDENTITY;
  let tlm: M = IDENTITY;
  let line: (ContentObject & { end: { x: number; y: number }; dir: { x: number; y: number }; unit: number }) | null = null;

  const set = (patch: Partial<GState>) => (gs = { ...gs, ...patch });
  const setParam = (k: string, src: ParamSrc) => set({ params: { ...gs.params, [k]: src } });
  const snapshot = (): GState => gs;
  const emit = (kind: ObjectKind, opsOut: Op[], bbox: Rect) => objects.push({ kind, state: snapshot(), mc, ops: opsOut, runs: [], user: IDENTITY, bbox });

  const endLine = () => {
    if (line) {
      const { end: _e, dir: _d, unit: _u, ...obj } = line;
      objects.push(obj);
    }
    line = null;
  };

  const show = (op: Op) => {
    const font = gs.font ? res.font(gs.font) : undefined;
    const { text, advance } = measureShow(op, font, gs);
    const run: TextRun = { font: gs.font ?? '', size: gs.size, tm, Tc: gs.Tc, Tw: gs.Tw, Tz: gs.Tz, Ts: gs.Ts, Tr: gs.Tr, show: op, text, advance };
    const m = mul(tm, gs.ctm);
    const origin = apply(m, 0, 0);
    const ax = apply(m, 1, 0);
    const len = Math.hypot(ax.x - origin.x, ax.y - origin.y) || 1;
    const dir = { x: (ax.x - origin.x) / len, y: (ax.y - origin.y) / len };
    const sizeUser = gs.size * maxScale(m);
    const bbox = runBounds(run, gs.ctm, font);
    let joined = false;
    if (line && line.state.ctm === gs.ctm && line.state.params === gs.params && line.state.fill === gs.fill && line.state.stroke === gs.stroke && line.state.clips === gs.clips && line.mc === mc) {
      const dx = origin.x - line.end.x;
      const dy = origin.y - line.end.y;
      const along = dx * line.dir.x + dy * line.dir.y;
      const across = Math.abs(-dx * line.dir.y + dy * line.dir.x);
      const sameDir = Math.abs(dir.x - line.dir.x) < 0.01 && Math.abs(dir.y - line.dir.y) < 0.01;
      if (sameDir && across < 0.35 * Math.max(sizeUser, line.unit) && along > -0.6 * sizeUser && along < 3 * Math.max(sizeUser, line.unit)) {
        line.runs.push(run);
        line.bbox = union(line.bbox, bbox);
        joined = true;
      }
    }
    if (!joined) {
      endLine();
      line = { kind: 'text', state: snapshot(), mc, ops: [], runs: [run], user: IDENTITY, bbox, end: origin, dir, unit: sizeUser };
    }
    tm = mul(translate(advance, 0), tm);
    line!.end = apply(mul(tm, gs.ctm), 0, 0);
  };

  for (const op of ops) {
    const a = op.args;
    switch (op.op) {
      case 'q':
        stack.push(gs);
        break;
      case 'Q':
        endLine();
        gs = stack.pop() ?? gs;
        break;
      case 'cm':
        endLine();
        set({ ctm: mul(asM(a), gs.ctm) });
        break;
      case 'w':
        setParam('w', { op });
        set({ lineWidth: num(a[0], 1) });
        break;
      case 'J': case 'j': case 'M': case 'd': case 'ri': case 'i':
        setParam(op.op, { op });
        break;
      case 'gs': {
        const key = isName(a[0]) ? a[0].v : '';
        const keys = res.extGState(key);
        seq++;
        const params = { ...gs.params };
        keys.forEach((v, k) => {
          params[GS_KEYS[k] ?? `gs:${k}`] = { gs: key, seq };
          if (k === 'LW' && v !== undefined) gs = { ...gs, lineWidth: v };
        });
        set({ params });
        break;
      }
      case 'g': case 'rg': case 'k': case 'cs':
        set({ fill: [op] });
        break;
      case 'sc': case 'scn':
        set({ fill: gs.fill[0]?.op === 'cs' ? [gs.fill[0], op] : [op] });
        break;
      case 'G': case 'RG': case 'K': case 'CS':
        set({ stroke: [op] });
        break;
      case 'SC': case 'SCN':
        set({ stroke: gs.stroke[0]?.op === 'CS' ? [gs.stroke[0], op] : [op] });
        break;
      case 'W': case 'W*':
        pendingClip = op.op;
        break;
      case 'BT':
        tm = tlm = IDENTITY;
        break;
      case 'ET':
        endLine();
        break;
      case 'Tc': set({ Tc: num(a[0]) }); break;
      case 'Tw': set({ Tw: num(a[0]) }); break;
      case 'Tz': set({ Tz: num(a[0], 100) }); break;
      case 'TL': set({ TL: num(a[0]) }); break;
      case 'Ts': set({ Ts: num(a[0]) }); break;
      case 'Tr': set({ Tr: num(a[0]) }); break;
      case 'Tf':
        set({ font: isName(a[0]) ? a[0].v : undefined, size: num(a[1]) });
        break;
      case 'Td':
        tlm = tm = mul(translate(num(a[0]), num(a[1])), tlm);
        break;
      case 'TD':
        set({ TL: -num(a[1]) });
        tlm = tm = mul(translate(num(a[0]), num(a[1])), tlm);
        break;
      case 'Tm':
        tlm = tm = asM(a);
        break;
      case 'T*':
        tlm = tm = mul(translate(0, -gs.TL), tlm);
        break;
      case 'Tj': case 'TJ':
        show(op);
        break;
      case "'":
        tlm = tm = mul(translate(0, -gs.TL), tlm);
        show({ op: 'Tj', args: [a[0]] });
        break;
      case '"':
        set({ Tw: num(a[0]), Tc: num(a[1]) });
        tlm = tm = mul(translate(0, -gs.TL), tlm);
        show({ op: 'Tj', args: [a[2]] });
        break;
      case 'Do': {
        endLine();
        const key = isName(a[0]) ? a[0].v : '';
        const x = res.xobject(key);
        if (x?.subtype === 'Form') {
          const b = x.bbox ?? [0, 0, 1, 1];
          const m = mul(x.matrix ?? IDENTITY, gs.ctm);
          emit('form', [op], boundsOf(quad(m, b[0], b[1], b[2], b[3])));
        } else {
          emit(x?.subtype === 'Image' ? 'image' : 'form', [op], boundsOf(quad(gs.ctm, 0, 0, 1, 1)));
        }
        break;
      }
      case 'BI':
        endLine();
        emit('image', [op], boundsOf(quad(gs.ctm, 0, 0, 1, 1)));
        break;
      case 'sh': {
        endLine();
        const clipBox = gs.clips.length
          ? gs.clips.map((c) => boundsOf(pathPoints(c.ops).map((p) => apply(c.ctm, p.x, p.y)))).reduce((x, y) => intersect(x, y))
          : pageBox;
        emit('shading', [op], clipBox);
        break;
      }
      case 'BMC': case 'BDC':
        endLine();
        mc = [...mc, op];
        break;
      case 'EMC':
        endLine();
        mc = mc.slice(0, -1);
        break;
      case 'MP': case 'DP': case 'BX': case 'EX': case 'd0': case 'd1':
        break;
      default:
        if (PATH_OPS.has(op.op)) {
          path.push(op);
          break;
        }
        if (PAINT_OPS.has(op.op)) {
          endLine();
          if (op.op !== 'n') {
            let bbox = boundsOf(pathPoints(path).map((p) => apply(gs.ctm, p.x, p.y)));
            if (STROKING.has(op.op)) {
              const pad = (gs.lineWidth * maxScale(gs.ctm)) / 2;
              bbox = { x: bbox.x - pad, y: bbox.y - pad, w: bbox.w + 2 * pad, h: bbox.h + 2 * pad };
            }
            emit('path', [...path, op], bbox);
          }
          if (pendingClip) set({ clips: [...gs.clips, { ctm: gs.ctm, ops: path, rule: pendingClip }] });
          path = [];
          pendingClip = null;
          break;
        }
        unknown.push(op.op);
    }
  }
  endLine();
  return { objects, unknown };
}

function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}

// ---------------------------------------------------------------- writing

const cmOp = (m: M): Op => ({ op: 'cm', args: [...m] });

/** Write an object back as a self-contained block of operators. */
export function emitObject(o: ContentObject): Op[] {
  const out: Op[] = [...o.mc, { op: 'q', args: [] }];
  if (!isIdentity(o.user)) out.push(cmOp(o.user));
  let cur: M = IDENTITY;
  for (const c of o.state.clips) {
    const iv = inv(cur);
    if (!iv) continue;
    const d = mul(c.ctm, iv);
    if (!isIdentity(d)) out.push(cmOp(d));
    out.push(...c.ops, { op: c.rule, args: [] }, { op: 'n', args: [] });
    cur = c.ctm;
  }
  const iv = inv(cur);
  const d = iv ? mul(o.state.ctm, iv) : o.state.ctm;
  if (!isIdentity(d)) out.push(cmOp(d));

  // Graphics state: ExtGStates still in effect (in their original order), then direct operators.
  const srcs = Object.values(o.state.params);
  const gsUsed = [...new Map(srcs.filter((s): s is { gs: string; seq: number } => 'gs' in s).map((s) => [s.seq, s.gs])).entries()].sort((x, y) => x[0] - y[0]);
  for (const [, g] of gsUsed) out.push({ op: 'gs', args: [nm(g)] });
  for (const [k, s] of Object.entries(o.state.params)) if ('op' in s && PARAM_OPS.has(k)) out.push(s.op);
  out.push(...o.state.fill, ...o.state.stroke);

  if (o.kind === 'text') {
    out.push({ op: 'BT', args: [] });
    let prev = { font: '', size: NaN, Tc: 0, Tw: 0, Tz: 100, Ts: 0, Tr: 0 };
    for (const r of o.runs) {
      if (r.font !== prev.font || r.size !== prev.size) out.push({ op: 'Tf', args: [nm(r.font), r.size] });
      for (const k of ['Tc', 'Tw', 'Tz', 'Ts', 'Tr'] as const) if (r[k] !== prev[k]) out.push({ op: k, args: [r[k]] });
      out.push({ op: 'Tm', args: [...r.tm] }, r.show);
      prev = r;
    }
    out.push({ op: 'ET', args: [] });
  } else {
    out.push(...o.ops);
  }
  out.push({ op: 'Q', args: [] });
  for (let i = 0; i < o.mc.length; i++) out.push({ op: 'EMC', args: [] });
  return out;
}

export function emitObjects(objs: ContentObject[]): Op[] {
  return objs.flatMap(emitObject);
}

/** Make a Tj operator from raw codes. */
export const tj = (codes: Uint8Array): Op => ({ op: 'Tj', args: [str(codes, true)] });
