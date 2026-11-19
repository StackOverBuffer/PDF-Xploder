/**
 * Optimize (compress) a whole document: recompress and downsample its images, merge
 * identical streams, compress streams that were stored uncompressed, and drop
 * metadata, page thumbnails and other programs' private data. Objects nothing refers
 * to are left out and object streams are written when the document is saved (saveDoc).
 *
 * Images are decoded and encoded by an ImageCodec, so that this runs in the browser
 * (canvas) as well as in tests and in Node.
 */
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFDocument,
  PDFObjectCopier,
  type PDFContext,
  type PDFObject,
} from '@cantoo/pdf-lib';
import { isName, parseContent } from './content/syntax';
import { IDENTITY, mul, type M } from './content/matrix';
import { isPdfA1, saveDoc } from './pdfSave';

export interface OptimizeOptions {
  /** Re-encode images as JPEG at this quality (0–1); undefined leaves image encoding alone. */
  jpegQuality?: number;
  /** Downsample images shown above this resolution (pixels per inch on the page); undefined keeps every pixel. */
  maxDpi?: number;
  /** Remove the document information, XMP metadata and other programs' private data (/PieceInfo). */
  removeMetadata?: boolean;
  /** Remove embedded page thumbnails (viewers draw their own). */
  removeThumbnails?: boolean;
  /** Merge identical streams (fonts and images a merged document holds several times). */
  mergeDuplicates?: boolean;
  /** Compress streams stored without compression. */
  compressStreams?: boolean;
  /**
   * Also re-encode images only a full PDF renderer can read (CMYK, JPEG 2000, 16 bits…).
   * These become RGB JPEGs, so print workflows that need CMYK should leave this off.
   */
  convertOtherImages?: boolean;
}

/**
 * Image pixels to encode: a JPEG file as stored in the PDF, 8-bit RGB pixels, or (for
 * images in other formats) a one-page PDF whose page, `width` × `height` points, the
 * image fills, to be drawn by a PDF renderer.
 */
export type ImageSource =
  | { jpeg: Uint8Array; width: number; height: number }
  | { rgb: Uint8Array; width: number; height: number }
  | { pdf: Uint8Array; width: number; height: number };

export interface ImageCodec {
  /** Encode the image as a (three-channel) JPEG of the given size, or return null if it cannot. */
  encodeJpeg(src: ImageSource, width: number, height: number, quality: number): Promise<Uint8Array | null>;
}

export interface OptimizeReport {
  before: number;
  after: number;
  imagesRecompressed: number;
  imagesDownsampled: number;
  /** Images left as they were (unsupported format, or no smaller when re-encoded). */
  imagesKept: number;
  duplicatesMerged: number;
  streamsCompressed: number;
  metadataRemoved: boolean;
  /** Metadata was asked to be removed but kept, because the file claims PDF/A conformance. */
  keptForPdfA: boolean;
}

export const PRESETS = {
  /** Screen reading: small files, images at 100 ppi. */
  small: { jpegQuality: 0.6, maxDpi: 100, convertOtherImages: true },
  /** Good on screen and in office printing. */
  balanced: { jpegQuality: 0.75, maxDpi: 150, convertOtherImages: true },
  /** High-quality printing. */
  print: { jpegQuality: 0.85, maxDpi: 300 },
} satisfies Record<string, OptimizeOptions>;

const N = (k: string) => PDFName.of(k);
const num = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : undefined);

// ---------------------------------------------------------------- where images are shown

/**
 * The largest size (in points, width and height) each image XObject is shown at on the
 * pages, including inside Form XObjects. Images used elsewhere only (annotation
 * appearances, patterns) are not in the map.
 */
export function imageDisplaySizes(doc: PDFDocument): Map<string, { w: number; h: number }> {
  const sizes = new Map<string, { w: number; h: number }>();
  const ctx = doc.context;
  const walk = (content: Uint8Array, resources: PDFDict | undefined, ctm0: M, depth: number, seen: Set<string>) => {
    let ops;
    try {
      ops = parseContent(content);
    } catch {
      return;
    }
    const xobjs = resources?.lookup(N('XObject'));
    const stack: M[] = [];
    let ctm = ctm0;
    for (const op of ops) {
      if (op.op === 'q') stack.push(ctm);
      else if (op.op === 'Q') ctm = stack.pop() ?? ctm0;
      else if (op.op === 'cm' && op.args.length === 6 && op.args.every((a) => typeof a === 'number')) ctm = mul(op.args as M, ctm);
      else if (op.op === 'Do' && isName(op.args[0]) && xobjs instanceof PDFDict) {
        const ref = xobjs.get(N(op.args[0].v));
        const x = ctx.lookup(ref);
        if (!(x instanceof PDFStream)) continue;
        const sub = x.dict.lookup(N('Subtype'));
        if (sub === N('Image') && ref instanceof PDFRef) {
          // The image fills the unit square: its shown size is the length of the CTM's axes.
          const w = Math.hypot(ctm[0], ctm[1]);
          const h = Math.hypot(ctm[2], ctm[3]);
          const key = ref.toString();
          const old = sizes.get(key);
          sizes.set(key, { w: Math.max(w, old?.w ?? 0), h: Math.max(h, old?.h ?? 0) });
        } else if (sub === N('Form') && depth < 12) {
          const key = ref instanceof PDFRef ? ref.toString() : '';
          if (key && seen.has(key)) continue;
          const mat = x.dict.lookup(N('Matrix'));
          const fm = mat instanceof PDFArray && mat.size() === 6 ? (mat.asArray().map((v) => num(ctx.lookup(v)) ?? 0) as M) : IDENTITY;
          const res = x.dict.lookup(N('Resources'));
          const inner = new Set(seen);
          if (key) inner.add(key);
          const bytes = streamBytes(x);
          if (bytes) walk(bytes, res instanceof PDFDict ? res : resources, mul(fm, ctm), depth + 1, inner);
        }
      }
    }
  };
  for (const page of doc.getPages()) {
    const c = page.node.Contents();
    const parts: Uint8Array[] = [];
    const list = c instanceof PDFArray ? c.asArray().map((r) => ctx.lookup(r)) : [c];
    for (const s of list) {
      const b = s instanceof PDFStream ? streamBytes(s) : undefined;
      if (b) parts.push(b, new Uint8Array([10]));
    }
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    const res = page.node.Resources() ?? (page.node.getInheritableAttribute(N('Resources')) as PDFDict | undefined);
    walk(all, res, IDENTITY, 0, new Set());
  }
  return sizes;
}

/** A stream's decoded contents, or undefined if a filter is not supported. */
function streamBytes(s: PDFStream): Uint8Array | undefined {
  try {
    if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
    const unencoded = (s as { getUnencodedContents?: () => Uint8Array }).getUnencodedContents;
    return unencoded ? unencoded.call(s) : s.getContents();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- reading image pixels

const filtersOf = (dict: PDFDict): string[] => {
  const f = dict.lookup(N('Filter'));
  if (f instanceof PDFName) return [f.decodeText()];
  if (f instanceof PDFArray) return f.asArray().map((v) => (dict.context.lookup(v) instanceof PDFName ? (dict.context.lookup(v) as PDFName).decodeText() : '?'));
  return [];
};

/** Undo the PNG predictors (Predictor ≥ 10) of Flate/LZW-compressed image data. */
export function unpredict(data: Uint8Array, columns: number, colors: number, bpc: number): Uint8Array | undefined {
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((columns * colors * bpc) / 8);
  const rows = Math.floor(data.length / (rowLen + 1));
  if (rows === 0) return undefined;
  const out = new Uint8Array(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLen + 1)];
    const src = r * (rowLen + 1) + 1;
    const dst = r * rowLen;
    const up = dst - rowLen;
    for (let i = 0; i < rowLen; i++) {
      const raw = data[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = r > 0 ? out[up + i] : 0;
      const c = r > 0 && i >= bpp ? out[up + i - bpp] : 0;
      let v: number;
      switch (type) {
        case 0: v = raw; break;
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: return undefined;
      }
      out[dst + i] = v & 255;
    }
  }
  return out;
}

interface ColorModel {
  /** Components per pixel in the image data. */
  comps: number;
  /** Turn one pixel's component values (0–255 scaled, or palette indices) into RGB. */
  toRgb: (src: Uint8Array, at: number, out: Uint8Array, o: number) => void;
  /** The colour space to keep when the image is stored as RGB (otherwise DeviceRGB). */
  keep?: PDFObject;
}

/** Colour spaces that can be shown as RGB without colour management: gray, RGB, their ICC versions, and palettes of those. */
function colorModel(cs: PDFObject | undefined, ctx: PDFContext, bpc: number): ColorModel | undefined {
  const base = (o: PDFObject | undefined): { n: 1 | 3; raw?: PDFObject } | undefined => {
    const v = o instanceof PDFRef ? ctx.lookup(o) : o;
    if (v === N('DeviceGray') || v === N('G')) return { n: 1 };
    if (v === N('DeviceRGB') || v === N('RGB')) return { n: 3 };
    if (v instanceof PDFArray && v.size() >= 2) {
      const kind = ctx.lookup(v.get(0));
      if (kind === N('ICCBased')) {
        const s = ctx.lookup(v.get(1));
        const n = s instanceof PDFStream ? num(s.dict.lookup(N('N'))) : undefined;
        if (n === 1 || n === 3) return { n, raw: o };
      }
      if (kind === N('CalRGB')) return { n: 3 };
      if (kind === N('CalGray')) return { n: 1 };
    }
    return undefined;
  };
  const direct = base(cs);
  if (direct) {
    if (bpc !== 8) return undefined;
    return direct.n === 3
      ? { comps: 3, keep: direct.raw ?? N('DeviceRGB'), toRgb: (s, a, out, o) => { out[o] = s[a]; out[o + 1] = s[a + 1]; out[o + 2] = s[a + 2]; } }
      : { comps: 1, toRgb: (s, a, out, o) => { out[o] = out[o + 1] = out[o + 2] = s[a]; } };
  }
  const arr = cs instanceof PDFRef ? ctx.lookup(cs) : cs;
  if (arr instanceof PDFArray && arr.size() === 4 && (ctx.lookup(arr.get(0)) === N('Indexed') || ctx.lookup(arr.get(0)) === N('I'))) {
    const b = base(arr.get(1));
    const hival = num(ctx.lookup(arr.get(2)));
    const lookup = ctx.lookup(arr.get(3));
    if (!b || hival === undefined) return undefined;
    let table: Uint8Array | undefined;
    if (lookup instanceof PDFStream) table = streamBytes(lookup);
    else if (lookup && 'asBytes' in lookup) table = (lookup as unknown as { asBytes(): Uint8Array }).asBytes();
    if (!table || table.length < (hival + 1) * b.n) return undefined;
    const pal = new Uint8Array(256 * 3);
    for (let i = 0; i <= Math.min(255, hival); i++) {
      for (let k = 0; k < 3; k++) pal[i * 3 + k] = table[i * b.n + (b.n === 3 ? k : 0)];
    }
    return { comps: 1, toRgb: (s, a, out, o) => { const i = Math.min(s[a], hival) * 3; out[o] = pal[i]; out[o + 1] = pal[i + 1]; out[o + 2] = pal[i + 2]; } };
  }
  return undefined;
}

/** Unpack samples of 1, 2 or 4 bits (rows padded to whole bytes) into one byte each. */
function unpack(data: Uint8Array, width: number, height: number, comps: number, bpc: number): Uint8Array {
  if (bpc === 8) return data;
  const rowLen = Math.ceil((width * comps * bpc) / 8);
  const out = new Uint8Array(width * height * comps);
  const mask = (1 << bpc) - 1;
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < width * comps; i++) {
      const bit = i * bpc;
      out[y * width * comps + i] = (data[y * rowLen + (bit >> 3)] >> (8 - bpc - (bit & 7))) & mask;
    }
  }
  return out;
}

interface ReadImage {
  src: ImageSource;
  /** The colour space to write with an RGB JPEG. */
  colorSpace: PDFObject;
}

/**
 * A one-page PDF showing only this image, at one point per pixel, for images that
 * readImage cannot decode itself. Not for masks and 1-bit images, which stay lossless.
 */
export async function isolatedImagePdf(stream: PDFRawStream): Promise<ImageSource | undefined> {
  const { dict } = stream;
  if (dict.lookup(N('ImageMask'))?.toString() === 'true') return undefined;
  if (dict.has(N('Mask')) && !(dict.lookup(N('Mask')) instanceof PDFStream)) return undefined;
  if (dict.has(N('SMaskInData')) && num(dict.lookup(N('SMaskInData'))) !== 0) return undefined;
  const width = num(dict.lookup(N('Width')));
  const height = num(dict.lookup(N('Height')));
  const bpc = num(dict.lookup(N('BitsPerComponent')));
  const filters = filtersOf(dict);
  // JBIG2 and CCITT hold black-and-white scans: JPEG would be bigger and blurred.
  if (!width || !height || bpc === 1 || filters.some((f) => f === 'JBIG2Decode' || f === 'CCITTFaxDecode' || f === 'CCF')) return undefined;
  const out = await PDFDocument.create();
  const copy = dict.clone(dict.context);
  for (const k of ['SMask', 'Mask', 'Metadata', 'OC', 'Alternates', 'StructParent', 'ID', 'OPI', 'PieceInfo']) copy.delete(N(k));
  const img = PDFObjectCopier.for(dict.context, out.context).copy(PDFRawStream.of(copy, stream.contents));
  const page = out.addPage([width, height]);
  const name = page.node.newXObject('Im', out.context.register(img));
  page.node.set(N('Contents'), out.context.register(out.context.stream(`q ${width} 0 0 ${height} 0 0 cm ${name.asString()} Do Q`)));
  return { pdf: await out.save({ useObjectStreams: false }), width, height };
}

/** An image XObject's pixels, if it is one this can re-encode faithfully. */
function readImage(stream: PDFRawStream): ReadImage | undefined {
  const { dict } = stream;
  const ctx = dict.context;
  if (dict.lookup(N('ImageMask'))?.toString() === 'true') return undefined;
  // Colour-key masks need exact colours, which JPEG does not keep. Custom /Decode arrays are rare: skip them.
  if (dict.has(N('Mask')) && !(dict.lookup(N('Mask')) instanceof PDFStream)) return undefined;
  if (dict.has(N('Decode'))) return undefined;
  const width = num(dict.lookup(N('Width')));
  const height = num(dict.lookup(N('Height')));
  const bpc = num(dict.lookup(N('BitsPerComponent'))) ?? 8;
  if (!width || !height) return undefined;
  const filters = filtersOf(dict);
  const cs = dict.get(N('ColorSpace'));
  if (filters.length === 1 && (filters[0] === 'DCTDecode' || filters[0] === 'DCT')) {
    const m = colorModel(cs, ctx, 8);
    // Palettes cannot be JPEG; CMYK JPEGs decode inconsistently in browsers.
    if (!m || m.comps === 1 && !isGray(cs, ctx)) return undefined;
    return { src: { jpeg: stream.getContents(), width, height }, colorSpace: m.keep ?? N('DeviceRGB') };
  }
  if (filters.some((f) => !['FlateDecode', 'Fl', 'LZWDecode', 'LZW', 'ASCII85Decode', 'A85', 'ASCIIHexDecode', 'AHx', 'RunLengthDecode', 'RL'].includes(f))) return undefined;
  const isIndexed = !isGray(cs, ctx) && colorModel(cs, ctx, 8)?.comps === 1;
  const m = colorModel(cs, ctx, isIndexed ? 8 : bpc);
  if (!m || ![1, 2, 4, 8].includes(bpc) || (bpc !== 8 && !isIndexed)) return undefined;
  let data: Uint8Array;
  try {
    data = decodePDFRawStream(stream).decode();
  } catch {
    return undefined;
  }
  const parms = dict.lookup(N('DecodeParms'));
  const pd = parms instanceof PDFDict ? parms : parms instanceof PDFArray ? (parms.asArray().map((p) => ctx.lookup(p)).find((p) => p instanceof PDFDict) as PDFDict | undefined) : undefined;
  const predictor = num(pd?.lookup(N('Predictor'))) ?? 1;
  if (predictor >= 10) {
    const un = unpredict(data, num(pd?.lookup(N('Columns'))) ?? width, num(pd?.lookup(N('Colors'))) ?? m.comps, num(pd?.lookup(N('BitsPerComponent'))) ?? bpc);
    if (!un) return undefined;
    data = un;
  } else if (predictor !== 1) return undefined;
  const need = Math.ceil((width * m.comps * bpc) / 8) * height;
  if (data.length < need) return undefined;
  const samples = unpack(data, width, height, m.comps, bpc);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += 3) m.toRgb(samples, i * m.comps, rgb, j);
  return { src: { rgb, width, height }, colorSpace: m.comps === 3 ? (m.keep ?? N('DeviceRGB')) : N('DeviceRGB') };
}

function isGray(cs: PDFObject | undefined, ctx: PDFContext): boolean {
  const v = cs instanceof PDFRef ? ctx.lookup(cs) : cs;
  if (v === N('DeviceGray') || v === N('G')) return true;
  if (v instanceof PDFArray && v.size() >= 2) {
    const kind = ctx.lookup(v.get(0));
    if (kind === N('CalGray')) return true;
    if (kind === N('ICCBased')) {
      const s = ctx.lookup(v.get(1));
      return s instanceof PDFStream && num(s.dict.lookup(N('N'))) === 1;
    }
  }
  return false;
}

// ---------------------------------------------------------------- the steps

/** Images that are another image's soft mask: these stay lossless. */
function softMasks(ctx: PDFContext): Set<string> {
  const out = new Set<string>();
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFStream)) continue;
    for (const k of ['SMask', 'Mask']) {
      const r = obj.dict.get(N(k));
      if (r instanceof PDFRef) out.add(r.toString());
    }
  }
  return out;
}

async function recompressImages(
  doc: PDFDocument,
  o: OptimizeOptions,
  codec: ImageCodec,
  report: OptimizeReport,
  progress?: (done: number, total: number) => void,
) {
  const ctx = doc.context;
  const shown = o.maxDpi ? imageDisplaySizes(doc) : new Map<string, { w: number; h: number }>();
  const masks = softMasks(ctx);
  const images: [PDFRef, PDFRawStream][] = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.lookup(N('Subtype')) === N('Image') && !masks.has(ref.toString())) images.push([ref, obj]);
  }
  const quality = o.jpegQuality ?? 0.85;
  for (let i = 0; i < images.length; i++) {
    progress?.(i, images.length);
    const [ref, stream] = images[i];
    let img = readImage(stream);
    if (!img && o.convertOtherImages) {
      const src = await isolatedImagePdf(stream).catch(() => undefined);
      if (src) img = { src, colorSpace: N('DeviceRGB') };
    }
    if (!img) {
      report.imagesKept++;
      continue;
    }
    const { width, height } = img.src;
    // Below this the gain is nothing, and JPEG blurs small icons.
    if (width * height < 64 * 64) {
      report.imagesKept++;
      continue;
    }
    let w = width;
    let h = height;
    const size = shown.get(ref.toString());
    if (o.maxDpi && size && size.w > 0 && size.h > 0) {
      const dpi = Math.min((width * 72) / size.w, (height * 72) / size.h);
      // Leave a margin, as other tools do: an image a little above the limit is not worth a lossy pass.
      if (dpi > o.maxDpi * 1.2) {
        const k = o.maxDpi / dpi;
        w = Math.max(1, Math.round(width * k));
        h = Math.max(1, Math.round(height * k));
      }
    }
    const downsampled = w !== width || h !== height;
    // A JPEG kept at full size is re-encoded only when a quality was asked for.
    if (!downsampled && o.jpegQuality === undefined) {
      report.imagesKept++;
      continue;
    }
    let jpeg: Uint8Array | null = null;
    try {
      jpeg = await codec.encodeJpeg(img.src, w, h, quality);
    } catch {
      jpeg = null;
    }
    // Keep the original unless the new one is clearly smaller.
    if (!jpeg || jpeg.length > stream.contents.length * 0.9) {
      report.imagesKept++;
      continue;
    }
    const dict = stream.dict.clone(ctx);
    for (const k of ['Filter', 'DecodeParms', 'Length', 'Decode', 'BitsPerComponent', 'ColorSpace', 'Width', 'Height']) dict.delete(N(k));
    dict.set(N('Filter'), N('DCTDecode'));
    dict.set(N('Width'), PDFNumber.of(w));
    dict.set(N('Height'), PDFNumber.of(h));
    dict.set(N('BitsPerComponent'), PDFNumber.of(8));
    dict.set(N('ColorSpace'), img.colorSpace);
    ctx.assign(ref, PDFRawStream.of(dict, jpeg));
    report.imagesRecompressed++;
    if (downsampled) report.imagesDownsampled++;
  }
  progress?.(images.length, images.length);
}

/** Replace references in an object tree according to `map`. */
function remapRefs(obj: PDFObject, map: Map<string, PDFRef>): void {
  const swap = (v: PDFObject) => (v instanceof PDFRef ? map.get(v.toString()) : undefined);
  if (obj instanceof PDFDict) {
    for (const [k, v] of obj.entries()) {
      const to = swap(v);
      if (to) obj.set(k, to);
      else remapRefs(v, map);
    }
  } else if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) {
      const v = obj.get(i);
      const to = swap(v);
      if (to) obj.set(i, to);
      else remapRefs(v, map);
    }
  } else if (obj instanceof PDFStream) {
    remapRefs(obj.dict, map);
  }
}

/** A simple non-cryptographic hash (FNV-1a) of bytes, to find candidate duplicates. */
function hash(b: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
  return h >>> 0;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Merge streams with the same dictionary and contents into one. Returns how many were merged away. */
export function mergeDuplicateStreams(doc: PDFDocument): number {
  const ctx = doc.context;
  let merged = 0;
  // A second round catches streams whose dictionaries pointed at duplicates (e.g. an image's soft mask).
  for (let round = 0; round < 3; round++) {
    const groups = new Map<string, [PDFRef, PDFRawStream][]>();
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream) || obj.contents.length < 32) continue;
      // Metadata and signatures' contents are compared nowhere else; leave structure streams alone.
      const type = obj.dict.lookup(N('Type'));
      if (type === N('XRef') || type === N('ObjStm')) continue;
      const dictText = obj.dict.toString().replace(/\/Length \d+ 0 R/, '');
      const key = `${hash(obj.contents)}:${obj.contents.length}:${dictText}`;
      const g = groups.get(key);
      if (g) g.push([ref, obj]);
      else groups.set(key, [[ref, obj]]);
    }
    const map = new Map<string, PDFRef>();
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const [keepRef, keep] = g[0];
      for (const [ref, s] of g.slice(1)) if (sameBytes(keep.contents, s.contents)) map.set(ref.toString(), keepRef);
    }
    if (!map.size) break;
    for (const [, obj] of ctx.enumerateIndirectObjects()) remapRefs(obj, map);
    for (const [k, v] of Object.entries(ctx.trailerInfo)) {
      const to = v instanceof PDFRef ? map.get(v.toString()) : undefined;
      if (to) (ctx.trailerInfo as Record<string, unknown>)[k] = to;
    }
    for (const k of map.keys()) {
      const [n, g] = k.split(' ').map(Number);
      ctx.delete(PDFRef.of(n, g));
    }
    merged += map.size;
  }
  return merged;
}

/** Flate-compress streams that are stored without any filter. Returns how many were compressed. */
export function compressPlainStreams(doc: PDFDocument): number {
  const ctx = doc.context;
  let count = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.has(N('Filter')) || obj.contents.length < 128) continue;
    const type = obj.dict.lookup(N('Type'));
    // PDF/A wants XMP readable as is; leave cross-reference structures to pdf-lib.
    if (type === N('Metadata') || type === N('XRef') || type === N('ObjStm')) continue;
    const dict = obj.dict.clone(ctx);
    dict.delete(N('Length'));
    dict.delete(N('DecodeParms'));
    const out = ctx.flateStream(obj.contents, {});
    for (const [k, v] of dict.entries()) out.dict.set(k, v);
    out.dict.set(N('Filter'), N('FlateDecode'));
    if (out.contents.length < obj.contents.length) {
      ctx.assign(ref, out);
      count++;
    }
  }
  return count;
}

/** Remove the document information, XMP metadata and /PieceInfo. */
function removeMetadata(doc: PDFDocument): void {
  const ctx = doc.context;
  doc.catalog.delete(N('Metadata'));
  doc.catalog.delete(N('PieceInfo'));
  const info = ctx.trailerInfo.Info ? ctx.lookup(ctx.trailerInfo.Info) : undefined;
  if (info instanceof PDFDict) {
    // The title is what viewers show instead of the file name: keep it.
    const title = info.get(N('Title'));
    for (const k of [...info.keys()]) info.delete(k);
    if (title) info.set(N('Title'), title);
  }
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : undefined;
    if (!dict) continue;
    dict.delete(N('PieceInfo'));
    // Per-object XMP (on pages, images, forms); the document's own is gone already.
    if (dict.lookup(N('Metadata')) instanceof PDFStream) dict.delete(N('Metadata'));
  }
}

function removeThumbnails(doc: PDFDocument): void {
  for (const page of doc.getPages()) page.node.delete(N('Thumb'));
}

/**
 * Optimize a loaded document in place and save it. The bytes are returned with a report;
 * `before` is the size of the file the caller loaded, if it passes one.
 */
export async function optimizeDocument(
  doc: PDFDocument,
  o: OptimizeOptions,
  codec: ImageCodec,
  opts: { before?: number; progress?: (done: number, total: number) => void } = {},
): Promise<{ bytes: Uint8Array; report: OptimizeReport }> {
  const report: OptimizeReport = {
    before: opts.before ?? 0,
    after: 0,
    imagesRecompressed: 0,
    imagesDownsampled: 0,
    imagesKept: 0,
    duplicatesMerged: 0,
    streamsCompressed: 0,
    metadataRemoved: false,
    keptForPdfA: false,
  };
  await doc.flush();
  if (o.removeMetadata) {
    // PDF/A requires the XMP metadata.
    if (isPdfA(doc)) report.keptForPdfA = true;
    else {
      removeMetadata(doc);
      report.metadataRemoved = true;
    }
  }
  if (o.removeThumbnails) removeThumbnails(doc);
  if (o.jpegQuality !== undefined || o.maxDpi !== undefined || o.convertOtherImages) await recompressImages(doc, o, codec, report, opts.progress);
  if (o.mergeDuplicates) report.duplicatesMerged = mergeDuplicateStreams(doc);
  if (o.compressStreams) report.streamsCompressed = compressPlainStreams(doc);
  const bytes = await saveDoc(doc);
  report.after = bytes.length;
  return { bytes, report };
}

/** The file claims conformance to any part of PDF/A. */
function isPdfA(doc: PDFDocument): boolean {
  if (isPdfA1(doc)) return true;
  const s = doc.catalog.lookup(N('Metadata'));
  const b = s instanceof PDFStream ? streamBytes(s) : undefined;
  return !!b && /pdfaid:part/.test(new TextDecoder().decode(b));
}
