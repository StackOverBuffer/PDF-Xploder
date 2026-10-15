/**
 * Page organisation ("Dokumentaufbau"): assembling pages from several sources,
 * page boxes and sizes, overlays, removable page marks, page labels and
 * blank/duplicate page detection. Like pdfOps, everything works on PDF bytes
 * and is DOM-free; the basic page operations themselves live in pdfOps.
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
  PDFStream,
  PDFString,
  decodePDFRawStream,
  degrees,
  type PDFObject,
} from '@cantoo/pdf-lib';
import * as ops from './pdfOps';
import { hexToRgbTuple } from './color';
import { normRot, viewRectToPdf, viewSize, viewToPdf } from './geometry';
import { apply, inv, mul, type M } from './content/matrix';
import { isName, parseContent, writeContent, type Op, type Operand } from './content/syntax';
import type { Annotation, PageGeom, Pt, Rect } from './types';

const load = ops.load;
const save = (doc: PDFDocument) => doc.save({ useObjectStreams: true });
const N = (k: string) => PDFName.of(k);
const enc = new TextEncoder();

// ---------------------------------------------------------------- page lists

/** Format 0-based indices as a 1-based range list, e.g. "1-3, 5". */
export function rangeText(indices: number[]): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let k = 0; k < sorted.length; k++) {
    const start = sorted[k];
    while (k + 1 < sorted.length && sorted[k + 1] === sorted[k] + 1) k++;
    parts.push(start === sorted[k] ? `${start + 1}` : `${start + 1}-${sorted[k] + 1}`);
  }
  return parts.join(', ');
}

export type Subset = 'all' | 'even' | 'odd';
export type OrientationFilter = 'any' | 'portrait' | 'landscape';

/** Keep pages by (1-based) even/odd number and by displayed orientation. */
export function filterPages(indices: number[], subset: Subset, orientation: OrientationFilter = 'any', sizes?: { width: number; height: number }[]): number[] {
  return indices.filter((i) => {
    if (subset === 'even' && (i + 1) % 2) return false;
    if (subset === 'odd' && !((i + 1) % 2)) return false;
    const s = sizes?.[i];
    if (s && orientation === 'portrait' && s.width > s.height) return false;
    if (s && orientation === 'landscape' && s.width < s.height) return false;
    return true;
  });
}

/** Split a sorted list of indices into runs of consecutive pages. */
function runs(indices: number[]): number[][] {
  const out: number[][] = [];
  for (const i of [...new Set(indices)].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i);
    else out.push([i]);
  }
  return out;
}

// ---------------------------------------------------------------- assembling

/** A page of the result: an index into the current document, or a page of another file. */
export type PageSource = number | { file: number; page: number };

/**
 * Build a document whose pages follow `layout`. The first use of a current page
 * keeps that page; further uses are copies. Current pages not in the layout are
 * dropped. `others` holds the files that `{ file, page }` entries refer to.
 */
export async function assemblePages(bytes: Uint8Array, layout: PageSource[], others: Uint8Array[] = []): Promise<Uint8Array> {
  if (!layout.length) throw new Error('A document must keep at least one page.');
  const doc = await load(bytes);
  const pages = doc.getPages();
  for (const page of pages) {
    for (const key of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
      const v = page.node.getInheritableAttribute(N(key));
      if (v && !page.node.get(N(key))) page.node.set(N(key), v);
    }
  }
  const result: (PDFPage | undefined)[] = new Array(layout.length);
  // Copy in one pass per source so copies share their resources.
  const used = new Set<number>();
  const repeats: number[] = [];
  const external = new Map<number, number[]>();
  layout.forEach((e, k) => {
    if (typeof e === 'number') {
      if (e < 0 || e >= pages.length) throw new Error(`Page ${e + 1} does not exist.`);
      if (used.has(e)) repeats.push(k);
      else {
        used.add(e);
        result[k] = pages[e];
      }
    } else (external.get(e.file) ?? external.set(e.file, []).get(e.file)!).push(k);
  });
  if (repeats.length) {
    const copies = await doc.copyPages(doc, repeats.map((k) => layout[k] as number));
    repeats.forEach((k, j) => (result[k] = copies[j]));
  }
  for (const [file, slots] of external) {
    const src = await load(others[file]);
    const idx = slots.map((k) => (layout[k] as { page: number }).page);
    for (const i of idx) if (i < 0 || i >= src.getPageCount()) throw new Error(`Page ${i + 1} does not exist in the other file.`);
    const copies = await doc.copyPages(src, idx);
    slots.forEach((k, j) => (result[k] = copies[j]));
  }
  const rootRef = doc.catalog.get(N('Pages')) as PDFRef;
  const root = doc.context.lookup(rootRef, PDFDict);
  for (const p of result) p!.node.set(N('Parent'), rootRef);
  root.set(N('Kids'), doc.context.obj(result.map((p) => p!.ref)));
  root.set(N('Count'), doc.context.obj(result.length));
  return save(doc);
}

export type DuplicateWhere = 'each' | 'after' | 'start' | 'end';

/**
 * Layout for duplicating `pages` `copies` times. each: right after each page;
 * after: after the last of the pages; start/end of the document. With collate
 * the block repeats (1,2,1,2), otherwise each page repeats (1,1,2,2).
 */
export function duplicateLayout(n: number, pages: number[], copies: number, where: DuplicateWhere, collate = true): number[] {
  const sel = [...new Set(pages)].sort((a, b) => a - b);
  const all = Array.from({ length: n }, (_, i) => i);
  if (where === 'each') return all.flatMap((i) => (sel.includes(i) ? Array(copies + 1).fill(i) : [i]));
  const block = collate ? Array.from({ length: copies }, () => sel).flat() : sel.flatMap((p) => Array(copies).fill(p));
  if (where === 'start') return [...block, ...all];
  if (where === 'end') return [...all, ...block];
  const at = sel[sel.length - 1] + 1;
  return [...all.slice(0, at), ...block, ...all.slice(at)];
}

/** Layout that swaps two groups of pages: each group takes the place of the other. */
export function swapLayout(n: number, a: number[], b: number[]): number[] {
  const A = [...new Set(a)].sort((x, y) => x - y);
  const B = [...new Set(b)].sort((x, y) => x - y);
  if (!A.length || !B.length) throw new Error('Choose two groups of pages to swap.');
  if (A.some((i) => B.includes(i))) throw new Error('The page groups to swap overlap.');
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === A[0]) out.push(...B);
    else if (i === B[0]) out.push(...A);
    else if (!A.includes(i) && !B.includes(i)) out.push(i);
  }
  return out;
}

/** Layout that replaces `targets` with pages of another file, placed where the first target was. */
export function replaceLayout(n: number, targets: number[], sourcePages: number[], file = 0): PageSource[] {
  const T = [...new Set(targets)].sort((a, b) => a - b);
  if (!T.length || !sourcePages.length) throw new Error('Choose the pages to replace and the replacement pages.');
  const out: PageSource[] = [];
  for (let i = 0; i < n; i++) {
    if (i === T[0]) out.push(...sourcePages.map((page) => ({ file, page })));
    if (!T.includes(i)) out.push(i);
  }
  return out;
}

/** Layout that reverses the order of the given pages among themselves (all pages when fewer than two are given). */
export function reverseLayout(n: number, pages: number[]): number[] {
  const pos = pages.length < 2 ? Array.from({ length: n }, (_, i) => i) : [...new Set(pages)].sort((a, b) => a - b);
  const out = Array.from({ length: n }, (_, i) => i);
  pos.forEach((p, k) => (out[p] = pos[pos.length - 1 - k]));
  return out;
}

/** Insert `count` blank pages before position `at`, sized like the neighbouring page as displayed unless `size` is given. */
export async function insertBlankPages(bytes: Uint8Array, at: number, count: number, size?: [number, number]): Promise<Uint8Array> {
  const doc = await load(bytes);
  let dims = size;
  if (!dims) {
    const vs = viewSize(ops.geomOf(doc.getPage(Math.min(Math.max(at - 1, 0), doc.getPageCount() - 1))));
    dims = [vs.width, vs.height];
  }
  for (let k = 0; k < count; k++) doc.insertPage(at + k, dims);
  return save(doc);
}

export interface PageImage {
  data: Uint8Array;
  png: boolean;
}

export interface ImagePageOptions {
  /** Page size; null makes the page as large as the image at 96 dpi. Turned to match the image orientation. */
  size: [number, number] | null;
  margin: number;
}

/** Insert one page per image before position `at`, the image fitted and centred. */
export async function insertImagePages(bytes: Uint8Array, images: PageImage[], at: number, o: ImagePageOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  for (const [k, im] of images.entries()) {
    const img = im.png ? await doc.embedPng(im.data) : await doc.embedJpg(im.data);
    let [w, h] = o.size ?? [img.width * 0.75 + 2 * o.margin, img.height * 0.75 + 2 * o.margin];
    if (o.size && (img.width > img.height) !== (w > h)) [w, h] = [h, w];
    const k2 = Math.min((w - 2 * o.margin) / img.width, (h - 2 * o.margin) / img.height);
    const page = doc.insertPage(at + k, [w, h]);
    page.drawImage(img, { x: (w - img.width * k2) / 2, y: (h - img.height * k2) / 2, width: img.width * k2, height: img.height * k2 });
  }
  return save(doc);
}

// ---------------------------------------------------------------- reading content

function streamBytes(s: unknown): Uint8Array {
  if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
  const unencoded = (s as { getUnencodedContents?: () => Uint8Array }).getUnencodedContents;
  if (s instanceof PDFStream && unencoded) return unencoded.call(s);
  if (s instanceof PDFStream) return s.getContents();
  return new Uint8Array(0);
}

/** References of a page's content streams, in order. */
function contentRefs(page: PDFPage): PDFRef[] {
  const raw = page.node.get(N('Contents'));
  const v = raw instanceof PDFRef ? page.doc.context.lookup(raw) : raw;
  if (v instanceof PDFArray) return v.asArray().filter((r): r is PDFRef => r instanceof PDFRef);
  return raw instanceof PDFRef ? [raw] : [];
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function pageContent(page: PDFPage): Uint8Array {
  return concat(contentRefs(page).flatMap((r) => [streamBytes(page.doc.context.lookup(r)), new Uint8Array([10])]));
}

/** A fresh, page-owned Contents array (so changes never leak into shared arrays). */
function contentArray(page: PDFPage): PDFArray {
  const arr = page.doc.context.obj(contentRefs(page));
  page.node.set(N('Contents'), arr);
  return arr;
}

function addStream(page: PDFPage, content: Uint8Array | string, where: 'front' | 'back'): PDFRef {
  const ctx = page.doc.context;
  const ref = ctx.register(ctx.flateStream(typeof content === 'string' ? enc.encode(content) : content));
  const arr = contentArray(page);
  if (where === 'front') arr.insert(0, ref);
  else arr.push(ref);
  return ref;
}

/** Isolate the existing content in q … Q so content added after it starts from a clean graphics state. */
function wrapContent(page: PDFPage) {
  addStream(page, 'q\n', 'front');
  addStream(page, '\nQ\n', 'back');
}

const PAINT_OPS = new Set(['Tj', 'TJ', "'", '"', 'Do', 'sh', 'BI', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'S', 's']);

/** Pages whose content paints nothing (annotations are ignored). */
export async function findBlankPages(bytes: Uint8Array): Promise<number[]> {
  const doc = await load(bytes);
  return doc.getPages().flatMap((p, i) => (parseContent(pageContent(p)).some((o) => PAINT_OPS.has(o.op)) ? [] : [i]));
}

// ---------------------------------------------------------------- bookmarks & splitting

function text(o: PDFObject | undefined): string {
  return o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '';
}

function nameTreeLookup(node: PDFDict | undefined, key: string, depth = 0): PDFObject | undefined {
  if (!node || depth > 32) return undefined;
  const names = node.lookup(N('Names'));
  if (names instanceof PDFArray) {
    for (let k = 0; k + 1 < names.size(); k += 2) if (text(names.lookup(k)) === key) return names.lookup(k + 1);
  }
  const kids = node.lookup(N('Kids'));
  if (kids instanceof PDFArray) {
    for (let k = 0; k < kids.size(); k++) {
      const hit = nameTreeLookup(kids.lookupMaybe(k, PDFDict), key, depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** The page index an outline item or link destination points at, if any. */
function destPage(doc: PDFDocument, dest: PDFObject | undefined, pageIndex: Map<string, number>): number | undefined {
  let d = dest instanceof PDFRef ? doc.context.lookup(dest) : dest;
  if (d instanceof PDFName) d = doc.catalog.lookupMaybe(N('Dests'), PDFDict)?.lookup(d);
  else if (d instanceof PDFString || d instanceof PDFHexString) {
    const names = doc.catalog.lookupMaybe(N('Names'), PDFDict);
    d = nameTreeLookup(names?.lookupMaybe(N('Dests'), PDFDict), d.decodeText());
  }
  if (d instanceof PDFDict) d = d.lookup(N('D'));
  if (!(d instanceof PDFArray) || !d.size()) return undefined;
  const target = d.get(0);
  if (target instanceof PDFRef) return pageIndex.get(target.toString());
  if (target instanceof PDFNumber) return target.asNumber();
  return undefined;
}

export interface Bookmark {
  title: string;
  page: number;
}

/** Top-level bookmarks (outline items) that point at a page of the document. */
export async function topLevelBookmarks(bytes: Uint8Array): Promise<Bookmark[]> {
  const doc = await load(bytes);
  const pageIndex = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]));
  const outlines = doc.catalog.lookupMaybe(N('Outlines'), PDFDict);
  const out: Bookmark[] = [];
  const seen = new Set<PDFDict>();
  let item = outlines?.lookupMaybe(N('First'), PDFDict);
  while (item && !seen.has(item)) {
    seen.add(item);
    const action = item.lookupMaybe(N('A'), PDFDict);
    const dest = item.get(N('Dest')) ?? (action?.lookup(N('S'))?.toString() === '/GoTo' ? action.get(N('D')) : undefined);
    const page = destPage(doc, dest, pageIndex);
    if (page !== undefined) out.push({ title: text(item.lookup(N('Title'))), page });
    item = item.lookupMaybe(N('Next'), PDFDict);
  }
  return out;
}

/** One file per group of pages. */
export async function splitByRanges(bytes: Uint8Array, groups: number[][]): Promise<Uint8Array[]> {
  const parts: Uint8Array[] = [];
  for (const g of groups) if (g.length) parts.push(await ops.extractPages(bytes, g));
  return parts;
}

/** One file per top-level bookmark, from its page up to the next bookmark's page. */
export async function splitByBookmarks(bytes: Uint8Array): Promise<{ title: string; bytes: Uint8Array }[]> {
  const n = (await load(bytes)).getPageCount();
  const marks = (await topLevelBookmarks(bytes)).filter((b) => b.page >= 0 && b.page < n).sort((a, b) => a.page - b.page);
  const starts = marks.filter((b, k) => k === 0 || b.page !== marks[k - 1].page);
  if (!starts.length) throw new Error('This document has no bookmarks that point to its pages.');
  const out: { title: string; bytes: Uint8Array }[] = [];
  for (const [k, b] of starts.entries()) {
    const from = k === 0 ? 0 : b.page;
    const to = k + 1 < starts.length ? starts[k + 1].page : n;
    out.push({ title: b.title, bytes: await ops.extractPages(bytes, Array.from({ length: to - from }, (_, j) => from + j)) });
  }
  return out;
}

/** Split into files of at most `maxBytes` each where possible (a single page larger than that gets a file of its own). */
export async function splitBySize(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array[]> {
  const n = (await load(bytes)).getPageCount();
  const range = (from: number, count: number) => ops.extractPages(bytes, Array.from({ length: count }, (_, j) => from + j));
  const parts: Uint8Array[] = [];
  for (let start = 0; start < n; ) {
    const rest = n - start;
    let good = 1;
    let best = await range(start, 1);
    // Grow exponentially, then binary-search the largest page count that fits.
    let bad = rest + 1;
    while (good < rest) {
      const c = Math.min(good * 2, rest);
      const out = await range(start, c);
      if (out.length > maxBytes) {
        bad = c;
        break;
      }
      good = c;
      best = out;
    }
    while (bad - good > 1) {
      const c = (good + bad) >> 1;
      const out = await range(start, c);
      if (out.length > maxBytes) bad = c;
      else {
        good = c;
        best = out;
      }
    }
    parts.push(best);
    start += good;
  }
  return parts;
}

// ---------------------------------------------------------------- page geometry

/** Matrix from upright coordinates of the displayed page (origin bottom-left, y up) to user space. */
export function uprightMatrix(g: PageGeom): M {
  const { height } = viewSize(g);
  const o = viewToPdf(g, { x: 0, y: height });
  const px = viewToPdf(g, { x: 1, y: height });
  const py = viewToPdf(g, { x: 0, y: height - 1 });
  return [px.x - o.x, px.y - o.y, py.x - o.x, py.y - o.y, o.x, o.y];
}

/** How page content moved: user-space matrix, and the page rotation that was turned into content. */
export interface PageTransform {
  m: M;
  rot: number;
}

function mapRect(m: M, r: Rect): Rect {
  const pts = [apply(m, r.x, r.y), apply(m, r.x + r.w, r.y), apply(m, r.x, r.y + r.h), apply(m, r.x + r.w, r.y + r.h)];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** Move an annotation of the editing model along with its page's content. */
export function transformAnnotation(a: Annotation, t: PageTransform): Annotation {
  const pt = (p: Pt) => apply(t.m, p.x, p.y);
  const k = Math.sqrt(Math.abs(t.m[0] * t.m[3] - t.m[1] * t.m[2]));
  const out = { ...a } as Annotation & { rot?: number };
  if ('rect' in a) (out as { rect: Rect }).rect = mapRect(t.m, a.rect);
  if ('rects' in a) (out as { rects: Rect[] }).rects = a.rects.map((r) => mapRect(t.m, r));
  if ('paths' in a) (out as { paths: Pt[][] }).paths = a.paths.map((p) => p.map(pt));
  if ('vertices' in a) (out as { vertices: Pt[] }).vertices = a.vertices.map(pt);
  if ('p1' in a) Object.assign(out, { p1: pt(a.p1), p2: pt(a.p2) });
  if ('at' in a) (out as { at: Pt }).at = pt(a.at);
  if ('width' in a) (out as { width: number }).width = a.width * k;
  if ('fontSize' in a) (out as { fontSize: number }).fontSize = a.fontSize * k;
  if ('rot' in a && a.rot !== undefined && t.rot) out.rot = normRot(a.rot - t.rot);
  return out;
}

const box = (r: Rect) => [r.x, r.y, r.x + r.w, r.y + r.h];
const pairs = ['QuadPoints', 'Vertices', 'L', 'CL'];

/** Move the annotations still stored in the file (links, fields, …) along with the content. */
function transformFileAnnots(page: PDFPage, m: M) {
  const ctx = page.doc.context;
  const annots = page.node.lookupMaybe(N('Annots'), PDFArray);
  const nums = (a: PDFArray) => a.asArray().map((v) => (ctx.lookup(v) as PDFNumber | undefined)?.asNumber?.() ?? 0);
  const mapPairs = (a: PDFArray) => {
    const v = nums(a);
    const out: number[] = [];
    for (let k = 0; k + 1 < v.length; k += 2) {
      const p = apply(m, v[k], v[k + 1]);
      out.push(p.x, p.y);
    }
    return ctx.obj(out);
  };
  for (let k = 0; k < (annots?.size() ?? 0); k++) {
    const d = annots!.lookupMaybe(k, PDFDict);
    if (!d) continue;
    const r = d.lookupMaybe(N('Rect'), PDFArray);
    if (r) {
      const [x0, y0, x1, y1] = nums(r);
      d.set(N('Rect'), ctx.obj(box(mapRect(m, { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }))));
    }
    for (const key of pairs) {
      const a = d.lookupMaybe(N(key), PDFArray);
      if (a) d.set(N(key), mapPairs(a));
    }
    const ink = d.lookupMaybe(N('InkList'), PDFArray);
    if (ink) d.set(N('InkList'), ctx.obj(ink.asArray().map((p) => mapPairs(ctx.lookup(p) as PDFArray))));
  }
}

function pageBox(page: PDFPage, key: string): Rect | undefined {
  const a = page.node.getInheritableAttribute(N(key));
  const arr = a instanceof PDFRef ? page.doc.context.lookup(a) : a;
  if (!(arr instanceof PDFArray)) return undefined;
  const [x0, y0, x1, y1] = arr.asArray().map((v) => (page.doc.context.lookup(v) as PDFNumber).asNumber());
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

function setBox(page: PDFPage, key: string, r: Rect) {
  page.node.set(N(key), page.doc.context.obj(box(r)));
}

/** Transform a page's content by `m`, give it the new box (media = crop) and rotation. */
function transformPage(page: PDFPage, m: M, b: Rect, rotation: number) {
  addStream(page, writeContent([{ op: 'q', args: [] }, { op: 'cm', args: [...m] }]), 'front');
  addStream(page, '\nQ\n', 'back');
  for (const key of ['TrimBox', 'BleedBox', 'ArtBox']) {
    const r = pageBox(page, key);
    if (r) setBox(page, key, mapRect(m, r));
  }
  setBox(page, 'MediaBox', b);
  setBox(page, 'CropBox', b);
  page.setRotation(degrees(rotation));
  transformFileAnnots(page, m);
}

export type Anchor = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';
export const ANCHORS: Anchor[] = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];

function anchorFactors(a: Anchor): [number, number] {
  const ax = a.endsWith('left') ? 0 : a.endsWith('right') ? 1 : 0.5;
  const ay = a.startsWith('top') ? 0 : a.startsWith('bottom') ? 1 : 0.5;
  return [ax, ay];
}

/** Matrix and box that scale a page of geometry `g` to fit the displayed size W × H at the anchor. */
function fitTransform(g: PageGeom, W: number, H: number, anchor: Anchor): { m: M; box: Rect } {
  const vs = viewSize(g);
  const k = Math.min(W / vs.width, H / vs.height);
  const [ax, ay] = anchorFactors(anchor);
  const turned = normRot(g.rotation) % 180 !== 0;
  const b: Rect = { x: 0, y: 0, w: turned ? H : W, h: turned ? W : H };
  const ng: PageGeom = { view: [0, 0, b.w, b.h], rotation: g.rotation };
  const R = viewRectToPdf(ng, { left: (W - vs.width * k) * ax, top: (H - vs.height * k) * ay, width: vs.width * k, height: vs.height * k });
  return { m: [k, 0, 0, k, R.x - k * g.view[0], R.y - k * g.view[1]], box: b };
}

export interface ResizeOptions {
  /** Target size of the page as displayed, in points. */
  width: number;
  height: number;
  /** scale: scale the content to fit the new size; box: only change the page box, the content keeps its size. */
  mode: 'scale' | 'box';
  anchor: Anchor;
  /** Swap width and height for pages whose orientation differs. */
  matchOrientation: boolean;
}

export interface TransformResult {
  bytes: Uint8Array;
  /** Per page index: how its content moved, or null when it did not. */
  transforms: (PageTransform | null)[];
}

function targetSize(vs: { width: number; height: number }, W: number, H: number, matchOrientation: boolean): [number, number] {
  return matchOrientation && vs.width !== vs.height && W !== H && vs.width > vs.height !== W > H ? [H, W] : [W, H];
}

/** Change the size of pages, either scaling their content or just changing the page box. */
export async function resizePages(bytes: Uint8Array, indices: number[], o: ResizeOptions): Promise<TransformResult> {
  if (!(o.width >= 10 && o.height >= 10)) throw new Error('The page size is too small.');
  const doc = await load(bytes);
  const transforms: (PageTransform | null)[] = doc.getPages().map(() => null);
  for (const i of new Set(indices)) {
    const page = doc.getPage(i);
    const g = ops.geomOf(page);
    const vs = viewSize(g);
    const [W, H] = targetSize(vs, o.width, o.height, o.matchOrientation);
    if (o.mode === 'box') {
      const [ax, ay] = anchorFactors(o.anchor);
      const r = viewRectToPdf(g, { left: -(W - vs.width) * ax, top: -(H - vs.height) * ay, width: W, height: H });
      setBox(page, 'MediaBox', r);
      setBox(page, 'CropBox', r);
      continue;
    }
    const { m, box: b } = fitTransform(g, W, H, o.anchor);
    transformPage(page, m, b, g.rotation);
    transforms[i] = { m, rot: 0 };
  }
  return { bytes: await save(doc), transforms };
}

/** Add margins around pages (measured as displayed); the content stays where it is. */
export async function addMargins(bytes: Uint8Array, indices: number[], m: ops.Margins): Promise<Uint8Array> {
  const doc = await load(bytes);
  for (const i of new Set(indices)) {
    const page = doc.getPage(i);
    const g = ops.geomOf(page);
    const vs = viewSize(g);
    const r = viewRectToPdf(g, { left: -m.left, top: -m.top, width: vs.width + m.left + m.right, height: vs.height + m.top + m.bottom });
    if (r.w < 10 || r.h < 10) throw new Error(`Margins are larger than page ${i + 1}.`);
    const media = pageBox(page, 'MediaBox') ?? r;
    const x0 = Math.min(media.x, r.x);
    const y0 = Math.min(media.y, r.y);
    setBox(page, 'MediaBox', { x: x0, y: y0, w: Math.max(media.x + media.w, r.x + r.w) - x0, h: Math.max(media.y + media.h, r.y + r.h) - y0 });
    setBox(page, 'CropBox', r);
  }
  return save(doc);
}

export interface NormalizeOptions {
  /** Make the media box equal to the crop box, with its origin at (0, 0); drop trim, bleed and art boxes. */
  boxes: boolean;
  /** Turn the page rotation into the content, so pages look the same with /Rotate 0. */
  rotation: boolean;
  /** Scale pages to one size: that of the first or largest page, or a given displayed size. */
  size: 'none' | 'first' | 'largest' | 'smallest' | [number, number];
  /** With a common size: turn it for pages of the other orientation. */
  matchOrientation: boolean;
}

/** Normalise page boxes, rotation and size. */
export async function normalizePages(bytes: Uint8Array, indices: number[], o: NormalizeOptions): Promise<TransformResult> {
  const doc = await load(bytes);
  const pages = doc.getPages();
  const transforms: (PageTransform | null)[] = pages.map(() => null);
  const sel = [...new Set(indices)].sort((a, b) => a - b);
  if (!sel.length) return { bytes, transforms };
  const sizes = sel.map((i) => viewSize(ops.geomOf(pages[i])));
  const area = (s: { width: number; height: number }) => s.width * s.height;
  let target: [number, number] | null = null;
  if (Array.isArray(o.size)) target = o.size;
  else if (o.size !== 'none') {
    const pick = o.size === 'first' ? sizes[0] : sizes.reduce((a, b) => ((o.size === 'largest' ? area(b) > area(a) : area(b) < area(a)) ? b : a));
    target = [pick.width, pick.height];
  }
  for (const i of sel) {
    const page = pages[i];
    let g = ops.geomOf(page);
    const [x0, y0, x1, y1] = g.view;
    let m: M = [1, 0, 0, 1, 0, 0];
    let rot = 0;
    if (o.rotation && g.rotation) {
      m = inv(uprightMatrix(g))!;
      rot = g.rotation;
      const vs = viewSize(g);
      g = { view: [0, 0, vs.width, vs.height], rotation: 0 };
    } else if (o.boxes || target) {
      m = [1, 0, 0, 1, -x0, -y0];
      g = { view: [0, 0, x1 - x0, y1 - y0], rotation: g.rotation };
    }
    if (target) {
      const vs = viewSize(g);
      const [W, H] = targetSize(vs, target[0], target[1], o.matchOrientation);
      if (Math.abs(W - vs.width) > 0.01 || Math.abs(H - vs.height) > 0.01) {
        const fit = fitTransform(g, W, H, 'center');
        m = mul(m, fit.m);
        g = { view: [0, 0, fit.box.w, fit.box.h], rotation: g.rotation };
      }
    }
    const b: Rect = { x: 0, y: 0, w: g.view[2], h: g.view[3] };
    const identity = m.every((v, k) => Math.abs(v - [1, 0, 0, 1, 0, 0][k]) < 1e-9);
    if (!identity) {
      transformPage(page, m, b, g.rotation);
      transforms[i] = { m, rot };
    }
    if (o.boxes) {
      if (identity) {
        setBox(page, 'MediaBox', b);
        setBox(page, 'CropBox', b);
      }
      for (const key of ['TrimBox', 'BleedBox', 'ArtBox']) page.node.delete(N(key));
    }
  }
  return { bytes: await save(doc), transforms };
}

/** Bounding box of the non-white pixels of an RGBA image, or null when it is all white. */
export function contentBounds(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, threshold = 245): { left: number; top: number; right: number; bottom: number } | null {
  let [l, t, r, b] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      if (rgba[k + 3] > 0 && (rgba[k] < threshold || rgba[k + 1] < threshold || rgba[k + 2] < threshold)) {
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
      }
    }
  }
  return r < 0 ? null : { left: l, top: t, right: r + 1, bottom: b + 1 };
}

// ---------------------------------------------------------------- overlay

export interface OverlayOptions {
  /** Pages of this document to overlay. */
  pages: number[];
  /** Draw the other file's pages on top of the content or underneath it. */
  placement: 'over' | 'under';
  /** first: its first page on every page; cycle: its pages in turn, repeating; match: its page k on the k-th page, then stop. */
  mode: 'first' | 'cycle' | 'match';
  /** Scale the overlay page to fit the page (otherwise actual size), centred. */
  fit: boolean;
  opacity: number;
}

/** Overlay (or underlay) the pages of another PDF onto pages of this one, upright as displayed. */
export async function overlayPages(bytes: Uint8Array, other: Uint8Array, o: OverlayOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const src = await load(other);
  const srcPages = src.getPages();
  const targets = [...new Set(o.pages)].sort((a, b) => a - b);
  const embedded = new Map<number, Awaited<ReturnType<PDFDocument['embedPage']>>>();
  for (const [k, i] of targets.entries()) {
    const j = o.mode === 'first' ? 0 : o.mode === 'cycle' ? k % srcPages.length : k;
    if (j >= srcPages.length) break;
    const sp = srcPages[j];
    if (!embedded.has(j)) {
      const c = sp.getCropBox();
      embedded.set(j, await doc.embedPage(sp, { left: c.x, bottom: c.y, right: c.x + c.width, top: c.y + c.height }));
    }
    const form = embedded.get(j)!;
    const page = doc.getPage(i);
    const g = ops.geomOf(page);
    const vs = viewSize(g);
    // Form space is the overlay page's crop box moved to the origin; turn it upright first.
    const sg: PageGeom = { view: [0, 0, form.width, form.height], rotation: normRot(sp.getRotation().angle) };
    const svs = viewSize(sg);
    const k2 = o.fit ? Math.min(vs.width / svs.width, vs.height / svs.height) : 1;
    const place: M = [k2, 0, 0, k2, (vs.width - svs.width * k2) / 2, (vs.height - svs.height * k2) / 2];
    const m = mul(mul(inv(uprightMatrix(sg))!, place), uprightMatrix(g));
    const xo = page.node.newXObject('Ovl', form.ref);
    const opsList: Op[] = [{ op: 'q', args: [] }];
    if (o.opacity < 1) {
      const gs = page.node.newExtGState('GSo', doc.context.obj({ Type: 'ExtGState', CA: o.opacity, ca: o.opacity }));
      opsList.push({ op: 'gs', args: [{ t: 'name', v: gs.decodeText() }] });
    }
    opsList.push({ op: 'cm', args: [...m] }, { op: 'Do', args: [{ t: 'name', v: xo.decodeText() }] }, { op: 'Q', args: [] });
    if (o.placement === 'over') wrapContent(page);
    addStream(page, writeContent(opsList), o.placement === 'over' ? 'back' : 'front');
  }
  return save(doc);
}

// ---------------------------------------------------------------- removable page marks

/** Kinds of page marks, written as /Artifact <</Type /Pagination /Subtype /Kind>> marked content (as Acrobat and PDF-XChange do). */
export type MarkKind = 'Watermark' | 'Background' | 'Header' | 'Footer' | 'BatesN';

const markOpen = (kind: MarkKind) => enc.encode(`/Artifact <</Type /Pagination /Subtype /${kind}>> BDC\n`);
const markClose = enc.encode('\nEMC\n');

/**
 * Tag the content streams that `after` added to the pages of `before` as a
 * page mark of the given kind, optionally moving them behind the page content.
 */
export async function tagNewContent(before: Uint8Array, after: Uint8Array, kind: MarkKind, opts: { under?: boolean } = {}): Promise<Uint8Array> {
  const prev = (await load(before)).getPages().map((p) => new Set(contentRefs(p).map(String)));
  const doc = await load(after);
  const ctx = doc.context;
  for (const [i, page] of doc.getPages().entries()) {
    const known = prev[i] ?? new Set<string>();
    const added = contentRefs(page).filter((r) => !known.has(String(r)));
    const tagged: PDFRef[] = [];
    for (const ref of added) {
      const content = streamBytes(ctx.lookup(ref));
      // pdf-lib's shared q / Q wrapper streams are not part of the mark.
      if (content.length < 16 && /^\s*[qQ]?\s*$/.test(new TextDecoder().decode(content))) continue;
      ctx.assign(ref, ctx.flateStream(concat([markOpen(kind), content, markClose])));
      tagged.push(ref);
    }
    if (opts.under && tagged.length) {
      const rest = contentRefs(page).filter((r) => !tagged.includes(r));
      page.node.set(N('Contents'), ctx.obj([...tagged, ...rest]));
    }
  }
  return save(doc);
}

/** The mark kind of a BDC operator, if it opens one of ours (or Acrobat's / PDF-XChange's). */
function markKindOf(op: Op, properties: PDFDict | undefined): string | undefined {
  const [tag, props] = op.args;
  if (!tag || !isName(tag) || tag.v !== 'Artifact') return undefined;
  if (props && typeof props === 'object' && !Array.isArray(props) && props.t === 'dict') {
    const type = props.v.get('Type');
    const sub = props.v.get('Subtype');
    if (type && !(isName(type) && type.v === 'Pagination')) return undefined;
    return sub && isName(sub) ? sub.v : undefined;
  }
  if (props && isName(props)) {
    const d = properties?.lookupMaybe(N(props.v), PDFDict);
    const type = d?.lookup(N('Type'));
    if (type && type.toString() !== '/Pagination') return undefined;
    return d?.lookup(N('Subtype'))?.toString().slice(1);
  }
  return undefined;
}

/** Remove page marks of the given kinds. Returns the new bytes and the number of marks removed. */
export async function removePageMarks(bytes: Uint8Array, kinds: MarkKind[], pages?: number[]): Promise<{ bytes: Uint8Array; removed: number }> {
  const doc = await load(bytes);
  const ctx = doc.context;
  let removed = 0;
  const all = doc.getPages();
  for (const i of pages ?? all.map((_, k) => k)) {
    const page = all[i];
    if (!page) continue;
    const res = ctx.lookup(page.node.getInheritableAttribute(N('Resources')));
    const properties = res instanceof PDFDict ? res.lookupMaybe(N('Properties'), PDFDict) : undefined;
    let depth = 0; // > 0 while inside a mark being removed (spans streams)
    for (const ref of contentRefs(page)) {
      const list = parseContent(streamBytes(ctx.lookup(ref)));
      const kept: Op[] = [];
      let changed = false;
      for (const op of list) {
        if (depth) {
          if (op.op === 'BDC' || op.op === 'BMC') depth++;
          else if (op.op === 'EMC') depth--;
          changed = true;
          continue;
        }
        const kind = op.op === 'BDC' ? markKindOf(op, properties) : undefined;
        if (kind && (kinds as string[]).includes(kind)) {
          depth = 1;
          removed++;
          changed = true;
          continue;
        }
        kept.push(op);
      }
      if (changed) ctx.assign(ref, ctx.flateStream(writeContent(kept)));
    }
  }
  return { bytes: removed ? await save(doc) : bytes, removed };
}

/** Add a watermark (pdfOps.addWatermark) as a removable mark, optionally behind the page content. */
export async function addWatermarkMark(bytes: Uint8Array, o: ops.WatermarkOptions & { under?: boolean }): Promise<Uint8Array> {
  return tagNewContent(bytes, await ops.addWatermark(bytes, o), 'Watermark', { under: o.under });
}

export const POSITIONS: ops.Position[] = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];

export interface HeaderFooterSet {
  /** Text per position; supports the pdfOps.addHeaderFooter placeholders. */
  texts: Partial<Record<ops.Position, string>>;
  fontSize: number;
  color: string;
  margin: number;
  startNumber: number;
  pages: ops.PageSelection;
}

/** Add headers and footers at up to six positions, each a removable Header or Footer mark. */
export async function addHeadersFooters(bytes: Uint8Array, o: HeaderFooterSet): Promise<Uint8Array> {
  let out = bytes;
  for (const position of POSITIONS) {
    const template = o.texts[position]?.trim();
    if (!template) continue;
    const next = await ops.addHeaderFooter(out, { template, position, fontSize: o.fontSize, color: o.color, margin: o.margin, startNumber: o.startNumber, batesPrefix: '', batesDigits: 6, pages: o.pages });
    out = await tagNewContent(out, next, position.startsWith('top') ? 'Header' : 'Footer');
  }
  return out;
}

export interface BatesOptions {
  prefix: string;
  suffix: string;
  start: number;
  digits: number;
  position: ops.Position;
  fontSize: number;
  color: string;
  margin: number;
  pages: number[];
}

export function batesLabel(o: Pick<BatesOptions, 'prefix' | 'suffix' | 'digits'>, n: number): string {
  return o.prefix + String(n).padStart(o.digits, '0') + o.suffix;
}

/** Bates numbering: consecutive numbers over the given pages, as removable BatesN marks. */
export async function addBates(bytes: Uint8Array, o: BatesOptions): Promise<Uint8Array> {
  let out = bytes;
  let n = o.start;
  for (const run of runs(o.pages)) {
    // pdfOps numbers pages as startNumber + page index; {bates} is the prefixed, padded number.
    out = await ops.addHeaderFooter(out, {
      template: '{bates}' + o.suffix.replace(/[{}]/g, ''), position: o.position, fontSize: o.fontSize, color: o.color, margin: o.margin,
      startNumber: n - run[0], batesPrefix: o.prefix.replace(/\$/g, '$$$$'), batesDigits: o.digits, pages: run,
    });
    n += run.length;
  }
  return tagNewContent(bytes, out, 'BatesN');
}

export interface BackgroundOptions {
  pages: number[];
  /** Fill colour, or null for none. */
  color: string | null;
  image?: PageImage | null;
  /** Image size relative to the page: 1 fits it to the page. */
  scale: number;
  opacity: number;
}

/** Put a colour and/or image behind the content of pages, as a removable Background mark. */
export async function addBackground(bytes: Uint8Array, o: BackgroundOptions): Promise<Uint8Array> {
  if (!o.color && !o.image) throw new Error('Choose a colour or an image for the background.');
  const doc = await load(bytes);
  const img = o.image ? (o.image.png ? await doc.embedPng(o.image.data) : await doc.embedJpg(o.image.data)) : null;
  const name = (v: string): Operand => ({ t: 'name', v });
  for (const i of new Set(o.pages)) {
    const page = doc.getPage(i);
    const g = ops.geomOf(page);
    const list: Op[] = [{ op: 'q', args: [] }];
    if (o.opacity < 1) {
      const gs = page.node.newExtGState('GSb', doc.context.obj({ Type: 'ExtGState', CA: o.opacity, ca: o.opacity }));
      list.push({ op: 'gs', args: [name(gs.decodeText())] });
    }
    if (o.color) {
      const [x0, y0, x1, y1] = g.view;
      list.push({ op: 'rg', args: hexToRgbTuple(o.color) }, { op: 're', args: [x0, y0, x1 - x0, y1 - y0] }, { op: 'f', args: [] });
    }
    if (img) {
      const vs = viewSize(g);
      const k = Math.min(vs.width / img.width, vs.height / img.height) * o.scale;
      const w = img.width * k;
      const h = img.height * k;
      const m = mul([w, 0, 0, h, (vs.width - w) / 2, (vs.height - h) / 2], uprightMatrix(g));
      const xo = page.node.newXObject('BgImg', img.ref);
      list.push({ op: 'cm', args: [...m] }, { op: 'Do', args: [name(xo.decodeText())] });
    }
    list.push({ op: 'Q', args: [] });
    addStream(page, concat([markOpen('Background'), writeContent(list), markClose]), 'front');
  }
  return save(doc);
}

// ---------------------------------------------------------------- page labels

export type LabelStyle = 'D' | 'R' | 'r' | 'A' | 'a' | '';

export interface PageLabelRange {
  /** First page (0-based) the range applies to. */
  start: number;
  style: LabelStyle;
  prefix: string;
  /** Number of the range's first page. */
  first: number;
}

function roman(n: number): string {
  const table: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of table) while (n >= v) {
    out += s;
    n -= v;
  }
  return out;
}

/** The label of a page `offset` pages into a range (letters run A–Z, AA–ZZ, … as the PDF spec defines). */
export function formatPageLabel(r: Pick<PageLabelRange, 'style' | 'prefix' | 'first'>, offset: number): string {
  const n = r.first + offset;
  let num = '';
  if (r.style === 'D') num = String(n);
  else if (r.style === 'R') num = roman(n);
  else if (r.style === 'r') num = roman(n).toLowerCase();
  else if (r.style === 'A' || r.style === 'a') {
    const letter = String.fromCharCode(65 + ((n - 1) % 26));
    num = letter.repeat(Math.floor((n - 1) / 26) + 1);
    if (r.style === 'a') num = num.toLowerCase();
  }
  return r.prefix + num;
}

/** Labels of all `n` pages; pages before the first range get their page number. */
export function pageLabels(n: number, ranges: PageLabelRange[]): string[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  return Array.from({ length: n }, (_, i) => {
    const r = [...sorted].reverse().find((x) => x.start <= i);
    return r ? formatPageLabel(r, i - r.start) : String(i + 1);
  });
}

function collectNums(node: PDFDict | undefined, out: [number, PDFDict][], depth = 0) {
  if (!node || depth > 32) return;
  const nums = node.lookup(N('Nums'));
  if (nums instanceof PDFArray) {
    for (let k = 0; k + 1 < nums.size(); k += 2) {
      const key = nums.lookup(k);
      const val = nums.lookupMaybe(k + 1, PDFDict);
      if (key instanceof PDFNumber && val) out.push([key.asNumber(), val]);
    }
  }
  const kids = node.lookup(N('Kids'));
  if (kids instanceof PDFArray) for (let k = 0; k < kids.size(); k++) collectNums(kids.lookupMaybe(k, PDFDict), out, depth + 1);
}

export async function getPageLabels(bytes: Uint8Array): Promise<PageLabelRange[]> {
  const doc = await load(bytes);
  const entries: [number, PDFDict][] = [];
  collectNums(doc.catalog.lookupMaybe(N('PageLabels'), PDFDict), entries);
  return entries
    .map(([start, d]) => ({
      start,
      style: (d.lookup(N('S'))?.toString().slice(1) ?? '') as LabelStyle,
      prefix: text(d.lookup(N('P'))),
      first: (d.lookup(N('St')) as PDFNumber | undefined)?.asNumber?.() ?? 1,
    }))
    .sort((a, b) => a.start - b.start);
}

/** Write page labels (an empty list removes them). */
export async function setPageLabels(bytes: Uint8Array, ranges: PageLabelRange[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  const n = doc.getPageCount();
  const byStart = new Map<number, PageLabelRange>();
  for (const r of ranges) if (r.start >= 0 && r.start < n) byStart.set(r.start, r);
  const sorted = [...byStart.values()].sort((a, b) => a.start - b.start);
  if (!sorted.length) {
    doc.catalog.delete(N('PageLabels'));
    return save(doc);
  }
  if (sorted[0].start !== 0) sorted.unshift({ start: 0, style: 'D', prefix: '', first: 1 });
  const nums: PDFObject[] = [];
  for (const r of sorted) {
    const d = doc.context.obj({}) as PDFDict;
    if (r.style) d.set(N('S'), N(r.style));
    if (r.prefix) d.set(N('P'), PDFHexString.fromText(r.prefix));
    if (r.first !== 1) d.set(N('St'), doc.context.obj(Math.max(1, Math.round(r.first))));
    nums.push(doc.context.obj(r.start), d);
  }
  const tree = doc.context.obj({}) as PDFDict;
  tree.set(N('Nums'), doc.context.obj(nums));
  doc.catalog.set(N('PageLabels'), doc.context.register(tree));
  return save(doc);
}

// ---------------------------------------------------------------- duplicates

function hash(data: Uint8Array | string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  const len = data.length;
  for (let k = 0; k < len; k++) {
    const c = typeof data === 'string' ? data.charCodeAt(k) : data[k];
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** A structural hash of an object graph, independent of object numbers. */
function fingerprintOf(doc: PDFDocument, obj: PDFObject | undefined, memo: Map<string, string>, stack: Set<string>): string {
  if (obj instanceof PDFRef) {
    const key = obj.toString();
    if (memo.has(key)) return memo.get(key)!;
    if (stack.has(key)) return 'cycle';
    stack.add(key);
    const v = fingerprintOf(doc, doc.context.lookup(obj), memo, stack);
    stack.delete(key);
    memo.set(key, v);
    return v;
  }
  if (obj instanceof PDFStream) {
    return hash(fingerprintOf(doc, obj.dict, memo, stack) + '|' + hash(obj instanceof PDFRawStream ? obj.contents : streamBytes(obj)));
  }
  if (obj instanceof PDFDict) {
    const entries = obj.entries().filter(([k]) => !['/Parent', '/Length', '/P'].includes(k.toString()));
    return hash('<<' + entries.map(([k, v]) => k.toString() + ' ' + fingerprintOf(doc, v, memo, stack)).sort().join(' ') + '>>');
  }
  if (obj instanceof PDFArray) return '[' + obj.asArray().map((v) => fingerprintOf(doc, v, memo, stack)).join(' ') + ']';
  return obj ? obj.toString() : 'null';
}

/** Per page a hash of its content, resources, visible box and rotation: equal hashes mean identical pages. */
export async function pageFingerprints(bytes: Uint8Array): Promise<string[]> {
  const doc = await load(bytes);
  const memo = new Map<string, string>();
  return doc.getPages().map((p) => {
    const g = ops.geomOf(p);
    const res = fingerprintOf(doc, p.node.getInheritableAttribute(N('Resources')), memo, new Set());
    return hash([hash(pageContent(p)), res, g.view.map((v) => v.toFixed(2)).join(','), g.rotation].join('|'));
  });
}

/** Groups (of two or more indices) of items that are equal by key. */
export function groupEqual(keys: string[]): number[][] {
  const by = new Map<string, number[]>();
  keys.forEach((k, i) => (by.get(k) ?? by.set(k, []).get(k)!).push(i));
  return [...by.values()].filter((g) => g.length > 1);
}

/** Groups of pages with identical content. */
export async function findDuplicatePages(bytes: Uint8Array): Promise<number[][]> {
  return groupEqual(await pageFingerprints(bytes));
}

/** A size × size grey-level thumbnail (0–255) of an RGBA image, for visual comparison. */
export function grayThumb(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, size = 16): number[] {
  const sum = new Array(size * size).fill(0);
  const cnt = new Array(size * size).fill(0);
  for (let y = 0; y < height; y++) {
    const cy = Math.min(size - 1, Math.floor((y * size) / height));
    for (let x = 0; x < width; x++) {
      const cx = Math.min(size - 1, Math.floor((x * size) / width));
      const k = (y * width + x) * 4;
      sum[cy * size + cx] += 0.299 * rgba[k] + 0.587 * rgba[k + 1] + 0.114 * rgba[k + 2];
      cnt[cy * size + cx]++;
    }
  }
  return sum.map((s, k) => (cnt[k] ? s / cnt[k] : 255));
}

/** Groups of thumbnails whose mean grey-level difference is at most `tolerance` (0–255). */
export function groupSimilar(thumbs: number[][], tolerance = 2): number[][] {
  const parent = thumbs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let a = 0; a < thumbs.length; a++) {
    for (let b = a + 1; b < thumbs.length; b++) {
      if (thumbs[a].length !== thumbs[b].length || find(a) === find(b)) continue;
      const d = thumbs[a].reduce((s, v, k) => s + Math.abs(v - thumbs[b][k]), 0) / thumbs[a].length;
      if (d <= tolerance) parent[find(b)] = find(a);
    }
  }
  return groupEqual(parent.map((_, i) => String(find(i))));
}
