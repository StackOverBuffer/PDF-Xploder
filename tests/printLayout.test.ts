import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, degrees } from '@cantoo/pdf-lib';
import { DEFAULT_PRINT, PAPERS, buildPrintPdf, isPlain, planSheets, printedPages, type PrintOptions } from '../src/lib/printLayout';

const A4 = { width: 595.28, height: 841.89 };
const LAND = { width: 841.89, height: 595.28 };
const opts = (o: Partial<PrintOptions>): PrintOptions => ({ ...DEFAULT_PRINT, pages: [0, 1, 2, 3, 4], ...o });

describe('print layout', () => {
  it('picks odd/even page numbers and reverses', () => {
    expect(printedPages(opts({ subset: 'odd' }))).toEqual([0, 2, 4]);
    expect(printedPages(opts({ subset: 'even', reverse: true }))).toEqual([3, 1]);
  });

  it('keeps pages as they are by default', () => {
    const sheets = planSheets(opts({}), [A4, LAND, A4, A4, A4]);
    expect(sheets).toHaveLength(5);
    expect(sheets[1]).toMatchObject({ width: LAND.width, height: LAND.height });
    expect(sheets[0].items[0]).toMatchObject({ x: 0, y: 0, scale: 1 });
    expect(isPlain(opts({}), 5)).toBe(true);
    expect(isPlain(opts({ perSheet: 2 }), 5)).toBe(false);
  });

  it('puts two portrait pages side by side on a landscape sheet', () => {
    const sheets = planSheets(opts({ paper: 'A4', perSheet: 2 }), [A4, A4, A4, A4, A4]);
    expect(sheets).toHaveLength(3);
    const [s] = sheets;
    expect(s.width).toBeCloseTo(PAPERS.A4[1]);
    const [a, b] = s.items;
    expect(a.page).toBe(0);
    expect(b.x).toBeGreaterThan(a.x + a.w);
    expect(a.y).toBeCloseTo(b.y);
    // Fit: as large as the cell allows, never past the sheet.
    expect(a.h).toBeLessThanOrEqual(s.height + 1e-6);
    expect(sheets[2].items).toHaveLength(1);
  });

  it('orders 4-up rows first or columns first', () => {
    const sizes = [A4, A4, A4, A4];
    const pos = (order: 'horizontal' | 'vertical') => planSheets(opts({ paper: 'A4', perSheet: 4, order, pages: [0, 1, 2, 3] }), sizes)[0].items.map((i) => [Math.round(i.cell.x), Math.round(i.cell.y)]);
    const h = pos('horizontal');
    const v = pos('vertical');
    expect(h[1][1]).toBe(h[0][1]); // second page beside the first
    expect(v[1][0]).toBe(v[0][0]); // second page below the first
    expect(v[1][1]).toBeLessThan(v[0][1]);
  });

  it('scales: shrink only shrinks, actual size keeps 100 %, custom uses the percentage', () => {
    const small = { width: 200, height: 300 };
    const one = (scaling: PrintOptions['scaling'], customScale = 100) => planSheets(opts({ paper: 'A4', scaling, customScale, pages: [0] }), [small])[0].items[0].scale;
    expect(one('fit')).toBeGreaterThan(1);
    expect(one('shrink')).toBe(1);
    expect(one('actual')).toBe(1);
    expect(one('custom', 50)).toBe(0.5);
  });

  it('builds one PDF page per sheet, with rotated pages upright', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([A4.width, A4.height]).drawText('one', { x: 50, y: 700 });
    doc.addPage([A4.width, A4.height]).setRotation(degrees(90));
    doc.addPage([LAND.width, LAND.height]).drawText('three', { x: 50, y: 500 });
    const bytes = await doc.save();
    const sizes = [A4, LAND, LAND];
    const sheets = planSheets(opts({ paper: 'A4', perSheet: 2, borders: true, pages: [0, 1, 2] }), sizes);
    const out = await PDFDocument.load(await buildPrintPdf(bytes, sheets));
    expect(out.getPageCount()).toBe(2);
    expect(out.getPage(0).getWidth()).toBeCloseTo(PAPERS.A4[1]);
    // Page 1 drawn on sheet 1; page 2 is empty (no content) but still gets its frame; page 3 on sheet 2.
    const xobjects = (p: number) => out.getPage(p).node.Resources()!.get(PDFName.of('XObject')) as PDFDict | undefined;
    expect(xobjects(0)?.keys()).toHaveLength(1);
    expect(xobjects(1)?.keys()).toHaveLength(1);
  });
});
