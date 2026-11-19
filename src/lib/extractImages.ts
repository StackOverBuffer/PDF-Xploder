/**
 * Find the images of a document for "Extract all images": each image XObject once,
 * in the order of the pages that show it. JPEGs are handed out as they are stored;
 * other images as pixels (or, for formats only a PDF renderer reads, a one-page PDF)
 * for the caller to encode as PNG.
 */
import { PDFDict, PDFName, PDFRawStream, PDFRef, PDFStream, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib';
import { isolatedImagePdf, readImage, softMasks, type ImageSource } from './optimize';

export interface FoundImage {
  /** First page (0-based) that uses the image. */
  page: number;
  width: number;
  height: number;
  /** The stored JPEG, to save as a .jpg file unchanged. */
  jpeg?: Uint8Array;
  /** Otherwise the pixels (or a one-page PDF of the image) to encode as PNG. */
  source?: ImageSource;
}

const N = (k: string) => PDFName.of(k);

/** Image XObjects used by each page (also inside form XObjects and patterns), first use first. */
export function imagesByPage(doc: PDFDocument): { ref: PDFRef; page: number }[] {
  const ctx = doc.context;
  const out: { ref: PDFRef; page: number }[] = [];
  const seen = new Set<string>();
  const visited = new Set<PDFDict>();
  const walk = (res: PDFObject | undefined, page: number, depth: number) => {
    const r = res instanceof PDFRef ? ctx.lookup(res) : res;
    if (!(r instanceof PDFDict) || depth > 12 || visited.has(r)) return;
    visited.add(r);
    for (const key of ['XObject', 'Pattern']) {
      const d = r.lookup(N(key));
      if (!(d instanceof PDFDict)) continue;
      for (const [, ref] of d.entries()) {
        const x = ctx.lookup(ref);
        if (!(x instanceof PDFStream)) continue;
        if (x.dict.lookup(N('Subtype')) === N('Image')) {
          if (ref instanceof PDFRef && !seen.has(ref.toString())) {
            seen.add(ref.toString());
            out.push({ ref, page });
          }
        } else walk(x.dict.get(N('Resources')), page, depth + 1);
      }
    }
  };
  doc.getPages().forEach((p, i) => walk(p.node.Resources() ?? p.node.getInheritableAttribute(N('Resources')), i, 0));
  return out;
}

/** The document's images (masks and tiny images left out). */
export async function findImages(doc: PDFDocument, minSize = 8): Promise<FoundImage[]> {
  const ctx = doc.context;
  const masks = softMasks(ctx);
  const out: FoundImage[] = [];
  for (const { ref, page } of imagesByPage(doc)) {
    if (masks.has(ref.toString())) continue;
    const stream = ctx.lookup(ref);
    if (!(stream instanceof PDFRawStream) || stream.dict.lookup(N('ImageMask'))?.toString() === 'true') continue;
    const read = readImage(stream);
    const source = read?.src ?? (await isolatedImagePdf(stream, { blackAndWhite: true }).catch(() => undefined));
    if (!source || source.width < minSize || source.height < minSize) continue;
    if ('jpeg' in source) out.push({ page, width: source.width, height: source.height, jpeg: source.jpeg });
    else out.push({ page, width: source.width, height: source.height, source });
  }
  return out;
}
