/**
 * Convert a document to greyscale: the colours in page content, form XObjects, tiling
 * patterns and comment appearances, axial and radial gradients, and images.
 *
 * Colours set with the device operators (rg, k…) and in RGB, CMYK and Lab colour spaces
 * become DeviceGray. Spot colours (Separation, DeviceN), patterns of other kinds and
 * colour palettes used for drawing (not images) are left as they are.
 */
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
} from '@cantoo/pdf-lib';
import { isName, name, parseContent, writeContent, type Op, type Operand } from './content/syntax';
import { isolatedImagePdf, readImage, softMasks, streamBytes, type ImageCodec, type ImageSource } from './optimize';

export type ColorKind = 'gray' | 'rgb' | 'cmyk' | 'lab';

export interface GreyscaleReport {
  /** Content streams (pages, forms, patterns, appearances) whose colours changed. */
  contentStreams: number;
  images: number;
  /** Images left in colour (formats that could not be decoded). */
  imagesKept: number;
  shadings: number;
}

const N = (k: string) => PDFName.of(k);
const numOf = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : undefined);
const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Perceived lightness of an RGB colour (components 0–1), as in Rec. 601 luma. */
export const luma = (r: number, g: number, b: number) => clamp(0.299 * r + 0.587 * g + 0.114 * b);

/** The grey value (0–1) of a colour in a colour space of the given kind. */
export function greyOf(kind: ColorKind, v: number[]): number | undefined {
  if (kind === 'gray' && v.length === 1) return clamp(v[0]);
  if (kind === 'rgb' && v.length === 3) return luma(v[0], v[1], v[2]);
  if (kind === 'cmyk' && v.length === 4) {
    const k = 1 - clamp(v[3]);
    return luma((1 - clamp(v[0])) * k, (1 - clamp(v[1])) * k, (1 - clamp(v[2])) * k);
  }
  if (kind === 'lab' && v.length === 3) return clamp(v[0] / 100);
  return undefined;
}

/** "#rrggbb" in grey (for comments held by the editor). */
export function greyHex(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const g = Math.round(luma(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) * 255);
  const h = g.toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
}

/** What kind of colours a colour space holds, or undefined for those left alone. */
export function colorKind(cs: PDFObject | undefined, ctx: PDFContext): ColorKind | undefined {
  const v = cs instanceof PDFRef ? ctx.lookup(cs) : cs;
  if (v instanceof PDFName) return deviceKind(v.decodeText());
  if (v instanceof PDFArray && v.size() >= 1) {
    const kind = ctx.lookup(v.get(0));
    if (!(kind instanceof PDFName)) return undefined;
    const k = kind.decodeText();
    if (k === 'CalRGB') return 'rgb';
    if (k === 'CalGray') return 'gray';
    if (k === 'Lab') return 'lab';
    if (k === 'ICCBased') {
      const s = ctx.lookup(v.get(1));
      const n = s instanceof PDFStream ? numOf(s.dict.lookup(N('N'))) : undefined;
      return n === 1 ? 'gray' : n === 3 ? 'rgb' : n === 4 ? 'cmyk' : undefined;
    }
  }
  return undefined;
}

function deviceKind(n: string): ColorKind | undefined {
  if (n === 'DeviceRGB' || n === 'RGB') return 'rgb';
  if (n === 'DeviceCMYK' || n === 'CMYK') return 'cmyk';
  if (n === 'DeviceGray' || n === 'G') return 'gray';
  return undefined;
}

// ---------------------------------------------------------------- content streams

const isNums = (args: Operand[]) => args.every((a) => typeof a === 'number');

/** Inline image data, if it is unfiltered 8-bit RGB or CMYK: as grey. */
function greyInline(op: Op): Op | undefined {
  const inl = op.inline;
  if (!inl) return undefined;
  const get = (...keys: string[]) => keys.map((k) => inl.dict.get(k)).find((v) => v !== undefined);
  const cs = get('CS', 'ColorSpace');
  const kind = cs && isName(cs) ? deviceKind(cs.v) : undefined;
  const bpc = get('BPC', 'BitsPerComponent');
  const w = get('W', 'Width');
  const h = get('H', 'Height');
  if ((kind !== 'rgb' && kind !== 'cmyk') || bpc !== 8 || get('F', 'Filter') !== undefined || get('D', 'Decode') !== undefined || typeof w !== 'number' || typeof h !== 'number') return undefined;
  const comps = kind === 'rgb' ? 3 : 4;
  if (inl.data.length < w * h * comps) return undefined;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const px = Array.from(inl.data.subarray(i * comps, i * comps + comps), (b) => b / 255);
    out[i] = Math.round(greyOf(kind, px)! * 255);
  }
  const dict = new Map(inl.dict);
  dict.delete('ColorSpace');
  dict.set('CS', name('G'));
  return { op: 'BI', args: [], inline: { dict, data: out } };
}

/**
 * Turn the colours of a content stream to grey. `named` gives the kind of a colour space
 * resource (the operand of cs/CS). Returns undefined when nothing changed.
 */
export function greyOps(ops: Op[], named: (resource: string) => ColorKind | undefined): Op[] | undefined {
  type Space = { kind?: ColorKind; converted: boolean };
  let fill: Space = { kind: 'gray', converted: false };
  let stroke: Space = { kind: 'gray', converted: false };
  const stack: [Space, Space][] = [];
  let changed = false;
  const out = ops.map((op): Op => {
    const a = op.args;
    switch (op.op) {
      case 'q':
        stack.push([fill, stroke]);
        return op;
      case 'Q':
        [fill, stroke] = stack.pop() ?? [fill, stroke];
        return op;
      case 'g':
      case 'G': {
        const s = { kind: 'gray' as const, converted: false };
        if (op.op === 'g') fill = s;
        else stroke = s;
        return op;
      }
      case 'rg':
      case 'RG':
      case 'k':
      case 'K': {
        const kind: ColorKind = op.op.toLowerCase() === 'rg' ? 'rgb' : 'cmyk';
        const grey = isNums(a) ? greyOf(kind, a as number[]) : undefined;
        const fillOp = op.op === op.op.toLowerCase();
        if (fillOp) fill = { kind: 'gray', converted: false };
        else stroke = { kind: 'gray', converted: false };
        if (grey === undefined) return op;
        changed = true;
        return { op: fillOp ? 'g' : 'G', args: [grey] };
      }
      case 'cs':
      case 'CS': {
        const n = a[0];
        const kind = n && isName(n) ? deviceKind(n.v) ?? (n.v === 'Pattern' ? undefined : named(n.v)) : undefined;
        const convert = kind === 'rgb' || kind === 'cmyk' || kind === 'lab';
        const s = { kind, converted: convert };
        if (op.op === 'cs') fill = s;
        else stroke = s;
        if (!convert) return op;
        changed = true;
        return { op: op.op, args: [name('DeviceGray')] };
      }
      case 'sc':
      case 'scn':
      case 'SC':
      case 'SCN': {
        const s = op.op.toLowerCase() === op.op ? fill : stroke;
        if (!s.converted || !s.kind || !isNums(a)) return op;
        const grey = greyOf(s.kind, a as number[]);
        if (grey === undefined) return op;
        return { op: op.op, args: [grey] };
      }
      case 'BI': {
        const g = greyInline(op);
        if (!g) return op;
        changed = true;
        return g;
      }
      default:
        return op;
    }
  });
  return changed ? out : undefined;
}

function resourceKinds(resources: PDFObject | undefined, ctx: PDFContext): (name: string) => ColorKind | undefined {
  const r = resources instanceof PDFRef ? ctx.lookup(resources) : resources;
  const spaces = r instanceof PDFDict ? r.lookup(N('ColorSpace')) : undefined;
  return (n) => (spaces instanceof PDFDict ? colorKind(spaces.get(N(n)), ctx) : undefined);
}

function greyStreamBytes(bytes: Uint8Array, resources: PDFObject | undefined, ctx: PDFContext): Uint8Array | undefined {
  let ops: Op[];
  try {
    ops = parseContent(bytes);
  } catch {
    return undefined;
  }
  const grey = greyOps(ops, resourceKinds(resources, ctx));
  return grey ? writeContent(grey) : undefined;
}

/** Replace a stream's data (keeping its other entries), Flate-compressed. */
function replaceStreamData(ctx: PDFContext, ref: PDFRef, old: PDFStream, data: Uint8Array) {
  const out = ctx.flateStream(data, {});
  for (const [k, v] of old.dict.entries()) {
    const key = k.decodeText();
    if (key !== 'Length' && key !== 'Filter' && key !== 'DecodeParms') out.dict.set(k, v);
  }
  out.dict.set(N('Filter'), N('FlateDecode'));
  ctx.assign(ref, out);
}

// ---------------------------------------------------------------- gradients

/** A copy of a function (sampled functions excepted) whose outputs are grey. */
function greyFunction(fn: PDFObject | undefined, kind: ColorKind, ctx: PDFContext, depth = 0): PDFObject | undefined {
  const f = fn instanceof PDFRef ? ctx.lookup(fn) : fn;
  if (!(f instanceof PDFDict) || depth > 8) return undefined;
  const type = numOf(f.lookup(N('FunctionType')));
  const nums = (o: PDFObject | undefined) => (o instanceof PDFArray ? o.asArray().map((x) => numOf(ctx.lookup(x)) ?? 0) : undefined);
  if (type === 2) {
    const c0 = nums(f.lookup(N('C0'))) ?? [0];
    const c1 = nums(f.lookup(N('C1'))) ?? [1];
    const g0 = greyOf(kind, c0);
    const g1 = greyOf(kind, c1);
    if (g0 === undefined || g1 === undefined) return undefined;
    const out = f.clone(ctx);
    out.set(N('C0'), ctx.obj([g0]));
    out.set(N('C1'), ctx.obj([g1]));
    out.delete(N('Range'));
    return out;
  }
  if (type === 3) {
    const parts = f.lookup(N('Functions'));
    if (!(parts instanceof PDFArray)) return undefined;
    const converted = parts.asArray().map((p) => greyFunction(p, kind, ctx, depth + 1));
    if (converted.some((c) => !c)) return undefined;
    const out = f.clone(ctx);
    out.set(N('Functions'), ctx.obj(converted as PDFObject[]));
    out.delete(N('Range'));
    return out;
  }
  return undefined;
}

/** Turn a shading dictionary (axial, radial or function-based) to grey; false if it cannot. */
function greyShading(d: PDFDict, ctx: PDFContext): boolean {
  const type = numOf(d.lookup(N('ShadingType')));
  if (type === undefined || type > 3) return false;
  const kind = colorKind(d.get(N('ColorSpace')), ctx);
  if (!kind || kind === 'gray') return false;
  const fn = greyFunction(d.get(N('Function')), kind, ctx);
  if (!fn) return false;
  d.set(N('Function'), fn);
  d.set(N('ColorSpace'), N('DeviceGray'));
  const bg = d.lookup(N('Background'));
  if (bg instanceof PDFArray) {
    const g = greyOf(kind, bg.asArray().map((x) => numOf(ctx.lookup(x)) ?? 0));
    if (g === undefined) d.delete(N('Background'));
    else d.set(N('Background'), ctx.obj([g]));
  }
  return true;
}

/** Every dictionary reachable inside the indirect objects (for direct shadings). */
function* dictsOf(doc: PDFDocument): Generator<PDFDict> {
  const seen = new Set<PDFObject>();
  const stack: PDFObject[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) stack.push(obj);
  while (stack.length) {
    const o = stack.pop()!;
    if (seen.has(o)) continue;
    seen.add(o);
    if (o instanceof PDFStream) stack.push(o.dict);
    else if (o instanceof PDFDict) {
      yield o;
      for (const [, v] of o.entries()) if (!(v instanceof PDFRef)) stack.push(v);
    } else if (o instanceof PDFArray) for (const v of o.asArray()) if (!(v instanceof PDFRef)) stack.push(v);
  }
}

// ---------------------------------------------------------------- images

const toGreyPixels = (rgb: Uint8Array, n: number) => {
  const out = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 3) out[i] = Math.round(0.299 * rgb[j] + 0.587 * rgb[j + 1] + 0.114 * rgb[j + 2]);
  return out;
};

const greyAsRgb = (grey: Uint8Array) => {
  const out = new Uint8Array(grey.length * 3);
  for (let i = 0, j = 0; i < grey.length; i++, j += 3) out[j] = out[j + 1] = out[j + 2] = grey[i];
  return out;
};

const IMAGE_KEYS_TO_DROP = ['Filter', 'DecodeParms', 'Length', 'Decode', 'BitsPerComponent', 'ColorSpace', 'Width', 'Height', 'Intent'];

/** Convert one image: 'grey' when it already was, 'kept' when it could not be decoded. */
async function greyImage(ctx: PDFContext, ref: PDFRef, stream: PDFRawStream, codec: ImageCodec): Promise<'converted' | 'grey' | 'kept'> {
  const { dict } = stream;
  if (dict.lookup(N('ImageMask'))?.toString() === 'true') return 'grey';
  const cs = dict.get(N('ColorSpace'));
  const kind = colorKind(cs, ctx);
  // Already grey (or black and white, or JPX without a colour space that says otherwise).
  if (kind === 'gray') return 'grey';
  let src: ImageSource | undefined;
  const read = readImage(stream);
  if (read) src = read.src;
  else src = await isolatedImagePdf(stream).catch(() => undefined);
  if (!src) return 'kept';
  const { width, height } = src;
  let rgb: Uint8Array | null = 'rgb' in src ? src.rgb : null;
  if (!rgb && codec.decodeRgb) rgb = await codec.decodeRgb(src, width, height).catch(() => null);
  if (!rgb || rgb.length < width * height * 3) return 'kept';
  const grey = toGreyPixels(rgb, width * height);
  const out = dict.clone(ctx);
  for (const k of IMAGE_KEYS_TO_DROP) out.delete(N(k));
  out.set(N('Width'), PDFNumber.of(width));
  out.set(N('Height'), PDFNumber.of(height));
  out.set(N('BitsPerComponent'), PDFNumber.of(8));
  // Photographs stay JPEG (a lossless grey copy would be several times bigger).
  if ('jpeg' in src || ('pdf' in src && /DCT|JPX/.test(dict.lookup(N('Filter'))?.toString() ?? ''))) {
    const jpeg = await codec.encodeJpeg({ rgb: greyAsRgb(grey), width, height }, width, height, 0.9).catch(() => null);
    if (!jpeg) return 'kept';
    out.set(N('Filter'), N('DCTDecode'));
    out.set(N('ColorSpace'), N('DeviceRGB'));
    ctx.assign(ref, PDFRawStream.of(out, jpeg));
    return 'converted';
  }
  const flate = ctx.flateStream(grey, {});
  for (const [k, v] of out.entries()) flate.dict.set(k, v);
  flate.dict.set(N('Filter'), N('FlateDecode'));
  flate.dict.set(N('ColorSpace'), N('DeviceGray'));
  ctx.assign(ref, flate);
  return 'converted';
}

// ---------------------------------------------------------------- the whole document

function pageContent(page: ReturnType<PDFDocument['getPages']>[number], ctx: PDFContext): Uint8Array | undefined {
  const c = page.node.Contents();
  const list = c instanceof PDFArray ? c.asArray().map((r) => ctx.lookup(r)) : [c];
  const parts: Uint8Array[] = [];
  for (const s of list) {
    if (!(s instanceof PDFStream)) continue;
    const b = streamBytes(s);
    if (!b) return undefined;
    parts.push(b, new Uint8Array([10]));
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return all;
}

/** Convert a loaded document to greyscale in place. */
export async function convertToGreyscale(doc: PDFDocument, codec: ImageCodec, progress?: (done: number, total: number) => void): Promise<GreyscaleReport> {
  const ctx = doc.context;
  const report: GreyscaleReport = { contentStreams: 0, images: 0, imagesKept: 0, shadings: 0 };
  await doc.flush();

  // Page content.
  for (const page of doc.getPages()) {
    const bytes = pageContent(page, ctx);
    if (!bytes) continue;
    const res = page.node.Resources() ?? (page.node.getInheritableAttribute(N('Resources')) as PDFDict | undefined);
    const grey = greyStreamBytes(bytes, res, ctx);
    if (!grey) continue;
    page.node.set(N('Contents'), ctx.register(ctx.flateStream(grey)));
    report.contentStreams++;
  }

  // Form XObjects (also comment and field appearances) and tiling patterns; images collected.
  const masks = softMasks(ctx);
  const images: [PDFRef, PDFRawStream][] = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFStream)) continue;
    const sub = obj.dict.lookup(N('Subtype'));
    if (sub === N('Image')) {
      if (obj instanceof PDFRawStream && !masks.has(ref.toString())) images.push([ref, obj]);
      continue;
    }
    if (sub !== N('Form') && numOf(obj.dict.lookup(N('PatternType'))) !== 1) continue;
    const bytes = streamBytes(obj);
    if (!bytes) continue;
    const grey = greyStreamBytes(bytes, obj.dict.get(N('Resources')), ctx);
    if (!grey) continue;
    replaceStreamData(ctx, ref, obj, grey);
    report.contentStreams++;
  }

  // Gradients, and the colours other viewers use to redraw comments.
  for (const d of dictsOf(doc)) {
    if (d.has(N('ShadingType')) && greyShading(d, ctx)) report.shadings++;
    if (d.lookup(N('Type')) === N('Annot') || (d.has(N('Subtype')) && d.has(N('Rect')) && d.has(N('C')))) {
      for (const key of ['C', 'IC']) {
        const c = d.lookup(N(key));
        if (!(c instanceof PDFArray) || (c.size() !== 3 && c.size() !== 4)) continue;
        const v = c.asArray().map((x) => numOf(ctx.lookup(x)) ?? 0);
        const g = greyOf(v.length === 3 ? 'rgb' : 'cmyk', v);
        if (g !== undefined) d.set(N(key), ctx.obj([g]));
      }
    }
  }

  for (let i = 0; i < images.length; i++) {
    progress?.(i, images.length);
    const [ref, stream] = images[i];
    const r = await greyImage(ctx, ref, stream, codec).catch(() => 'kept' as const);
    if (r === 'converted') report.images++;
    else if (r === 'kept') report.imagesKept++;
  }
  progress?.(images.length, images.length);
  return report;
}
