/**
 * Reading a page's content as objects, editing them and writing the page back.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFRawStream,
  PDFStream,
  StandardFonts,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';
import { readFont, type FontInfo } from './fonts';
import { emitObjects, initialState, interpret, measureShow, objectBounds, tj, type ContentObject, type GState, type TextRun } from './objects';
import { IDENTITY, maxScale, mul, translate, type M } from './matrix';
import { name as nm, parseContent, writeContent, type Op } from './syntax';
import { hexToRgbTuple } from '../color';
import type { Rect } from '../types';

// ---------------------------------------------------------------- reading

function bytesOf(s: unknown): Uint8Array {
  if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
  // Streams created in memory (e.g. by drawText) hold their unencoded operators.
  const unencoded = (s as { getUnencodedContents?: () => Uint8Array }).getUnencodedContents;
  if (s instanceof PDFStream && unencoded) return unencoded.call(s);
  if (s instanceof PDFStream) return s.getContents();
  return new Uint8Array(0);
}

function contentBytes(page: PDFPage): Uint8Array {
  const c = page.node.Contents();
  const parts: Uint8Array[] = [];
  if (c instanceof PDFArray) for (const r of c.asArray()) parts.push(bytesOf(page.doc.context.lookup(r)), new Uint8Array([10]));
  else if (c) parts.push(bytesOf(c));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function resourcesOf(page: PDFPage): PDFDict | undefined {
  return page.node.Resources() ?? (page.node.getInheritableAttribute(PDFName.of('Resources')) as PDFDict | undefined);
}

const n = (o: unknown): number | undefined => (o instanceof PDFNumber ? o.asNumber() : undefined);

export interface PageContent {
  objects: ContentObject[];
  fonts: Map<string, FontInfo>;
  /** Operators that were not understood. */
  unknown: string[];
}

export function readPage(page: PDFPage): PageContent {
  const res = resourcesOf(page);
  const sub = (k: string) => res?.lookup(PDFName.of(k));
  const fonts = new Map<string, FontInfo>();
  const fontDict = sub('Font');
  const xobjDict = sub('XObject');
  const gsDict = sub('ExtGState');
  const mb = page.getMediaBox();
  const { objects, unknown } = interpret(
    parseContent(contentBytes(page)),
    {
      font(key) {
        if (!fonts.has(key)) {
          const d = fontDict instanceof PDFDict ? fontDict.lookup(PDFName.of(key)) : undefined;
          if (d instanceof PDFDict) fonts.set(key, readFont(key, d));
        }
        return fonts.get(key);
      },
      xobject(key) {
        const x = xobjDict instanceof PDFDict ? xobjDict.lookup(PDFName.of(key)) : undefined;
        const dict = x instanceof PDFStream ? x.dict : undefined;
        if (!dict) return undefined;
        const st = dict.lookup(PDFName.of('Subtype'))?.toString();
        const arr = (k: string) => {
          const a = dict.lookup(PDFName.of(k));
          return a instanceof PDFArray ? a.asArray().map((v) => n(dict.context.lookup(v)) ?? 0) : undefined;
        };
        return { subtype: st === '/Image' ? 'Image' : st === '/Form' ? 'Form' : 'Other', bbox: arr('BBox'), matrix: arr('Matrix') as M | undefined };
      },
      extGState(key) {
        const g = gsDict instanceof PDFDict ? gsDict.lookup(PDFName.of(key)) : undefined;
        const out = new Map<string, number | undefined>();
        if (g instanceof PDFDict) for (const [k, v] of g.entries()) if (k.toString() !== '/Type') out.set(k.toString().slice(1), n(v));
        return out;
      },
    },
    { x: mb.x, y: mb.y, w: mb.width, h: mb.height },
  );
  return { objects, fonts, unknown };
}

export function writePage(page: PDFPage, objects: ContentObject[]) {
  const bytes = writeContent(emitObjects(objects));
  page.node.set(PDFName.of('Contents'), page.doc.context.register(page.doc.context.flateStream(bytes)));
}

// ---------------------------------------------------------------- edits

export type FontChoice = 'original' | 'NotoSans' | 'NotoSans-Bold' | 'Helvetica' | 'Helvetica-Bold' | 'Times-Roman' | 'Times-Bold' | 'Courier';

export interface ImageData {
  bytes: Uint8Array;
  png: boolean;
}

export type ContentEdit =
  | { type: 'transform'; ids: number[]; m: M }
  | { type: 'delete'; ids: number[] }
  | { type: 'arrange'; ids: number[]; to: 'front' | 'back' | 'forward' | 'backward' }
  | { type: 'duplicate'; ids: number[]; dx: number; dy: number }
  | { type: 'removeClip'; ids: number[] }
  | { type: 'fill'; ids: number[]; color: string | null }
  | { type: 'stroke'; ids: number[]; color: string | null; width?: number }
  | { type: 'text'; id: number; text: string }
  | { type: 'textStyle'; ids: number[]; size?: number; font?: FontChoice; Tc?: number; Tw?: number; Tz?: number; Ts?: number }
  | { type: 'replaceImage'; id: number; image: ImageData }
  | { type: 'addText'; at: { x: number; y: number }; text: string; size: number; color: string; font: FontChoice }
  | { type: 'addImage'; rect: Rect; image: ImageData }
  | { type: 'addShape'; shape: 'rect' | 'ellipse' | 'line'; rect: Rect; stroke: string | null; fill: string | null; width: number };

const rgb = (hex: string, op: 'rg' | 'RG'): Op => ({ op, args: [...hexToRgbTuple(hex)] });

/** Text drawing helpers with lazily embedded fonts. */
class TextWriter {
  private std = new Map<string, PDFFont>();
  private keys = new Map<PDFFont, string>();
  constructor(private page: PDFPage, private fonts: Map<string, FontInfo>) {}

  private keyFor(font: PDFFont): string {
    let k = this.keys.get(font);
    if (!k) {
      k = this.page.node.newFontDictionary('F', font.ref).toString().slice(1);
      this.keys.set(font, k);
    }
    return k;
  }

  /** Runs that draw `text` at text matrix `tm`, copying the style of `base`. */
  async runs(text: string, base: Omit<TextRun, 'show' | 'text' | 'advance' | 'tm'>, tm: M, choice: FontChoice): Promise<TextRun[]> {
    if (choice === 'original') {
      const f = this.fonts.get(base.font);
      const codes = f?.encode(text);
      if (f && codes) {
        const show = tj(codes);
        const { advance } = measureShow(show, f, base);
        return [{ ...base, tm, show, text, advance }];
      }
      // The original font lacks some characters: fall back to Noto Sans.
      choice = 'NotoSans';
    }
    const doc = this.page.doc;
    let pieces: { font: PDFFont; text: string }[];
    if (choice === 'NotoSans' || choice === 'NotoSans-Bold') {
      const { createTextEngine } = await import('../fonts');
      pieces = (await createTextEngine(doc, [text], choice === 'NotoSans-Bold' ? 'bold' : 'regular')).runs(text);
    } else {
      let f = this.std.get(choice);
      if (!f) this.std.set(choice, (f = doc.embedStandardFont(choice as StandardFonts)));
      const supported = new Set(f.getCharacterSet());
      pieces = [{ font: f, text: [...text].map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : '?')).join('') }];
    }
    const out: TextRun[] = [];
    let x = 0;
    for (const p of pieces) {
      if (!p.text) continue;
      const show = tj(p.font.encodeText(p.text).asBytes());
      const advance = (p.font.widthOfTextAtSize(p.text, base.size) + base.Tc * [...p.text].length) * (base.Tz / 100);
      out.push({ ...base, font: this.keyFor(p.font), tm: mul(translate(x, 0), tm), show, text: p.text, advance });
      x += advance;
    }
    return out;
  }
}

/** Swap the painting operator of a path to add or remove fill/stroke. */
function repaint(op: string, fill: boolean | null, stroke: boolean | null): string {
  const hasF = ['f', 'F', 'f*', 'B', 'B*', 'b', 'b*'].includes(op);
  const hasS = ['S', 's', 'B', 'B*', 'b', 'b*'].includes(op);
  const even = op.endsWith('*');
  const f = fill ?? hasF;
  const s = stroke ?? hasS;
  if (f && s) return even ? 'B*' : 'B';
  if (f) return even ? 'f*' : 'f';
  if (s) return 'S';
  return 'n';
}

const ELLIPSE_K = 0.5523;
function ellipseOps(r: Rect): Op[] {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2, ry = r.h / 2, kx = rx * ELLIPSE_K, ky = ry * ELLIPSE_K;
  return [
    { op: 'm', args: [cx + rx, cy] },
    { op: 'c', args: [cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry] },
    { op: 'c', args: [cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy] },
    { op: 'c', args: [cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry] },
    { op: 'c', args: [cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy] },
    { op: 'h', args: [] },
  ];
}

function freshState(patch: Partial<GState> = {}): GState {
  return { ...initialState(), ...patch };
}

async function embedImage(doc: PDFDocument, img: ImageData) {
  return img.png ? doc.embedPng(img.bytes) : doc.embedJpg(img.bytes);
}

/**
 * Apply edits to one page. Object ids are indices into the page's object list
 * as returned by readPage. Returns the indices of the objects to select next.
 */
export async function editPage(page: PDFPage, edits: ContentEdit[]): Promise<number[]> {
  const { objects, fonts } = readPage(page);
  const writer = new TextWriter(page, fonts);
  let list: (ContentObject | null)[] = [...objects];
  let selection: ContentObject[] = [];
  const pick = (ids: number[]) => ids.map((i) => list[i]).filter((o): o is ContentObject => !!o);
  const replace = (o: ContentObject, next: ContentObject) => {
    list[list.indexOf(o)] = next;
    return next;
  };

  for (const e of edits) {
    switch (e.type) {
      case 'transform':
        selection = pick(e.ids).map((o) => replace(o, { ...o, user: mul(o.user, e.m) }));
        break;
      case 'delete':
        for (const o of pick(e.ids)) list[list.indexOf(o)] = null;
        selection = [];
        break;
      case 'arrange': {
        const chosen = pick(e.ids);
        let all = list.filter((o): o is ContentObject => !!o);
        const rest = all.filter((o) => !chosen.includes(o));
        if (e.to === 'front') all = [...rest, ...chosen];
        else if (e.to === 'back') all = [...chosen, ...rest];
        else {
          // One step: swap each chosen object with its neighbour.
          const order = e.to === 'forward' ? [...chosen].sort((x, y) => all.indexOf(y) - all.indexOf(x)) : [...chosen].sort((x, y) => all.indexOf(x) - all.indexOf(y));
          for (const o of order) {
            const i = all.indexOf(o);
            const j = e.to === 'forward' ? i + 1 : i - 1;
            if (j < 0 || j >= all.length || chosen.includes(all[j])) continue;
            [all[i], all[j]] = [all[j], all[i]];
          }
        }
        list = all;
        selection = chosen;
        break;
      }
      case 'duplicate': {
        const copies = pick(e.ids).map((o) => ({ ...o, user: mul(o.user, translate(e.dx, e.dy)) }));
        list.push(...copies);
        selection = copies;
        break;
      }
      case 'removeClip':
        selection = pick(e.ids).map((o) => replace(o, { ...o, state: { ...o.state, clips: [] } }));
        break;
      case 'fill':
        selection = pick(e.ids).map((o) => {
          if (o.kind === 'text') return replace(o, { ...o, state: { ...o.state, fill: e.color ? [rgb(e.color, 'rg')] : o.state.fill } });
          if (o.kind !== 'path') return o;
          const paint = o.ops[o.ops.length - 1];
          const ops = [...o.ops.slice(0, -1), { op: repaint(paint.op, !!e.color, null), args: [] }];
          return replace(o, { ...o, ops, state: { ...o.state, fill: e.color ? [rgb(e.color, 'rg')] : o.state.fill } });
        });
        break;
      case 'stroke':
        selection = pick(e.ids).map((o) => {
          if (o.kind !== 'path') return o;
          const paint = o.ops[o.ops.length - 1];
          const ops = [...o.ops.slice(0, -1), { op: repaint(paint.op, null, !!e.color), args: [] }];
          let state: GState = { ...o.state, stroke: e.color ? [rgb(e.color, 'RG')] : o.state.stroke };
          if (e.width !== undefined) {
            // The width is given in points on the page; undo the object's CTM scale.
            const w = e.width / (maxScale(mul(o.state.ctm, o.user)) || 1);
            state = { ...state, params: { ...state.params, w: { op: { op: 'w', args: [w] } } }, lineWidth: w };
          }
          return replace(o, { ...o, ops, state });
        });
        break;
      case 'text': {
        const o = list[e.id];
        if (!o || o.kind !== 'text') break;
        const r0 = o.runs[0];
        const runs = await writer.runs(e.text, r0, r0.tm, 'original');
        selection = [replace(o, { ...o, runs })];
        break;
      }
      case 'textStyle':
        selection = [];
        for (const o of pick(e.ids)) {
          if (o.kind !== 'text') {
            selection.push(o);
            continue;
          }
          // e.size is the displayed size in points: undo the text matrix and CTM scale.
          const shown = o.runs[0].size * maxScale(mul(o.runs[0].tm, o.state.ctm));
          const scale = e.size && shown ? e.size / shown : 1;
          let runs = o.runs.map((r) => {
            // Keep the line's start in place when the size changes.
            const dx = r.tm[4] - o.runs[0].tm[4];
            const dy = r.tm[5] - o.runs[0].tm[5];
            const tm: M = [r.tm[0], r.tm[1], r.tm[2], r.tm[3], o.runs[0].tm[4] + dx * scale, o.runs[0].tm[5] + dy * scale];
            return { ...r, size: r.size * scale, tm, Tc: e.Tc ?? r.Tc, Tw: e.Tw ?? r.Tw, Tz: e.Tz ?? r.Tz, Ts: e.Ts ?? r.Ts, advance: r.advance * scale };
          });
          if (e.font && e.font !== 'original') {
            const text = runs.map((r) => r.text).join('');
            runs = await writer.runs(text, runs[0], runs[0].tm, e.font);
          } else if (e.Tc !== undefined || e.Tw !== undefined || e.Tz !== undefined) {
            // Spacing changes alter advances: re-measure each run and lay them out again.
            let x = 0;
            runs = runs.map((r, i) => {
              const f = fonts.get(r.font);
              const { advance } = measureShow(r.show, f, r);
              const tm: M = i === 0 ? r.tm : mul(translate(x, 0), runs[0].tm);
              x += advance;
              return { ...r, tm, advance };
            });
          }
          selection.push(replace(o, { ...o, runs }));
        }
        break;
      case 'replaceImage': {
        const o = list[e.id];
        if (!o || o.kind !== 'image') break;
        const img = await embedImage(page.doc, e.image);
        const key = page.node.newXObject('Im', img.ref).toString().slice(1);
        selection = [replace(o, { ...o, ops: [{ op: 'Do', args: [nm(key)] }] })];
        break;
      }
      case 'addText': {
        const base = { font: '', size: e.size, Tc: 0, Tw: 0, Tz: 100, Ts: 0, Tr: 0 };
        const runs = await writer.runs(e.text, base, translate(e.at.x, e.at.y), e.font === 'original' ? 'NotoSans' : e.font);
        const obj: ContentObject = { kind: 'text', state: freshState({ fill: [rgb(e.color, 'rg')] }), mc: [], ops: [], runs, user: IDENTITY, bbox: { x: e.at.x, y: e.at.y, w: 0, h: 0 } };
        list.push(obj);
        selection = [obj];
        break;
      }
      case 'addImage': {
        const img = await embedImage(page.doc, e.image);
        const key = page.node.newXObject('Im', img.ref).toString().slice(1);
        const r = e.rect;
        const obj: ContentObject = { kind: 'image', state: freshState({ ctm: [r.w, 0, 0, r.h, r.x, r.y] }), mc: [], ops: [{ op: 'Do', args: [nm(key)] }], runs: [], user: IDENTITY, bbox: r };
        list.push(obj);
        selection = [obj];
        break;
      }
      case 'addShape': {
        const r = e.rect;
        const geometry: Op[] =
          e.shape === 'rect' ? [{ op: 're', args: [r.x, r.y, r.w, r.h] }]
          : e.shape === 'ellipse' ? ellipseOps(r)
          : [{ op: 'm', args: [r.x, r.y] }, { op: 'l', args: [r.x + r.w, r.y + r.h] }];
        const fill = e.shape === 'line' ? null : e.fill;
        const paint = repaint('n', !!fill, !!e.stroke || e.shape === 'line');
        const state = freshState({
          fill: fill ? [rgb(fill, 'rg')] : [],
          stroke: e.stroke ? [rgb(e.stroke, 'RG')] : [],
          params: { w: { op: { op: 'w', args: [e.width] } }, J: { op: { op: 'J', args: [1] } }, j: { op: { op: 'j', args: [1] } } },
          lineWidth: e.width,
        });
        const obj: ContentObject = { kind: 'path', state, mc: [], ops: [...geometry, { op: paint, args: [] }], runs: [], user: IDENTITY, bbox: r };
        list.push(obj);
        selection = [obj];
        break;
      }
    }
  }
  const final = list.filter((o): o is ContentObject => !!o);
  writePage(page, final);
  return selection.map((o) => final.indexOf(o)).filter((i) => i >= 0);
}

/** Summary of an object for the editing UI. */
export interface ObjectInfo {
  id: number;
  kind: ContentObject['kind'];
  bbox: Rect;
  text?: string;
  fontName?: string;
  fontSize?: number;
  fill?: string;
  stroke?: string;
  lineWidth?: number;
  Tc?: number;
  Tw?: number;
  Tz?: number;
  Ts?: number;
  clipped: boolean;
  /** Can the line's text be re-encoded in its own font? (checked per character on commit) */
  fontKey?: string;
}

const toHex = (args: unknown[]): string | undefined => {
  const v = args.map((a) => (typeof a === 'number' ? a : 0));
  const rgbv = v.length === 1 ? [v[0], v[0], v[0]] : v.length === 3 ? v : v.length === 4 ? [0, 1, 2].map((i) => (1 - v[i]) * (1 - v[3])) : undefined;
  return rgbv && '#' + rgbv.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('');
};

function colorOf(ops: Op[]): string | undefined {
  const last = ops[ops.length - 1];
  if (!last) return '#000000';
  if (['g', 'rg', 'k', 'G', 'RG', 'K'].includes(last.op)) return toHex(last.args);
  if (['sc', 'scn', 'SC', 'SCN'].includes(last.op) && last.args.every((a) => typeof a === 'number')) {
    const space = ops[0]?.args[0];
    const v = last.args as number[];
    if (space && typeof space === 'object' && 't' in space && space.t === 'name' && /Gray|RGB|CMYK/.test(space.v)) return toHex(v);
    return v.length === 3 || v.length === 1 || v.length === 4 ? toHex(v) : undefined;
  }
  return undefined;
}

export function describeObjects(pc: PageContent): ObjectInfo[] {
  return pc.objects.map((o, id) => {
    const info: ObjectInfo = { id, kind: o.kind, bbox: objectBounds(o), clipped: o.state.clips.length > 0 };
    if (o.kind === 'text') {
      const r = o.runs[0];
      info.text = o.runs.map((x) => x.text).join('');
      info.fontKey = r.font;
      info.fontName = pc.fonts.get(r.font)?.baseFont ?? r.font;
      info.fontSize = Math.round(r.size * maxScale(mul(r.tm, o.state.ctm)) * 100) / 100;
      info.fill = colorOf(o.state.fill);
      Object.assign(info, { Tc: r.Tc, Tw: r.Tw, Tz: r.Tz, Ts: r.Ts });
    }
    if (o.kind === 'path') {
      const paint = o.ops[o.ops.length - 1]?.op ?? 'n';
      if (['f', 'F', 'f*', 'B', 'B*', 'b', 'b*'].includes(paint)) info.fill = colorOf(o.state.fill);
      if (['S', 's', 'B', 'B*', 'b', 'b*'].includes(paint)) info.stroke = colorOf(o.state.stroke);
      info.lineWidth = Math.round(o.state.lineWidth * maxScale(o.state.ctm) * 100) / 100;
    }
    return info;
  });
}

export async function loadForEditing(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

