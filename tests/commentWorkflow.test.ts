import { expect, it } from 'vitest';
import { PDFDocument, PDFDict, PDFHexString, PDFName, PDFString } from '@cantoo/pdf-lib';
import { importAnnotations, writeNativeAnnotation } from '../src/lib/annotIO';
import { drawContext, exportWithAnnotations } from '../src/lib/pdfOps';
import type { Annotation, PageGeom } from '../src/lib/types';

const g: PageGeom = { view: [0, 0, 300, 200], rotation: 0 };
const note = (over: Partial<Annotation> = {}): Annotation => ({
  id: 'n1', type: 'note', at: { x: 10, y: 10 }, text: 'hello', color: '#fbc02d',
  opacity: 1, author: 'A', createdAt: 0, ...over,
} as Annotation);

it('writes the status as a review state annotation and reads it back', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]);
  const ctx = await drawContext(doc);
  await writeNativeAnnotation(ctx, doc.getPages()[0], g, note({ status: 'Accepted' }), { author: 'B' });
  const bytes = await doc.save();
  const res = await importAnnotations(await PDFDocument.load(bytes), [g], () => 'n2');
  expect(res.count).toBe(1);
  expect(res.annotations[0][0]).toMatchObject({ status: 'Accepted' });
  // The state dict was consumed: the file holds no leftover reply for it.
  expect(res.annotations[0][0].replies ?? []).toEqual([]);
});

it('maps another program\'s state annotation to the status, not to a reply', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const parent = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFHexString.fromText('the comment'),
    T: PDFHexString.fromText('A'), F: 4, M: PDFString.fromDate(new Date(0)), CreationDate: PDFString.fromDate(new Date(0)),
  }));
  const state = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Text', IRT: parent, RT: 'R', State: 'Rejected', StateModel: 'Review',
    T: PDFHexString.fromText('B'), F: 4, M: PDFString.fromDate(new Date(0)),
  }));
  page.node.set(PDFName.of('Annots'), doc.context.obj([parent, state]));
  const res = await importAnnotations(doc, [g], () => 'n3');
  expect(res.count).toBe(1);
  expect(res.annotations[0][0]).toMatchObject({ status: 'Rejected' });
  expect(res.annotations[0][0].replies ?? []).toEqual([]);
});

it('leaves another program\'s Marked-model state alone without a ghost reply', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const parent = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFHexString.fromText('the comment'),
    T: PDFHexString.fromText('A'), F: 4, M: PDFString.fromDate(new Date(0)), CreationDate: PDFString.fromDate(new Date(0)),
  }));
  const marked = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Text', IRT: parent, RT: 'R', State: 'Marked', StateModel: 'Marked',
    T: PDFHexString.fromText('B'), F: 4, M: PDFString.fromDate(new Date(0)),
  }));
  page.node.set(PDFName.of('Annots'), doc.context.obj([parent, marked]));
  const res = await importAnnotations(doc, [g], () => 'n4');
  expect(res.count).toBe(1);
  expect(res.annotations[0][0].status).toBeUndefined();
  expect(res.annotations[0][0].replies ?? []).toEqual([]);
  // The Marked dict is not ours to consume: it stays in the file.
  const out = await PDFDocument.load(await doc.save());
  const annots = out.getPage(0).node.Annots()!;
  expect(annots.size()).toBe(1);
  const dict = out.context.lookup(annots.get(0)) as PDFDict;
  expect((dict.get(PDFName.of('State')) as PDFName).decodeText()).toBe('Marked');
});

it('keeps a comment without status state-free', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]);
  const ctx = await drawContext(doc);
  await writeNativeAnnotation(ctx, doc.getPages()[0], g, note());
  const bytes = await doc.save();
  // No state dict of our own in the file.
  expect(new TextDecoder().decode(bytes)).not.toContain('StateModel');
  const res = await importAnnotations(await PDFDocument.load(bytes), [g], () => 'n5');
  expect(res.count).toBe(1);
  expect(res.annotations[0][0].status).toBeUndefined();
});

it('writes no status dict for a flattened copy', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]);
  const ctx = await drawContext(doc);
  await writeNativeAnnotation(ctx, doc.getPages()[0], g, note({ status: 'Completed' }), { author: 'B' });
  const bytes = await doc.save();
  const flat = await exportWithAnnotations(bytes, [[note({ status: 'Completed' })]], { flatten: true });
  expect(new TextDecoder().decode(flat)).not.toContain('StateModel');
});
