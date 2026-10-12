import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
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
    expect(fields).toEqual([
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
    { ...base, id: '7', type: 'text', rect: { x: 20, y: 100, w: 120, h: 60 }, text: 'Hello wrapped world – ünïcode 你好', fontSize: 12, border: true },
    { ...base, id: '8', type: 'note', at: { x: 150, y: 280 }, text: 'A note' },
    { ...base, id: '9', type: 'stamp', rect: { x: 20, y: 200, w: 100, h: 40 }, label: 'Approved' },
    { ...base, id: '10', type: 'redact', rect: { x: 0, y: 0, w: 10, h: 10 } },
  ];

  it('returns the input unchanged when there is nothing to draw', async () => {
    const bytes = await makeDoc(1);
    expect(await ops.exportWithAnnotations(bytes, [[]])).toBe(bytes);
  });

  for (const rotation of [0, 90, 180, 270]) {
    it(`flattens every annotation type on a page rotated ${rotation}°`, async () => {
      const bytes = await ops.rotatePages(await makeDoc(1), [0], rotation);
      const out = await ops.exportWithAnnotations(bytes, [all], { includeRedactions: true });
      const doc = await PDFDocument.load(out);
      // The sticky note is written as a real /Text annotation.
      expect(doc.getPage(0).node.Annots()?.size()).toBe(1);
    });
  }

  it('replaces pages with images', async () => {
    // 1x1 transparent PNG
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
    const bytes = await ops.rotatePages(await makeDoc(2), [1], 90);
    const out = await PDFDocument.load(await ops.replacePagesWithImages(bytes, [{ index: 1, png }]));
    const p = out.getPage(1);
    expect([p.getWidth(), p.getHeight(), p.getRotation().angle]).toEqual([300, 201, 0]);
  });
});
