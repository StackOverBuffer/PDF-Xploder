/** Bookmarks (document outline) and link annotations. */
import { PDFArray, PDFDict, PDFName, PDFNull, PDFNumber, PDFRef, PDFString } from '@cantoo/pdf-lib';
import { load } from './pdfOps';
import type { Rect } from './types';
import { saveDoc } from './pdfSave';

export type LinkTarget = { page: number; y?: number } | { url: string };

function destination(doc: Awaited<ReturnType<typeof load>>, page: number, y?: number): PDFArray {
  const ref = doc.getPage(page).ref;
  return doc.context.obj([ref, PDFName.of('XYZ'), PDFNull, y === undefined ? PDFNull : PDFNumber.of(y), PDFNull]);
}

/** Append a bookmark to the end of the top level of the outline. */
export async function addBookmark(bytes: Uint8Array, title: string, page: number, y?: number): Promise<Uint8Array> {
  const doc = await load(bytes);
  const ctx = doc.context;
  let outlinesRef = doc.catalog.get(PDFName.of('Outlines'));
  let outlines = doc.catalog.lookup(PDFName.of('Outlines'));
  if (!(outlines instanceof PDFDict)) {
    outlines = ctx.obj({ Type: 'Outlines', Count: 0 });
    outlinesRef = ctx.register(outlines as PDFDict);
    doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
  }
  const root = outlines as PDFDict;
  if (!(outlinesRef instanceof PDFRef)) {
    outlinesRef = ctx.register(root);
    doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
  }
  const item = ctx.obj({ Title: PDFString.of(title), Parent: outlinesRef, Dest: destination(doc, page, y) });
  const itemRef = ctx.register(item);
  const lastRef = root.get(PDFName.of('Last'));
  const last = root.lookup(PDFName.of('Last'));
  if (lastRef instanceof PDFRef && last instanceof PDFDict) {
    last.set(PDFName.of('Next'), itemRef);
    item.set(PDFName.of('Prev'), lastRef);
  } else {
    root.set(PDFName.of('First'), itemRef);
  }
  root.set(PDFName.of('Last'), itemRef);
  const count = root.lookup(PDFName.of('Count'));
  const n = count instanceof PDFNumber ? count.asNumber() : 0;
  // A negative count means the top level is collapsed; keep the sign.
  root.set(PDFName.of('Count'), PDFNumber.of(n < 0 ? n - 1 : n + 1));
  return saveDoc(doc);
}

/** Add an invisible link over `rect` (user space) on `page`. */
export async function addLink(bytes: Uint8Array, page: number, rect: Rect, target: LinkTarget): Promise<Uint8Array> {
  const doc = await load(bytes);
  const ctx = doc.context;
  const p = doc.getPage(page);
  const annot = ctx.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h],
    Border: [0, 0, 0],
    F: 4,
    P: p.ref,
  });
  if ('url' in target) annot.set(PDFName.of('A'), ctx.obj({ S: 'URI', URI: PDFString.of(target.url) }));
  else annot.set(PDFName.of('Dest'), destination(doc, target.page, target.y));
  const ref = ctx.register(annot);
  const annots = p.node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) annots.push(ref);
  else p.node.set(PDFName.of('Annots'), ctx.obj([ref]));
  return saveDoc(doc);
}
