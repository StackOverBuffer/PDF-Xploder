import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb, degrees } from '@cantoo/pdf-lib';
import { parseContent, writeContent } from '../src/lib/content/syntax';
import { describeObjects, editPage, readPage } from '../src/lib/content/page';
import { about, rotate, translate } from '../src/lib/content/matrix';

const enc = new TextEncoder();

describe('content syntax', () => {
  it('tokenises operands, strings, arrays, dicts and inline images, and writes them back', () => {
    const src = '1 0 0 1 10.5 -3 cm /F1 12 Tf (a\\(b\\)\\\\ \\101) Tj [<0041> -250 (x)] TJ /P <</MCID 3>> BDC EMC BI /W 2 /H 1 /BPC 8 /CS /G ID \x01\x02 EI Q';
    const ops = parseContent(enc.encode(src));
    expect(ops.map((o) => o.op)).toEqual(['cm', 'Tf', 'Tj', 'TJ', 'BDC', 'EMC', 'BI', 'Q']);
    expect(ops[0].args).toEqual([1, 0, 0, 1, 10.5, -3]);
    expect(new TextDecoder().decode((ops[2].args[0] as { bytes: Uint8Array }).bytes)).toBe('a(b)\\ A');
    expect(ops[6].inline!.data).toEqual(new Uint8Array([1, 2]));
    // Writing and re-parsing gives the same operators.
    expect(parseContent(writeContent(ops))).toEqual(ops);
  });
});

async function samplePage() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Hello ', { x: 20, y: 350, size: 20, font: helv });
  page.drawText('world', { x: 20 + helv.widthOfTextAtSize('Hello ', 20), y: 350, size: 20, font: helv, color: rgb(1, 0, 0) });
  page.drawText('Second line', { x: 20, y: 320, size: 12, font: helv });
  page.drawRectangle({ x: 50, y: 100, width: 100, height: 50, color: rgb(0, 0, 1), rotate: degrees(0) });
  // Work on a saved document, as the app does (pdf-lib embeds fonts on save).
  const loaded = await PDFDocument.load(await doc.save());
  return { doc: loaded, page: loaded.getPage(0) };
}

describe('content objects', () => {
  it('splits a page into text lines and shapes with sensible bounds', async () => {
    const { page } = await samplePage();
    const info = describeObjects(readPage(page));
    expect(info.map((o) => [o.kind, o.text])).toEqual([
      ['text', 'Hello '], ['text', 'world'], ['text', 'Second line'], ['path', undefined],
    ]);
    const hello = info[0];
    expect(hello.fontName).toBe('Helvetica');
    expect(hello.fontSize).toBe(20);
    expect(hello.bbox.x).toBeCloseTo(20);
    expect(hello.bbox.w).toBeGreaterThan(50);
    expect(info[1].fill).toBe('#ff0000');
    expect(info[3]).toMatchObject({ kind: 'path', fill: '#0000ff', bbox: { x: 50, y: 100, w: 100, h: 50 } });
  });

  it('moves, rotates, recolours, re-types, reorders and deletes objects', async () => {
    const { doc, page } = await samplePage();
    const sel = await editPage(page, [
      { type: 'transform', ids: [3], m: translate(100, 50) },
      { type: 'text', id: 2, text: 'Changed line' },
      { type: 'fill', ids: [0], color: '#00ff00' },
      { type: 'arrange', ids: [3], to: 'back' },
    ]);
    expect(sel).toEqual([0]); // the rectangle, now at the back
    const reread = await PDFDocument.load(await doc.save());
    const info = describeObjects(readPage(reread.getPage(0)));
    expect(info.map((o) => o.text ?? o.kind)).toEqual(['path', 'Hello ', 'world', 'Changed line']);
    expect(info[0].bbox).toEqual({ x: 150, y: 150, w: 100, h: 50 });
    expect(info[1].fill).toBe('#00ff00');
    // Helvetica can encode the new text, so the line keeps its font.
    expect(info[3].fontName).toBe('Helvetica');

    const p = reread.getPage(0);
    const b = info[0].bbox;
    await editPage(p, [{ type: 'transform', ids: [0], m: about(rotate(90), b.x + b.w / 2, b.y + b.h / 2) }, { type: 'delete', ids: [2] }]);
    const after = describeObjects(readPage(p));
    expect(after.map((o) => o.text ?? o.kind)).toEqual(['path', 'Hello ', 'Changed line']);
    expect(after[0].bbox.w).toBeCloseTo(50);
    expect(after[0].bbox.h).toBeCloseTo(100);
  });

  it('falls back to Noto Sans for characters the original font lacks, and adds content', async () => {
    const { doc, page } = await samplePage();
    await editPage(page, [
      { type: 'text', id: 0, text: 'Привет ✓' },
      { type: 'addText', at: { x: 30, y: 30 }, text: 'New', size: 10, color: '#333333', font: 'Helvetica' },
      { type: 'addShape', shape: 'rect', rect: { x: 10, y: 10, w: 20, h: 20 }, stroke: '#000000', fill: null, width: 1 },
    ]);
    const info = describeObjects(readPage((await PDFDocument.load(await doc.save())).getPage(0)));
    expect(info[0].text).toBe('Привет ✓');
    expect(info[0].fontName).toMatch(/^Noto/);
    expect(info.slice(-2).map((o) => [o.kind, o.text])).toEqual([['text', 'New'], ['path', undefined]]);
    expect(info[info.length - 1].stroke).toBe('#000000');
    expect(info[info.length - 1].fill).toBeUndefined();
  });

  it('keeps clipping, transparency and marked content when re-emitting', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const gs = doc.context.obj({ Type: 'ExtGState', ca: 0.5 });
    const res = page.node.normalizedEntries().Resources;
    res.set(doc.context.obj('ExtGState') as never, doc.context.obj({ G0: gs }));
    page.node.set(doc.context.obj('Contents') as never, doc.context.register(doc.context.stream('/OC /L1 BDC q 0 0 100 100 re W n /G0 gs 1 0 0 rg 10 10 150 150 re f Q EMC 0 0 1 rg 5 5 10 10 re f')));
    const pc = readPage(page);
    expect(pc.objects.map((o) => o.kind)).toEqual(['path', 'path']);
    const [clipped, plain] = pc.objects;
    expect(clipped.state.clips).toHaveLength(1);
    expect(clipped.mc.map((o) => o.op)).toEqual(['BDC']);
    expect(Object.values(clipped.state.params)).toEqual([{ gs: 'G0', seq: 1 }]);
    expect(plain.state.clips).toHaveLength(0);
    await editPage(page, [{ type: 'removeClip', ids: [0] }]);
    expect(readPage(page).objects[0].state.clips).toHaveLength(0);
  });
});
