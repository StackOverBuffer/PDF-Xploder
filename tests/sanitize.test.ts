import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from '@cantoo/pdf-lib';
import { sanitize } from '../src/lib/sanitize';
import { listAttachments } from '../src/lib/attachments';

const N = PDFName.of;

async function riskyDoc(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([400, 400]);
  doc.addPage([400, 400]);
  doc.setTitle('Report');
  doc.setAuthor('Someone');
  // Document script, an open action that runs one, and a page that runs one when opened.
  const js = ctx.register(ctx.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }));
  doc.catalog.set(N('Names'), ctx.obj({ JavaScript: { Names: [PDFHexString.fromText('init'), js] } }));
  doc.catalog.set(N('OpenAction'), ctx.obj({ S: 'JavaScript', JS: PDFString.of('x()'), Next: { S: 'GoTo', D: [page.ref, 'Fit'] } }));
  page.node.set(N('AA'), ctx.obj({ O: { S: 'JavaScript', JS: PDFString.of('y()') }, C: { S: 'GoTo', D: [page.ref, 'Fit'] } }));
  // A link that launches a program, a web link (kept), and a form submit button.
  const launch = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: { S: 'Launch', F: 'calc.exe' } }));
  const web = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [20, 0, 30, 10], A: { S: 'URI', URI: PDFString.of('https://example.com') } }));
  const submit = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Btn', T: PDFString.of('send'), Rect: [40, 0, 60, 10], A: { S: 'SubmitForm', F: PDFString.of('https://example.com/collect') } }));
  const attach = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: [70, 0, 80, 10] }));
  page.node.set(N('Annots'), ctx.obj([launch, web, submit, attach]));
  page.node.set(N('Thumb'), ctx.register(ctx.stream('x')));
  doc.catalog.set(N('AcroForm'), ctx.obj({ Fields: [submit], XFA: ctx.register(ctx.stream('<xdp/>')) }));
  await doc.attach(new Uint8Array([1, 2, 3]), 'secret.txt', { mimeType: 'text/plain' });
  return doc.save();
}

describe('sanitize', () => {
  it('removes scripts, launch and submit actions, attachments, metadata and thumbnails', async () => {
    const { bytes, report } = await sanitize(await PDFDocument.load(await riskyDoc()), { scripts: true, externalActions: true, attachments: true, metadata: true, hiddenData: true });
    expect(report).toMatchObject({ externalActions: 1, metadataRemoved: true, keptForPdfA: false });
    // Name tree script, open action, page open script, launch link, XFA.
    expect(report.scripts).toBe(5);
    expect(report.attachments).toBe(2);
    expect(report.hiddenData).toBe(1);
    const doc = await PDFDocument.load(bytes);
    const names = doc.catalog.lookup(N('Names'));
    expect(names instanceof PDFDict && names.has(N('JavaScript'))).toBe(false);
    expect(doc.catalog.has(N('OpenAction'))).toBe(false);
    const [page] = doc.getPages();
    const aa = page.node.lookup(N('AA')) as PDFDict;
    expect(aa.keys().map((k) => k.decodeText())).toEqual(['C']);
    const annots = (page.node.lookup(N('Annots')) as PDFArray).asArray().map((r) => doc.context.lookup(r) as PDFDict);
    expect(annots.map((a) => a.lookup(N('Subtype'))!.toString())).toEqual(['/Link', '/Link', '/Widget']);
    expect(annots[0].has(N('A'))).toBe(false);
    expect(annots[1].has(N('A'))).toBe(true);
    expect(annots[2].has(N('A'))).toBe(false);
    expect((doc.catalog.lookup(N('AcroForm')) as PDFDict).has(N('XFA'))).toBe(false);
    expect(page.node.has(N('Thumb'))).toBe(false);
    expect(await listAttachments(bytes)).toEqual([]);
    expect(doc.getAuthor()).toBeUndefined();
    expect(doc.getTitle()).toBe('Report');
  });

  it('only removes what was chosen', async () => {
    const { bytes, report } = await sanitize(await PDFDocument.load(await riskyDoc()), { scripts: true });
    expect(report.externalActions).toBe(0);
    expect(report.attachments).toBe(0);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getAuthor()).toBe('Someone');
    expect(await listAttachments(bytes)).toHaveLength(1);
    const annots = (doc.getPages()[0].node.lookup(N('Annots')) as PDFArray).asArray().map((r) => doc.context.lookup(r) as PDFDict);
    expect(annots[2].has(N('A'))).toBe(true);
  });
});
