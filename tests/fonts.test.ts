import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'node:fs';
import { createTextEngine } from '../src/lib/fonts';
import { subsetFont } from '../src/lib/subset';
import * as ops from '../src/lib/pdfOps';
import type { Annotation } from '../src/lib/types';

const fontNames = (doc: PDFDocument) =>
  doc.context.enumerateIndirectObjects().flatMap(([, o]) =>
    o instanceof PDFDict && o.get(PDFName.of('Type'))?.toString() === '/Font' && o.get(PDFName.of('Subtype'))?.toString() !== '/CIDFontType2'
      ? [o.get(PDFName.of('BaseFont'))!.toString()]
      : [],
  );

describe('text engine', () => {
  it('uses Noto Sans for Latin, Greek and Cyrillic, and Symbols 2 for check marks', async () => {
    const doc = await PDFDocument.create();
    const engine = await createTextEngine(doc, ['Grüße Ωμέγα Привет ✓ ➜']);
    const runs = engine.runs('Grüße Ωμέγα Привет ✓ ➜');
    expect(runs.map((r) => r.text).join('')).toBe('Grüße Ωμέγα Привет ✓ ➜');
    expect(runs.length).toBe(4); // sans, symbols, sans (space), symbols
    expect(engine.width('abc', 10)).toBeGreaterThan(0);
  });

  it.skipIf(!process.env.CJK_FONT)('draws CJK text with the on-demand font', async () => {
    const doc = await PDFDocument.create();
    const engine = await createTextEngine(doc, ['你好, こんにちは, 안녕 ✓']);
    const runs = engine.runs('你好, こんにちは, 안녕 ✓');
    expect(runs.map((r) => r.text).join('')).toBe('你好, こんにちは, 안녕 ✓');
  });

  it.skipIf(!!process.env.CJK_FONT)('replaces characters no available font covers', async () => {
    const doc = await PDFDocument.create();
    const engine = await createTextEngine(doc, ['你好 ok']);
    expect(engine.runs('你好 ok').map((r) => r.text).join('')).toBe('?? ok');
  });

  it('embeds only the fonts it needs, as subsets', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const a: Annotation = { id: '1', type: 'text', rect: { x: 10, y: 10, w: 300, h: 50 }, text: 'Café ✓', fontSize: 12, border: false, color: '#000', opacity: 1, author: '', createdAt: 0 };
    const bytes = await ops.exportWithAnnotations(await doc.save(), [[a]], { flatten: true });
    const names = fontNames(await PDFDocument.load(bytes));
    expect(names).toEqual([expect.stringMatching(/^\/NotoSans-Regular/), expect.stringMatching(/^\/NotoSansSymbols2-Regular/)]);
    // Subsetting keeps the file tiny compared to the 1.8 MB of font files used.
    expect(bytes.length).toBeLessThan(40_000);
  });

  it('subsets fonts into small, valid fonts that keep the requested glyphs', async () => {
    const full = new Uint8Array(readFileSync('public/fonts/NotoSans-Regular.ttf'));
    const text = 'Grüße Ωμέγα Привет';
    const sub = await subsetFont(full, [...text].map((c) => c.codePointAt(0)!));
    expect(sub.length).toBeLessThan(full.length / 20);
    const font = fontkit.create(sub as never) as unknown as { hasGlyphForCodePoint(cp: number): boolean; numGlyphs: number };
    for (const ch of text) expect(font.hasGlyphForCodePoint(ch.codePointAt(0)!)).toBe(true);
    expect(font.hasGlyphForCodePoint('Z'.codePointAt(0)!)).toBe(false);
    expect(font.numGlyphs).toBeLessThan(40);
  });

  it('fills form fields with non-Latin text', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    doc.getForm().createTextField('name').addToPage(page, { x: 10, y: 10, width: 200, height: 20 });
    const filled = await ops.setFormValues(await doc.save(), { name: 'Ζωή Łukasz' });
    expect(await ops.getFormFields(filled)).toMatchObject([{ name: 'name', value: 'Ζωή Łukasz' }]);
  });
});
