import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import * as ops from '../src/lib/pdfOps';
import * as org from '../src/lib/organize';
import { buildPrintPdf } from '../src/lib/printLayout';

const N = (s: string) => PDFName.of(s);

/**
 * Three pages: page 1 links to page 3 ("SECRET THREE" on it) and has a bookmark to
 * page 3; one text field "Name" has a widget on page 2 and another on page 3.
 */
async function linkedDoc(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [1, 2, 3].map((i) => {
    const p = doc.addPage([300, 300]);
    p.drawText(i === 3 ? 'SECRET THREE' : `Page ${i}`, { x: 20, y: 250, size: 12, font });
    return p;
  });
  const ctx = doc.context;
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 50, 50], Dest: [pages[2].ref, 'Fit'], NM: PDFHexString.fromText('link-1') }));
  pages[0].node.set(N('Annots'), ctx.obj([link]));
  const field = ctx.register(ctx.obj({ FT: 'Tx', T: PDFHexString.fromText('Name'), V: PDFHexString.fromText('Jo'), Kids: [] }));
  const widgets = [1, 2].map((i) => {
    const w = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [20, 100, 200, 120], P: pages[i].ref, Parent: field }));
    pages[i].node.set(N('Annots'), ctx.obj([w]));
    return w;
  });
  (ctx.lookup(field) as PDFDict).set(N('Kids'), ctx.obj(widgets));
  doc.catalog.set(N('AcroForm'), ctx.obj({ Fields: [field], DA: PDFHexString.fromText('/Helv 0 Tf 0 g') }));
  const outlines = ctx.nextRef();
  const item = ctx.register(ctx.obj({ Title: PDFHexString.fromText('Three'), Parent: outlines, Dest: [pages[2].ref, 'Fit'] }));
  ctx.assign(outlines, ctx.obj({ Type: 'Outlines', First: item, Last: item, Count: 1 }));
  doc.catalog.set(N('Outlines'), outlines);
  return doc.save({ useObjectStreams: false });
}

/** Objects of type /Page that are not in the page tree. */
async function hiddenPages(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  const inTree = new Set(doc.getPages().map((p) => p.ref.toString()));
  return doc.context.enumerateIndirectObjects().filter(([ref, o]) => o instanceof PDFDict && o.get(N('Type'))?.toString() === '/Page' && !inTree.has(ref.toString())).length;
}

const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');

async function fieldNames(bytes: Uint8Array): Promise<string[]> {
  return (await PDFDocument.load(bytes)).getForm().getFields().map((f) => f.getName()).sort();
}

describe('copying pages', () => {
  it('extracting a page does not take the pages it links to along', async () => {
    const out = await ops.extractPages(await linkedDoc(), [0]);
    expect(await hiddenPages(out)).toBe(0);
    expect(latin1(out)).not.toContain('SECRET');
    // The link led to a page that is not in the new file: it is gone.
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  });

  it('keeps links between the extracted pages, pointing at the copies', async () => {
    const out = await ops.extractPages(await linkedDoc(), [0, 2]);
    const doc = await PDFDocument.load(out);
    const link = doc.context.lookup(doc.getPage(0).node.Annots()!.get(0)) as PDFDict;
    expect((link.lookup(N('Dest')) as PDFArray).get(0)).toBe(doc.getPage(1).ref);
    expect(await hiddenPages(out)).toBe(0);
  });

  it('registers the copied widgets as fields, with only their own widgets', async () => {
    const out = await ops.extractPages(await linkedDoc(), [1]);
    expect(await hiddenPages(out)).toBe(0);
    expect(latin1(out)).not.toContain('SECRET');
    const form = (await PDFDocument.load(out)).getForm();
    expect(form.getFields().map((f) => f.getName())).toEqual(['Name']);
    expect(form.getTextField('Name').getText()).toBe('Jo');
    expect(form.getTextField('Name').acroField.getWidgets()).toHaveLength(1);
  });

  it('inserting a file keeps its fields fillable, renamed where names clash, and its links working', async () => {
    const src = await linkedDoc();
    const { bytes } = await ops.insertDocument(src, src, 3);
    expect(await fieldNames(bytes)).toEqual(['Name', 'Name_2']);
    expect(await hiddenPages(bytes)).toBe(0);
    const doc = await PDFDocument.load(bytes);
    const link = doc.context.lookup(doc.getPage(3).node.Annots()!.get(0)) as PDFDict;
    expect((link.lookup(N('Dest')) as PDFArray).get(0)).toBe(doc.getPage(5).ref);
    // One name per annotation, as comment sync and reply threads expect.
    const names = doc.getPages().flatMap((p) => (p.node.Annots()?.asArray() ?? []).map((r) => (doc.context.lookup(r) as PDFDict).lookup(N('NM'))?.toString())).filter(Boolean);
    expect(new Set(names).size).toBe(names.length);
  });

  it('interleaving leaves no pages and no field values behind', async () => {
    const src = await linkedDoc();
    const out = await org.assemblePages(src, [0, { file: 0, page: 0 }], [src]);
    expect(await hiddenPages(out)).toBe(0);
    expect(latin1(out)).not.toContain('SECRET');
    expect(await fieldNames(out)).toEqual([]);
  });

  it('printing one page to PDF carries no other page', async () => {
    const src = await linkedDoc();
    const out = await buildPrintPdf(src, [{ width: 300, height: 300, borders: false, items: [{ page: 0, scale: 1, w: 300, h: 300, x: 0, y: 0, cell: { x: 0, y: 0, w: 300, h: 300 } }] }]);
    expect(await hiddenPages(out)).toBe(0);
    expect(latin1(out)).not.toContain('SECRET');
  });
});

describe('removed pages', () => {
  it('deleting a page cuts the bookmarks and links that pointed at it', async () => {
    const out = await ops.deletePages(await linkedDoc(), [2]);
    expect(await hiddenPages(out)).toBe(0);
    const doc = await PDFDocument.load(out);
    const item = doc.catalog.lookup(N('Outlines'), PDFDict).lookup(N('First'), PDFDict);
    expect(item.has(N('Dest'))).toBe(false);
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    // The field keeps the widget that is still on a page.
    expect(doc.getForm().getTextField('Name').acroField.getWidgets()).toHaveLength(1);
  });

  it('rasterizing a page keeps the page object, so bookmarks and links still lead to it', async () => {
    const src = await linkedDoc();
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const before = await PDFDocument.load(src);
    const { bytes, removedFields } = await ops.replacePagesWithImages(src, [{ index: 2, png }]);
    // "Name" also shows on page 2, so it stays (with only that widget).
    expect(removedFields).toEqual([]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(2).ref.toString()).toBe(before.getPage(2).ref.toString());
    const item = doc.catalog.lookup(N('Outlines'), PDFDict).lookup(N('First'), PDFDict);
    expect((item.lookup(N('Dest')) as PDFArray).get(0)).toBe(doc.getPage(2).ref);
    expect(doc.getForm().getTextField('Name').acroField.getWidgets()).toHaveLength(1);
    expect(latin1(bytes)).not.toContain('SECRET');
    expect(doc.getPage(2).node.Annots()?.size() ?? 0).toBe(0);
    expect(doc.getPage(2).node.Contents()).toBeDefined();
  });
});
