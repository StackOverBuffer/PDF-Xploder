import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { fontsOf, listFonts, isStandardFont } from '../src/lib/fontList';

describe('font list', () => {
  it('lists each font once with its type, embedding and pages', async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const noto = await doc.embedFont(readFileSync('public/fonts/NotoSans-Regular.ttf'), { subset: false });
    const p1 = doc.addPage();
    p1.drawText('Hello', { font: helv, x: 50, y: 700 });
    const p2 = doc.addPage();
    p2.drawText('Hello', { font: helv, x: 50, y: 700 });
    p2.drawText('Grüße', { font: noto, x: 50, y: 600 });
    doc.addPage();
    const fonts = await listFonts(await doc.save());
    expect(fonts).toHaveLength(2);
    const [h, n] = fonts;
    expect(h).toMatchObject({ name: 'Helvetica', type: 'Type1', embedded: false, subset: false, encoding: 'WinAnsiEncoding', pages: [0, 1] });
    expect(isStandardFont(h.name)).toBe(true);
    expect(n.name).toMatch(/^NotoSans-Regular/);
    expect(n).toMatchObject({ type: 'Type0 / CIDFontType2', embedded: true, subset: false, encoding: 'Identity-H', pages: [1] });
  });

  it('recognises subsets and fonts used only inside form XObjects', async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const file = ctx.register(ctx.flateStream(new Uint8Array(10)));
    const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'ABCDEF+Arial', FontDescriptor: { Type: 'FontDescriptor', FontFile2: file } }));
    const form = ctx.register(ctx.stream('BT /F1 12 Tf (x) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10], Resources: { Font: { F1: font } } }));
    doc.addPage();
    const page = doc.addPage();
    page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { X1: form } }));
    expect(fontsOf(doc)).toEqual([{ name: 'Arial', type: 'TrueType', embedded: true, subset: true, encoding: undefined, pages: [1] }]);
  });
});
