import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import * as ops from '../src/lib/pdfOps';
import type { Annotation } from '../src/lib/types';

async function makeDoc(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) {
    const p = doc.addPage([200 + i, 300]);
    p.drawText(`Page ${i + 1}`, { x: 20, y: 250, size: 12, font });
  }
  return doc.save();
}

const widths = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth());

describe('page operations', () => {
  it('rotates selected pages', async () => {
    const out = await ops.rotatePages(await makeDoc(3), [0, 2], 90);
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0, 90]);
    const again = await PDFDocument.load(await ops.rotatePages(out, [0], -180));
    expect(again.getPage(0).getRotation().angle).toBe(270);
  });

  it('deletes pages but refuses to delete all', async () => {
    const bytes = await makeDoc(3);
    expect(await widths(await ops.deletePages(bytes, [1]))).toEqual([200, 202]);
    await expect(ops.deletePages(bytes, [0, 1, 2])).rejects.toThrow();
  });

  it('reorders pages', async () => {
    expect(await widths(await ops.reorderPages(await makeDoc(3), [2, 0, 1]))).toEqual([202, 200, 201]);
  });

  it('duplicates pages after the original', async () => {
    expect(await widths(await ops.duplicatePages(await makeDoc(2), [0, 1]))).toEqual([200, 200, 201, 201]);
  });

  it('inserts blank pages and other documents', async () => {
    const bytes = await makeDoc(2);
    expect(await widths(await ops.insertBlankPage(bytes, 1))).toEqual([200, 200, 201]);
    const merged = await ops.insertDocument(bytes, await makeDoc(1), 1);
    expect(merged.count).toBe(1);
    expect(await widths(merged.bytes)).toEqual([200, 200, 201]);
  });

  it('extracts and splits', async () => {
    const bytes = await makeDoc(5);
    expect(await widths(await ops.extractPages(bytes, [3, 1]))).toEqual([203, 201]);
    const parts = await ops.splitEvery(bytes, 2);
    expect(await Promise.all(parts.map(widths))).toEqual([[200, 201], [202, 203], [204]]);
  });

  it('crops using displayed margins', async () => {
    const out = await ops.cropPages(await makeDoc(1), [0], { top: 10, right: 20, bottom: 30, left: 40 });
    const box = (await PDFDocument.load(out)).getPage(0).getCropBox();
    expect(box).toEqual({ x: 40, y: 30, width: 140, height: 260 });
  });
});

describe('document operations', () => {
  it('round-trips metadata', async () => {
    const m = { title: 'T', author: 'A', subject: 'S', keywords: 'k1, k2', creator: 'C', producer: 'P' };
    const out = await ops.setMetadata(await makeDoc(1), m);
    expect(await ops.getMetadata(out)).toEqual({ ...m, keywords: 'k1 k2' });
  });

  it('stamps watermarks and header/footers on every page', async () => {
    const bytes = await makeDoc(2);
    const wm = await ops.addWatermark(bytes, { text: 'DRAFT ✓', fontSize: 40, color: '#ff0000', opacity: 0.3, angle: 45, pages: 'all' });
    expect(wm.length).toBeGreaterThan(bytes.length);
    const hf = await ops.addHeaderFooter(bytes, {
      template: 'Page {page} of {pages} {bates}', position: 'bottom-center', fontSize: 10, color: '#000000',
      margin: 20, startNumber: 1, batesPrefix: 'ABC', batesDigits: 6, pages: 'all',
    });
    expect(hf.length).toBeGreaterThan(bytes.length);
  });

  it('formats header/footer templates', () => {
    const o = { template: '{page}/{pages} {bates}', position: 'top-left' as const, fontSize: 10, color: '#000', margin: 10, startNumber: 5, batesPrefix: 'X-', batesDigits: 4, pages: 'all' as const };
    expect(ops.formatHeaderFooter(o, 0, 3, '')).toBe('5/7 X-0005');
  });

  it('reads and fills form fields', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const form = doc.getForm();
    form.createTextField('name').addToPage(page, { x: 10, y: 200, width: 200, height: 20 });
    form.createCheckBox('agree').addToPage(page, { x: 10, y: 150, width: 15, height: 15 });
    const dd = form.createDropdown('color');
    dd.addOptions(['red', 'blue']);
    dd.addToPage(page, { x: 10, y: 100, width: 100, height: 20 });
    const bytes = await doc.save();

    const filled = await ops.setFormValues(bytes, { name: 'Ada', agree: true, color: 'blue' });
    const fields = await ops.getFormFields(filled);
    expect(fields).toMatchObject([
      { kind: 'text', name: 'name', value: 'Ada', multiline: false, readOnly: false },
      { kind: 'checkbox', name: 'agree', value: true, readOnly: false },
      { kind: 'dropdown', name: 'color', value: 'blue', options: ['red', 'blue'], readOnly: false },
    ]);
    const flat = await ops.setFormValues(filled, {}, { flatten: true });
    expect(await ops.getFormFields(flat)).toEqual([]);
  });
});

describe('export', () => {
  const base = { color: '#ff0000', opacity: 1, author: 'me', createdAt: 0 };
  const all: Annotation[] = [
    { ...base, id: '1', type: 'highlight', rects: [{ x: 10, y: 10, w: 50, h: 10 }] },
    { ...base, id: '2', type: 'underline', rects: [{ x: 10, y: 30, w: 50, h: 10 }] },
    { ...base, id: '3', type: 'ink', width: 2, paths: [[{ x: 1, y: 1 }, { x: 20, y: 20 }], [{ x: 5, y: 5 }]] },
    { ...base, id: '4', type: 'rect', rect: { x: 50, y: 50, w: 30, h: 30 }, width: 2, fill: '#00ff00' },
    { ...base, id: '5', type: 'ellipse', rect: { x: 50, y: 50, w: 30, h: 20 }, width: 2, fill: null },
    { ...base, id: '6', type: 'arrow', p1: { x: 0, y: 0 }, p2: { x: 100, y: 100 }, width: 2 },
    { ...base, id: '61', type: 'polygon', vertices: [{ x: 10, y: 150 }, { x: 60, y: 180 }, { x: 90, y: 150 }, { x: 50, y: 130 }], width: 2, fill: '#00aaff' },
    { ...base, id: '62', type: 'polyline', vertices: [{ x: 110, y: 150 }, { x: 140, y: 190 }, { x: 170, y: 140 }, { x: 190, y: 170 }], width: 1.5, fill: null },
    { ...base, id: '63', type: 'cloud', vertices: [{ x: 120, y: 220 }, { x: 180, y: 240 }, { x: 160, y: 260 }, { x: 110, y: 250 }], width: 2, fill: null },
    { ...base, id: '7', type: 'text', rect: { x: 20, y: 100, w: 120, h: 60 }, text: 'Hello wrapped world – ünïcode 你好', fontSize: 12, border: true },
    { ...base, id: '8', type: 'note', at: { x: 150, y: 280 }, text: 'A note' },
    { ...base, id: '9', type: 'stamp', rect: { x: 20, y: 200, w: 100, h: 40 }, label: 'Approved' },
    { ...base, id: '10', type: 'redact', rect: { x: 0, y: 0, w: 10, h: 10 } },
  ];

  it('returns the input unchanged when there is nothing to draw', async () => {
    const bytes = await makeDoc(1);
    expect(await ops.exportWithAnnotations(bytes, [[]])).toBe(bytes);
  });

  const pngSrc = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const withImage: Annotation[] = [...all, { ...base, id: '11', type: 'image', rect: { x: 30, y: 30, w: 40, h: 40 }, rot: 0, src: pngSrc, signature: true }];
  const subtypes = async (bytes: Uint8Array) => {
    const doc = await PDFDocument.load(bytes);
    const annots = doc.getPage(0).node.Annots();
    return (annots?.asArray() ?? []).map((r) => (doc.context.lookup(r) as PDFDict).get(PDFName.of('Subtype'))!.toString());
  };

  for (const rotation of [0, 90, 180, 270]) {
    it(`flattens every annotation type on a page rotated ${rotation}°`, async () => {
      const bytes = await ops.rotatePages(await makeDoc(1), [0], rotation);
      const out = await ops.exportWithAnnotations(bytes, [withImage], { flatten: true, burnRedactions: true });
      expect(await subtypes(out)).toEqual([]);
    });

    it(`writes native annotations that round-trip losslessly at ${rotation}°`, async () => {
      const bytes = await ops.rotatePages(await makeDoc(1), [0], rotation);
      const out = await ops.exportWithAnnotations(bytes, [withImage]);
      expect(await subtypes(out)).toEqual([
        '/Highlight', '/Underline', '/Ink', '/Square', '/Circle', '/Line', '/Polygon', '/PolyLine', '/Polygon', '/FreeText', '/Text', '/Stamp', '/Redact', '/Stamp',
      ]);
      const back = await ops.importForEditing(out, () => 'new');
      expect(back.count).toBe(withImage.length);
      expect(back.annotations[0]).toEqual(withImage);
      // Imported annotations are removed from the page so they are not drawn twice.
      expect(await subtypes(back.bytes)).toEqual([]);
    });
  }

  it('follows a move made by another editor', async () => {
    const out = await ops.exportWithAnnotations(await makeDoc(1), [[all[3]]]);
    const doc = await PDFDocument.load(out);
    const dict = doc.context.lookup(doc.getPage(0).node.Annots()!.get(0)) as PDFDict;
    const r = (dict.get(PDFName.of('Rect')) as PDFArray).asArray().map((x) => (x as PDFNumber).asNumber());
    dict.set(PDFName.of('Rect'), doc.context.obj([r[0] + 10, r[1] - 5, r[2] + 10, r[3] - 5]));
    dict.set(PDFName.of('Contents'), PDFHexString.fromText('edited elsewhere'));
    const back = await ops.importForEditing(await doc.save(), () => 'x');
    expect(back.annotations[0][0]).toMatchObject({ type: 'rect', rect: { x: 60, y: 45, w: 30, h: 30 }, comment: 'edited elsewhere' });
  });

  it('imports standard annotations written by other software', async () => {
    const doc = await PDFDocument.load(await makeDoc(1));
    const page = doc.getPage(0);
    const add = (o: Record<string, unknown>) => page.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', ...o } as never)));
    add({ Subtype: 'Highlight', Rect: [10, 10, 60, 22], QuadPoints: [10, 22, 60, 22, 10, 10, 60, 10], C: [1, 1, 0], T: PDFHexString.fromText('Ann'), Contents: PDFHexString.fromText('Look'), M: PDFString.of("D:20240102030405Z") });
    add({ Subtype: 'FreeText', Rect: [20, 100, 150, 140], Contents: PDFHexString.fromText('Typewriter'), DA: PDFString.of('/Helv 10 Tf 0 0 1 rg') });
    add({ Subtype: 'Line', Rect: [0, 0, 100, 100], L: [0, 0, 100, 100], LE: ['None', 'OpenArrow'], BS: { W: 3 }, C: [0, 0, 1] });
    add({ Subtype: 'Square', Rect: [50, 50, 80, 80], BS: { W: 2 }, C: [1, 0, 0], IC: [0, 1, 0] });
    add({ Subtype: 'Ink', Rect: [0, 0, 10, 10], InkList: [[1, 1, 5, 5, 9, 1]], C: [0, 0, 0] });
    add({ Subtype: 'Text', Rect: [150, 270, 170, 290], Contents: PDFHexString.fromText('note'), C: [1, 0.8, 0] });
    add({ Subtype: 'Polygon', Rect: [0, 200, 100, 260], Vertices: [10, 210, 80, 220, 50, 250], BS: { W: 2 }, C: [1, 0, 0], IC: [0, 0.5, 1] });
    add({ Subtype: 'PolyLine', Rect: [0, 100, 100, 160], Vertices: [10, 110, 50, 150, 90, 120], BS: { W: 3 }, C: [0, 1, 0] });
    add({ Subtype: 'Polygon', Rect: [100, 200, 200, 260], Vertices: [110, 210, 190, 220, 150, 250], BS: { W: 2 }, BE: { S: 'Cloudy', I: 1 }, C: [0.5, 0.5, 0.5] });
    add({ Subtype: 'Link', Rect: [0, 0, 10, 10] });
    const back = await ops.importForEditing(await doc.save(), () => 'gen');
    expect(back.count).toBe(9);
    expect(back.annotations[0].map((a) => a.type)).toEqual(['highlight', 'text', 'arrow', 'rect', 'ink', 'note', 'polygon', 'polyline', 'cloud']);
    expect(back.annotations[0][0]).toMatchObject({ color: '#ffff00', author: 'Ann', comment: 'Look', createdAt: Date.UTC(2024, 0, 2, 3, 4, 5), rects: [{ x: 10, y: 10, w: 50, h: 12 }] });
    expect(back.annotations[0][1]).toMatchObject({ text: 'Typewriter', fontSize: 10, color: '#0000ff', rect: { x: 20, y: 100, w: 130, h: 40 } });
    expect(back.annotations[0][3]).toMatchObject({ rect: { x: 51, y: 51, w: 28, h: 28 }, width: 2, fill: '#00ff00' });
    expect(back.annotations[0][5]).toMatchObject({ at: { x: 150, y: 290 }, text: 'note' });
    expect(back.annotations[0][6]).toMatchObject({ type: 'polygon', vertices: [{ x: 10, y: 210 }, { x: 80, y: 220 }, { x: 50, y: 250 }], width: 2, fill: '#0080ff' });
    expect(back.annotations[0][7]).toMatchObject({ type: 'polyline', vertices: [{ x: 10, y: 110 }, { x: 50, y: 150 }, { x: 90, y: 120 }], width: 3, fill: null });
    expect(back.annotations[0][8]).toMatchObject({ type: 'cloud', width: 2 });
    // The link is not editable and stays in the document.
    expect(await subtypes(back.bytes)).toEqual(['/Link']);
  });

  it('replaces pages with images', async () => {
    // 1x1 transparent PNG
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
    const bytes = await ops.rotatePages(await makeDoc(2), [1], 90);
    const out = await PDFDocument.load((await ops.replacePagesWithImages(bytes, [{ index: 1, png }])).bytes);
    const p = out.getPage(1);
    expect([p.getWidth(), p.getHeight(), p.getRotation().angle]).toEqual([300, 201, 0]);
  });

  it('drops form fields (and their values) that sit on redacted pages', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
    const doc = await PDFDocument.create();
    const [a, b] = [doc.addPage([300, 300]), doc.addPage([300, 300])];
    const form = doc.getForm();
    const keep = form.createTextField('keep');
    keep.setText('public');
    keep.addToPage(a, { x: 10, y: 10, width: 100, height: 20 });
    const secret = form.createTextField('ssn');
    secret.setText('123-45-6789');
    secret.addToPage(b, { x: 10, y: 10, width: 100, height: 20 });
    const res = await ops.replacePagesWithImages(await doc.save(), [{ index: 1, png }]);
    expect(res.removedFields).toEqual(['ssn']);
    const out = await PDFDocument.load(res.bytes);
    expect(out.getForm().getFields().map((f) => f.getName())).toEqual(['keep']);
    expect(new TextDecoder('latin1').decode(res.bytes)).not.toContain('123-45-6789');
  });
});
