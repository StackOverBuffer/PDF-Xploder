/**
 * Appearances drawn by other programs (custom stamps from PDF-XChange, Acrobat, …):
 * the appearance stream is copied, with its resources, into a one-page PDF of its
 * own. That keeps the exact vector drawing with the annotation while it lives in our
 * model, and is embedded again as the appearance when saving.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObjectCopier, PDFRawStream, PDFRef, PDFStream, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from '@cantoo/pdf-lib';

const nums = (o: unknown): number[] => (o instanceof PDFArray ? o.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0)) : []);

/** The normal appearance stream of an annotation (for appearance states, the current one). */
export function normalAppearance(dict: PDFDict): PDFStream | undefined {
  const ap = dict.lookup(PDFName.of('AP'));
  if (!(ap instanceof PDFDict)) return undefined;
  const nEntry = ap.lookup(PDFName.of('N'));
  if (nEntry instanceof PDFStream) return nEntry;
  if (nEntry instanceof PDFDict) {
    const as = dict.lookup(PDFName.of('AS'));
    const state = as instanceof PDFName ? nEntry.lookup(as) : undefined;
    if (state instanceof PDFStream) return state;
  }
  return undefined;
}

/** The appearance's bounding box after its /Matrix, as the viewer fits it into /Rect. */
function transformedBox(stream: PDFStream): [number, number, number, number] | undefined {
  const b = nums(stream.dict.lookup(PDFName.of('BBox')));
  if (b.length !== 4) return undefined;
  const m = nums(stream.dict.lookup(PDFName.of('Matrix')));
  const [a, bb, c, d, e, f] = m.length === 6 ? m : [1, 0, 0, 1, 0, 0];
  const pts = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(([x, y]) => [a * x + c * y + e, bb * x + d * y + f]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** A one-page PDF (base64) showing the appearance stream, or undefined if it cannot be copied. */
export async function appearanceToPdf(src: PDFDocument, stream: PDFStream): Promise<string | undefined> {
  const box = transformedBox(stream);
  if (!box) return undefined;
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0;
  const h = y1 - y0;
  if (!(w > 0 && h > 0)) return undefined;
  const dst = await PDFDocument.create({ updateMetadata: false });
  const copied = PDFObjectCopier.for(src.context, dst.context).copy(stream) as PDFStream | PDFRawStream;
  const ref: PDFRef = dst.context.register(copied);
  const page = dst.addPage([w, h]);
  const name = page.node.newXObject('Ap', ref);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, -x0, -y0), drawObject(name), popGraphicsState());
  const bytes = await dst.save({ useObjectStreams: false, addDefaultPage: false });
  return toBase64(bytes);
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
