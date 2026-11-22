import { expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from '@cantoo/pdf-lib';
import * as ops from '../src/lib/pdfOps';

const N = (s: string) => PDFName.of(s);

async function taggedDoc(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const ctx = doc.context;
  const rootRef = ctx.nextRef();
  const docElem = ctx.register(ctx.obj({ Type: 'StructElem', S: 'Document', P: rootRef, K: [ctx.obj({ Type: 'StructElem', S: 'P', Pg: page.ref, K: 0 })] }));
  ctx.assign(rootRef, ctx.obj({ Type: 'StructTreeRoot', K: docElem, ParentTree: { Nums: [0, ctx.obj([])] }, ParentTreeNextKey: 1 }));
  doc.catalog.set(N('StructTreeRoot'), rootRef);
  doc.catalog.set(N('MarkInfo'), ctx.obj({ Marked: true }));
  return doc.save();
}

/** The /Annot elements of the document element, and the annotations they hold. */
async function annotElems(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const root = doc.catalog.lookup(N('StructTreeRoot'), PDFDict);
  const docElem = root.lookup(N('K'), PDFDict);
  const kids = (docElem.lookup(N('K')) as PDFArray).asArray().map((k) => doc.context.lookup(k) as PDFDict);
  const annots = kids.filter((k) => k.lookup(N('S'))?.toString() === '/Annot');
  const onPage = (doc.getPage(0).node.Annots()?.asArray() ?? []).map((r) => r.toString());
  const nums = root.lookup(N('ParentTree'), PDFDict).lookup(N('Nums'), PDFArray);
  return { doc, annots, onPage, nums, objs: annots.map((e) => ((e.lookup(N('K')) as PDFDict).get(N('Obj')) as PDFRef).toString()) };
}

it('tags new comments in tagged documents, and does not pile up tags on every save', async () => {
  const rect = { id: 'r1', type: 'rect', rect: { x: 10, y: 10, w: 50, h: 50 }, width: 2, color: '#ff0000', opacity: 1, author: 'Jo', createdAt: 0, comment: 'Check this' } as never;
  const first = await ops.exportWithAnnotations(await taggedDoc(), [[rect]]);
  const a = await annotElems(first);
  expect(a.annots).toHaveLength(1);
  expect(a.onPage).toContain(a.objs[0]);
  const annot = a.doc.context.lookup(PDFRef.of(Number(a.objs[0].split(' ')[0]))) as PDFDict;
  const key = (annot.lookup(N('StructParent')) as PDFNumber).asNumber();
  const at = a.nums.asArray().findIndex((x) => x instanceof PDFNumber && x.asNumber() === key);
  expect(a.doc.context.lookup(a.nums.get(at + 1))).toBe(a.annots[0]);
  expect(a.annots[0].lookup(N('Alt'))).toBeDefined();

  const opened = await ops.importForEditing(first);
  const second = await ops.exportWithAnnotations(opened.bytes, opened.annotations);
  const b = await annotElems(second);
  expect(b.annots).toHaveLength(1);
  expect(b.onPage).toContain(b.objs[0]);
});
