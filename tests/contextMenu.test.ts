import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { createLayer, describeObjects, editPage, isolateObjects, listLayers, readPage } from '../src/lib/content/page';
import { translate } from '../src/lib/content/matrix';
import { addBookmark, addLink } from '../src/lib/navigation';

/** A page with a 4×2 px image, a text line and a rectangle. */
async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  // Minimal 4x2 grey PNG
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAAAAACVnAgoAAAADklEQVR4nGNgYGBgYAAAAAYAAZ0YMiQAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
  const img = await doc.embedPng(png);
  page.drawImage(img, { x: 10, y: 300, width: 80, height: 40 });
  page.drawText('Hello', { x: 20, y: 200, size: 20, font: helv });
  page.drawRectangle({ x: 50, y: 100, width: 100, height: 50, color: rgb(0, 0, 1) });
  return doc.save();
}

const kinds = async (bytes: Uint8Array, page = 0) => {
  const doc = await PDFDocument.load(bytes);
  return describeObjects(readPage(doc.getPage(page)));
};

describe('isolating objects', () => {
  it('puts one image on a page of its own pixel size', async () => {
    const bytes = await sample();
    const img = (await kinds(bytes)).find((o) => o.kind === 'image')!;
    const iso = await isolateObjects(bytes, 0, [img.id], { nativeImage: true });
    expect([iso.width, iso.height]).toEqual([4, 2]);
    const doc = await PDFDocument.load(iso.bytes);
    expect(doc.getPageCount()).toBe(1);
    const mb = doc.getPage(0).getMediaBox();
    expect([mb.width, mb.height]).toEqual([4, 2]);
    expect((await kinds(iso.bytes)).map((o) => o.kind)).toEqual(['image']);
  });

  it('crops a selection to its bounding box and keeps positions', async () => {
    const bytes = await sample();
    const objs = await kinds(bytes);
    const ids = objs.filter((o) => o.kind !== 'image').map((o) => o.id);
    const iso = await isolateObjects(bytes, 0, ids);
    expect(iso.box.x).toBeCloseTo(20, 0);
    expect(iso.box.y).toBeLessThanOrEqual(100);
    const got = await kinds(iso.bytes);
    expect(got.map((o) => o.kind).sort()).toEqual(['path', 'text']);
    expect(got.find((o) => o.kind === 'path')!.bbox).toMatchObject({ x: 50, y: 100, w: 100, h: 50 });
  });
});

describe('pasting and layers', () => {
  it('pastes isolated objects as a form XObject at a new position', async () => {
    const bytes = await sample();
    const rect = (await kinds(bytes)).find((o) => o.kind === 'path')!;
    const iso = await isolateObjects(bytes, 0, [rect.id]);
    const doc = await PDFDocument.load(bytes);
    const [emb] = await doc.embedPdf(iso.bytes, [0]);
    const bbox = { x: iso.box.x + 100, y: iso.box.y, w: iso.box.w, h: iso.box.h };
    await editPage(doc.getPage(0), [{ type: 'addForm', ref: emb.ref, m: translate(bbox.x, bbox.y), bbox }]);
    const out = await kinds(await doc.save());
    const form = out.find((o) => o.kind === 'form')!;
    expect(form.bbox.x).toBeCloseTo(150, 0);
    expect(form.bbox.w).toBeCloseTo(100, 0);
  });

  it('assigns objects to a new layer and back to none', async () => {
    const doc = await PDFDocument.load(await sample());
    const ocg = createLayer(doc, 'Logos');
    expect(listLayers(doc)).toEqual([{ ref: ocg.toString(), name: 'Logos' }]);
    const img = describeObjects(readPage(doc.getPage(0))).find((o) => o.kind === 'image')!;
    await editPage(doc.getPage(0), [{ type: 'layer', ids: [img.id], ocg }]);
    let reloaded = await PDFDocument.load(await doc.save());
    let objs = describeObjects(readPage(reloaded.getPage(0)));
    expect(objs.find((o) => o.kind === 'image')!.layer).toBe(ocg.toString());
    expect(objs.filter((o) => o.layer).length).toBe(1);
    expect(reloaded.getPage(0).node.Resources()!.lookup(PDFName.of('Properties'))).toBeTruthy();
    const id = objs.find((o) => o.kind === 'image')!.id;
    await editPage(reloaded.getPage(0), [{ type: 'layer', ids: [id], ocg: null }]);
    reloaded = await PDFDocument.load(await reloaded.save());
    objs = describeObjects(readPage(reloaded.getPage(0)));
    expect(objs.some((o) => o.layer)).toBe(false);
  });
});

describe('bookmarks and links', () => {
  it('appends bookmarks to the outline in order', async () => {
    let bytes = await sample();
    bytes = await addBookmark(bytes, 'First', 0, 300);
    bytes = await addBookmark(bytes, 'Zweites Kapitel', 0);
    const doc = await PDFDocument.load(bytes);
    const outlines = doc.catalog.lookup(PDFName.of('Outlines')) as import('@cantoo/pdf-lib').PDFDict;
    const first = outlines.lookup(PDFName.of('First')) as import('@cantoo/pdf-lib').PDFDict;
    const last = outlines.lookup(PDFName.of('Last')) as import('@cantoo/pdf-lib').PDFDict;
    expect(first.lookup(PDFName.of('Title'))!.toString()).toContain('First');
    expect((first.lookup(PDFName.of('Next')) as import('@cantoo/pdf-lib').PDFDict).lookup(PDFName.of('Title'))).toEqual(last.lookup(PDFName.of('Title')));
    expect(outlines.lookup(PDFName.of('Count'))!.toString()).toBe('2');
  });

  it('adds page and web links', async () => {
    let bytes = await sample();
    bytes = await addLink(bytes, 0, { x: 10, y: 10, w: 50, h: 20 }, { url: 'https://example.org' });
    bytes = await addLink(bytes, 0, { x: 10, y: 40, w: 50, h: 20 }, { page: 0, y: 200 });
    const doc = await PDFDocument.load(bytes);
    const annots = doc.getPage(0).node.Annots()!;
    expect(annots.size()).toBe(2);
    const s = annots.asArray().map((r) => doc.context.lookup(r)!.toString()).join('\n');
    expect(s).toContain('/URI (https://example.org)');
    expect(s).toContain('/XYZ');
  });
});
