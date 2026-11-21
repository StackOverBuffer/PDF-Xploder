import { expect, it } from 'vitest';
import { PDFDocument, PDFDict, PDFHexString, PDFName, PDFString } from '@cantoo/pdf-lib';
import { importAnnotations, writeNativeAnnotation } from '../src/lib/annotIO';
import { drawContext, exportWithAnnotations } from '../src/lib/pdfOps';
import { commentSummaryMarkdown, commentsCsv, escapeMarkdownText } from '../src/lib/commentSummary';
import { parseMarkdown } from '../src/lib/markdown';
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

it('escapes markdown syntax in comment text', () => {
  expect(escapeMarkdownText('# hi *bold* [link](x)')).toBe('\\# hi \\*bold\\* \\[link\\]\\(x\\)');
});

it('builds one section per page with author, date and status', () => {
  const md = commentSummaryMarkdown('Plan.pdf', [{ page: 2, list: [note({ author: 'Jane', status: 'Accepted' })] }], { includeReplies: true }, 'en');
  expect(md).toContain('# Comments — Plan\\.pdf');
  expect(md).toContain('## Page 2');
  expect(md).toContain('Jane');
  expect(md).toContain('Accepted');
  expect(md).toContain('hello');
});

it('omits replies when asked and localizes headings in German', () => {
  const md = commentSummaryMarkdown('Plan.pdf', [{ page: 1, list: [note({ replies: [{ id: 'r', author: 'B', text: 'done', createdAt: 0 }] })] }], { includeReplies: false }, 'de');
  expect(md).toContain('Kommentare');
  expect(md).not.toContain('done');
});

it('quotes commas, quotes and line breaks in the comments CSV', () => {
  expect(commentsCsv([{ page: 1, type: 'Note', author: 'A', date: '2026-11-21', status: '', text: 'a, "b"\nc' }], 'en'))
    .toBe('page,type,author,date,status,text\r\n1,Note,A,2026-11-21,,"a, ""b""\nc"');
});

it('keeps formula-like cells in the comments CSV as plain text', () => {
  const csv = commentsCsv([{ page: 1, type: 'Note', author: '@evil', date: '2026-11-21', status: '', text: '=HYPERLINK("http://x","y")' }], 'en');
  expect(csv.split('\r\n')[1]).toBe(`1,Note,'@evil,2026-11-21,,"'=HYPERLINK(""http://x"",""y"")"`);
  // Only the start of a cell counts: a minus inside the text stays as it is.
  expect(commentsCsv([{ page: 1, type: 'Note', author: 'A', date: 'd', status: '', text: 'a-b' }], 'de').split('\r\n')[1]).toBe('1;Note;A;d;;a-b');
});

it('escapes markdown in author names and the document name of the summary', () => {
  const md = commentSummaryMarkdown('*Plan*', [{ page: 1, list: [note({ author: '_Bo_' })] }], { includeReplies: true }, 'en');
  expect(md).toContain('\\*Plan\\*');
  expect(md).toContain('\\_Bo\\_');
});

it('keeps a multi-line comment inside its list item, whatever it contains', () => {
  const md = commentSummaryMarkdown('doc', [
    { page: 1, list: [note({ text: 'example:\n\n~~~\nx\n---\nsee https://example.com &amp; ~~this~~' })] },
    { page: 2, list: [note({ id: 'n2', text: 'second' })] },
  ], { includeReplies: true }, 'en');
  const blocks = parseMarkdown(md).map((b) => b.type);
  expect(blocks).toEqual(['heading', 'heading', 'list', 'heading', 'list']);
  expect(md).toContain('https\\:');
});

it('keeps who set each review status and when, through a save by someone else', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const parent = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFHexString.fromText('the comment'),
    NM: PDFHexString.fromText('c1'), T: PDFHexString.fromText('Bob'), F: 4, M: PDFString.fromDate(new Date(0)),
  }));
  const st = (state: string, who: string, at: number) => doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Text', IRT: parent, RT: 'R', State: state, StateModel: 'Review',
    NM: PDFHexString.fromText(`s-${who}`), T: PDFHexString.fromText(who), F: 4, M: PDFString.fromDate(new Date(at)),
  }));
  // Listed newest first: the newest by date is the status, not the last listed.
  page.node.set(PDFName.of('Annots'), doc.context.obj([parent, st('Completed', 'Dan', 2_000_000), st('Accepted', 'Alice', 1_000_000)]));
  const res = await importAnnotations(doc, [g], () => 'x');
  const a = res.annotations[0][0];
  expect(a.status).toBe('Completed');
  expect(a.statusLog?.map((e) => [e.state, e.author, e.at])).toEqual([['Accepted', 'Alice', 1_000_000], ['Completed', 'Dan', 2_000_000]]);

  // Carol saves without touching the status: both changes are written as they were.
  const out = await PDFDocument.create();
  out.addPage([300, 200]);
  await writeNativeAnnotation(await drawContext(out), out.getPages()[0], g, a, { author: 'Carol' });
  const back = (await importAnnotations(await PDFDocument.load(await out.save()), [g], () => 'y')).annotations[0][0];
  expect(back.statusLog?.map((e) => [e.state, e.author, e.at])).toEqual([['Accepted', 'Alice', 1_000_000], ['Completed', 'Dan', 2_000_000]]);
  expect(back.status).toBe('Completed');
});

it('adds a status set in this session as a new change by the current author', async () => {
  const { setStatus } = await import('../src/lib/reviewStatus');
  const a = note({ status: 'Accepted', statusLog: [{ id: 's1', state: 'Accepted', author: 'Alice', at: 1000 }] });
  const next = { ...a, ...setStatus(a, 'Rejected', 'Carol', 5000) };
  expect(next.statusLog).toEqual([{ id: 's1', state: 'Accepted', author: 'Alice', at: 1000 }, { id: 'state-n1-1', state: 'Rejected', author: 'Carol', at: 5000 }]);
  expect(setStatus(a, 'Accepted', 'Carol').statusLog).toBe(a.statusLog);
});
