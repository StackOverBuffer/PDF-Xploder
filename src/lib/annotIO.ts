/**
 * Reading and writing annotations as native PDF annotation dictionaries.
 *
 * Writing produces standard subtypes (Highlight, Ink, Square, FreeText, …)
 * with an appearance stream, so other viewers show them and other editors can
 * edit them. A private /AwesomePDF entry (the name is kept for files saved by earlier versions) keeps the exact model for lossless
 * round trips; standard keys still win where another editor changed them.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFRawStream,
  PDFRef,
  PDFString,
} from '@cantoo/pdf-lib';
import { hexToRgbTuple } from './color';
import { buildAppearance, type AppearanceOptions, type DrawContext } from './appearance';
import { normRot, pdfToView, viewToPdf } from './geometry';
import type { Annotation, PageGeom, Pt, Rect } from './types';

const PRIVATE = PDFName.of('AwesomePDF');
const PRIVATE_SRC = PDFName.of('AwesomePDFSrc');

// ---------------------------------------------------------------- helpers

const n = (o: unknown): number | undefined => (o instanceof PDFNumber ? o.asNumber() : undefined);

function numbers(o: unknown): number[] {
  return o instanceof PDFArray ? o.asArray().map((x) => n(x) ?? 0) : [];
}

function text(o: unknown): string | undefined {
  return o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : undefined;
}

function toHex(c: number[]): string | undefined {
  let rgb: number[];
  if (c.length === 1) rgb = [c[0], c[0], c[0]];
  else if (c.length === 3) rgb = c;
  else if (c.length === 4) rgb = [0, 1, 2].map((i) => (1 - c[i]) * (1 - c[3]));
  else return undefined;
  return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
}

/** Parse a PDF date string ("D:YYYYMMDDHHmmSSOHH'mm'"). */
export function parsePdfDate(s: string | undefined): number | undefined {
  const m = s?.match(/^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/);
  if (!m) return undefined;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz, th = '00', tm = '00'] = m;
  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  if (tz === '+' || tz === '-') t -= (tz === '+' ? 1 : -1) * (+th * 60 + +tm) * 60_000;
  else if (!tz) t += new Date(t).getTimezoneOffset() * 60_000; // no zone: local time
  return t;
}

function rectOf(dict: PDFDict): Rect | undefined {
  const r = numbers(dict.get(PDFName.of('Rect')));
  if (r.length !== 4) return undefined;
  return { x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1]) };
}

function borderWidth(dict: PDFDict, fallback = 1): number {
  const bs = dict.lookup(PDFName.of('BS'));
  if (bs instanceof PDFDict) {
    const w = n(bs.lookup(PDFName.of('W')));
    if (w !== undefined) return w;
  }
  const border = numbers(dict.lookup(PDFName.of('Border')));
  return border.length >= 3 ? border[2] : fallback;
}

function quadRects(dict: PDFDict): Rect[] {
  const q = numbers(dict.lookup(PDFName.of('QuadPoints')));
  const out: Rect[] = [];
  for (let i = 0; i + 7 < q.length; i += 8) {
    const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]];
    const ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    out.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
  }
  return out;
}

function quadPoints(rects: Rect[]): number[] {
  // Upper-left, upper-right, lower-left, lower-right — the order Acrobat writes.
  return rects.flatMap((r) => [r.x, r.y + r.h, r.x + r.w, r.y + r.h, r.x, r.y, r.x + r.w, r.y]);
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

function dataUrlToBytes(src: string): { bytes: Uint8Array; mime: string } {
  const [head, data] = src.split(',');
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime: head.slice(5).split(';')[0] };
}

// ---------------------------------------------------------------- writing

const SUBTYPE: Record<Annotation['type'], string> = {
  highlight: 'Highlight', underline: 'Underline', strikeout: 'StrikeOut', ink: 'Ink', rect: 'Square',
  ellipse: 'Circle', line: 'Line', arrow: 'Line', polygon: 'Polygon', polyline: 'PolyLine', cloud: 'Polygon',
  text: 'FreeText', note: 'Text', image: 'Stamp', stamp: 'Stamp', redact: 'Redact',
};

/** Add `a` to the page as a native annotation with an appearance stream. */
export async function writeNativeAnnotation(ctx: DrawContext, page: PDFPage, g: PageGeom, a: Annotation, opts: AppearanceOptions = {}) {
  const doc = ctx.doc;
  const pdf = doc.context;
  const { ref, rect } = await buildAppearance(ctx, a, g, opts);
  const color = hexToRgbTuple(a.color);
  const dict = pdf.obj({
    Type: 'Annot',
    Subtype: SUBTYPE[a.type],
    Rect: [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h],
    AP: { N: ref },
    NM: PDFHexString.fromText(a.id),
    T: PDFHexString.fromText(a.author),
    M: PDFString.fromDate(new Date()),
    CreationDate: PDFString.fromDate(new Date(a.createdAt)),
    F: 4, // Print
    C: color,
    CA: a.opacity,
  });
  const set = (k: string, v: unknown) => dict.set(PDFName.of(k), pdf.obj(v as never));
  const contents = a.type === 'text' || a.type === 'note' ? a.text : a.comment;
  if (contents) dict.set(PDFName.of('Contents'), PDFHexString.fromText(contents));

  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      set('QuadPoints', quadPoints(a.rects));
      break;
    case 'ink':
      set('InkList', a.paths.map((p) => p.flatMap((q) => [q.x, q.y])));
      set('BS', { W: a.width, S: 'S' });
      break;
    case 'rect':
    case 'ellipse':
      set('BS', { W: a.width, S: 'S' });
      if (a.fill) set('IC', hexToRgbTuple(a.fill));
      break;
    case 'line':
    case 'arrow':
      set('L', [a.p1.x, a.p1.y, a.p2.x, a.p2.y]);
      set('BS', { W: a.width, S: 'S' });
      if (a.type === 'arrow') set('LE', ['None', 'OpenArrow']);
      break;
    case 'polygon':
    case 'polyline':
      set('Vertices', a.vertices.flatMap((p) => [p.x, p.y]));
      set('BS', { W: a.width, S: 'S' });
      if (a.fill) set('IC', hexToRgbTuple(a.fill));
      break;
    case 'cloud':
      set('Vertices', a.vertices.flatMap((p) => [p.x, p.y]));
      set('BS', { W: a.width, S: 'S' });
      set('BE', { S: 'Cloudy', I: 1 });
      if (a.fill) set('IC', hexToRgbTuple(a.fill));
      break;
    case 'text':
      set('DA', PDFString.of(`/Helv ${a.fontSize} Tf ${color.map((v) => v.toFixed(3)).join(' ')} rg`));
      set('BS', { W: a.border ? 1 : 0 });
      set('Rotate', a.rot ?? 0);
      break;
    case 'note':
      set('Name', 'Comment');
      set('F', 4 | 8 | 16); // Print, NoZoom, NoRotate
      break;
    case 'stamp':
      set('Name', a.label.replace(/[^A-Za-z0-9]/g, '') || 'Stamp');
      set('Rotate', a.rot ?? 0);
      break;
    case 'image': {
      set('Name', a.signature ? 'Signature' : 'Image');
      set('Rotate', a.rot ?? 0);
      const { bytes } = dataUrlToBytes(a.src);
      dict.set(PRIVATE_SRC, pdf.register(pdf.stream(bytes)));
      break;
    }
    case 'redact':
      set('QuadPoints', quadPoints([a.rect]));
      set('IC', [0, 0, 0]);
      break;
  }

  const model: Record<string, unknown> = { ...a, rect0: rect };
  if (a.type === 'image') model.src = dataUrlToBytes(a.src).mime;
  dict.set(PRIVATE, PDFHexString.fromText(JSON.stringify(model)));
  page.node.addAnnot(pdf.register(dict));
}

// ---------------------------------------------------------------- reading

interface ParseEnv {
  doc: PDFDocument;
  g: PageGeom;
  newId: () => string;
}

function base(dict: PDFDict, env: ParseEnv) {
  const color = toHex(numbers(dict.lookup(PDFName.of('C')))) ?? '#e53935';
  return {
    id: text(dict.lookup(PDFName.of('NM'))) || env.newId(),
    color,
    opacity: n(dict.lookup(PDFName.of('CA'))) ?? 1,
    author: text(dict.lookup(PDFName.of('T'))) ?? '',
    createdAt: parsePdfDate(text(dict.lookup(PDFName.of('CreationDate'))) ?? text(dict.lookup(PDFName.of('M')))) ?? Date.now(),
    comment: text(dict.lookup(PDFName.of('Contents'))) || undefined,
  };
}

/** Our private model, adjusted for edits another program made to the standard keys. */
function fromPrivate(dict: PDFDict): Annotation | null {
  const raw = text(dict.lookup(PRIVATE));
  if (!raw) return null;
  let a: Annotation & { rect0?: Rect };
  try {
    a = JSON.parse(raw);
  } catch {
    return null;
  }
  const now = rectOf(dict);
  const was = a.rect0;
  delete a.rect0;
  // Another editor may have moved the annotation: follow its /Rect.
  if (now && was && (Math.abs(now.x - was.x) > 0.5 || Math.abs(now.y - was.y) > 0.5) && Math.abs(now.w - was.w) < 0.5 && Math.abs(now.h - was.h) < 0.5) {
    a = { ...a, ...translate(a, now.x - was.x, now.y - was.y) } as Annotation;
  }
  const contents = text(dict.lookup(PDFName.of('Contents')));
  if (a.type === 'text' || a.type === 'note') a.text = contents ?? '';
  else a.comment = contents || undefined;
  const c = toHex(numbers(dict.lookup(PDFName.of('C'))));
  if (c) a.color = c;
  if (a.type === 'image') {
    const src = dict.lookup(PRIVATE_SRC);
    if (!(src instanceof PDFRawStream)) return null;
    a.src = bytesToDataUrl(src.getContents(), (a.src as string) || 'image/png');
  }
  return a;
}

function translate(a: Annotation, dx: number, dy: number): Partial<Annotation> {
  const mv = (p: Pt) => ({ x: p.x + dx, y: p.y + dy });
  const mr = (r: Rect) => ({ ...r, x: r.x + dx, y: r.y + dy });
  switch (a.type) {
    case 'highlight': case 'underline': case 'strikeout': return { rects: a.rects.map(mr) };
    case 'ink': return { paths: a.paths.map((p) => p.map(mv)) };
    case 'line': case 'arrow': return { p1: mv(a.p1), p2: mv(a.p2) };
    case 'polygon': case 'polyline': case 'cloud': return { vertices: a.vertices.map(mv) };
    case 'note': return { at: mv(a.at) };
    default: return { rect: mr(a.rect) };
  }
}

function parseDA(da: string | undefined): { size?: number; color?: string } {
  if (!da) return {};
  const size = da.match(/([\d.]+)\s+Tf/);
  const rgb = da.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/);
  const gray = da.match(/([\d.]+)\s+g(?:\s|$)/);
  const color = rgb ? toHex([+rgb[1], +rgb[2], +rgb[3]]) : gray ? toHex([+gray[1]]) : undefined;
  return { size: size ? Number(size[1]) || undefined : undefined, color };
}

/** Convert a standard annotation from any producer into our model, or null if unsupported. */
function fromStandard(dict: PDFDict, env: ParseEnv): Annotation | null {
  const subtype = (dict.lookup(PDFName.of('Subtype')) as PDFName | undefined)?.decodeText();
  const rect = rectOf(dict);
  if (!rect) return null;
  const b = base(dict, env);
  const pageRot = env.g.rotation;
  switch (subtype) {
    case 'Highlight':
    case 'Underline':
    case 'Squiggly':
    case 'StrikeOut': {
      const rects = quadRects(dict);
      const type = subtype === 'Highlight' ? 'highlight' : subtype === 'StrikeOut' ? 'strikeout' : 'underline';
      return { ...b, type, rects: rects.length ? rects : [rect], rot: pageRot, opacity: subtype === 'Highlight' ? Math.min(b.opacity, 0.5) : b.opacity };
    }
    case 'Ink': {
      const list = dict.lookup(PDFName.of('InkList'));
      if (!(list instanceof PDFArray)) return null;
      const paths = list.asArray().map((arr) => {
        const v = numbers(dict.context.lookup(arr));
        const pts: Pt[] = [];
        for (let i = 0; i + 1 < v.length; i += 2) pts.push({ x: v[i], y: v[i + 1] });
        return pts;
      }).filter((p) => p.length);
      return paths.length ? { ...b, type: 'ink', paths, width: borderWidth(dict) } : null;
    }
    case 'Square':
    case 'Circle': {
      const w = borderWidth(dict);
      const rd = numbers(dict.lookup(PDFName.of('RD')));
      const inner = rd.length === 4
        ? { x: rect.x + rd[0], y: rect.y + rd[3], w: rect.w - rd[0] - rd[2], h: rect.h - rd[1] - rd[3] }
        : rect;
      const shape = { x: inner.x + w / 2, y: inner.y + w / 2, w: Math.max(1, inner.w - w), h: Math.max(1, inner.h - w) };
      const fill = toHex(numbers(dict.lookup(PDFName.of('IC')))) ?? null;
      return { ...b, type: subtype === 'Square' ? 'rect' : 'ellipse', rect: shape, width: w, fill };
    }
    case 'Line': {
      const l = numbers(dict.lookup(PDFName.of('L')));
      if (l.length !== 4) return null;
      const le = dict.lookup(PDFName.of('LE'));
      const ends = le instanceof PDFArray ? le.asArray().map((x) => (x as PDFName).decodeText?.() ?? '') : [];
      const arrowAtStart = /Arrow/.test(ends[0] ?? '');
      const arrowAtEnd = /Arrow/.test(ends[1] ?? '');
      const [p1, p2] = arrowAtStart && !arrowAtEnd ? [{ x: l[2], y: l[3] }, { x: l[0], y: l[1] }] : [{ x: l[0], y: l[1] }, { x: l[2], y: l[3] }];
      return { ...b, type: arrowAtStart || arrowAtEnd ? 'arrow' : 'line', p1, p2, width: borderWidth(dict) };
    }
    case 'Polygon':
    case 'PolyLine': {
      const v = numbers(dict.lookup(PDFName.of('Vertices')));
      const vertices: Pt[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) vertices.push({ x: v[i], y: v[i + 1] });
      if (vertices.length < 2) return null;
      const cloudy = (dict.lookup(PDFName.of('BE')) as PDFDict | undefined)?.lookup(PDFName.of('S'))?.toString() === '/Cloudy';
      const type: 'cloud' | 'polygon' | 'polyline' = cloudy ? 'cloud' : subtype === 'Polygon' ? 'polygon' : 'polyline';
      return { ...b, type, vertices, width: borderWidth(dict), fill: toHex(numbers(dict.lookup(PDFName.of('IC')))) ?? null };
    }
    case 'FreeText': {
      const da = parseDA(text(dict.lookup(PDFName.of('DA'))));
      const rot = normRot(n(dict.lookup(PDFName.of('Rotate'))) ?? 0);
      return {
        ...b, type: 'text', rect, text: b.comment ?? '', comment: undefined,
        fontSize: da.size ?? 12, color: da.color ?? '#000000', border: borderWidth(dict, 0) > 0, rot,
      };
    }
    case 'Text': {
      const v = pdfToView(env.g, { x: rect.x, y: rect.y + rect.h });
      const vb = pdfToView(env.g, { x: rect.x + rect.w, y: rect.y });
      const at = viewToPdf(env.g, { x: Math.min(v.x, vb.x), y: Math.min(v.y, vb.y) });
      return { ...b, type: 'note', at, text: b.comment ?? '', comment: undefined, color: toHex(numbers(dict.lookup(PDFName.of('C')))) ?? '#fbc02d' };
    }
    case 'Redact': {
      const rects = quadRects(dict);
      return { ...b, type: 'redact', rect: rects.length ? rects.reduce(unionRect) : rect };
    }
    default:
      return null;
  }
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export interface ImportResult {
  /** Annotations per page index. */
  annotations: Annotation[][];
  /** Number of annotations converted. */
  count: number;
}

/**
 * Move every supported annotation out of the document and into the model,
 * so it can be edited. Unsupported annotations (links, widgets, …) stay put.
 * Mutates `doc`.
 */
export function importAnnotations(doc: PDFDocument, geoms: PageGeom[], newId: () => string): ImportResult {
  const annotations: Annotation[][] = [];
  let count = 0;
  doc.getPages().forEach((page, i) => {
    const out: Annotation[] = [];
    annotations.push(out);
    const annots = page.node.Annots();
    if (!annots) return;
    const env: ParseEnv = { doc, g: geoms[i], newId };
    const remove = new Set<PDFRef | PDFDict>();
    for (let k = 0; k < annots.size(); k++) {
      const entry = annots.get(k);
      const dict = doc.context.lookup(entry);
      if (!(dict instanceof PDFDict)) continue;
      // Hidden annotations stay hidden.
      if ((n(dict.lookup(PDFName.of('F'))) ?? 0) & 2) continue;
      const a = fromPrivate(dict) ?? fromStandard(dict, env);
      if (!a) continue;
      out.push(a);
      count++;
      remove.add(entry as PDFRef);
      const popup = dict.get(PDFName.of('Popup'));
      if (popup instanceof PDFRef) remove.add(popup);
    }
    if (!remove.size) return;
    const kept = annots.asArray().filter((e) => !remove.has(e as PDFRef));
    if (kept.length) page.node.set(PDFName.of('Annots'), doc.context.obj(kept));
    else page.node.delete(PDFName.of('Annots'));
  });
  return { annotations, count };
}
