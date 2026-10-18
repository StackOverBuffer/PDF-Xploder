import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { findOnPage, replaceOnPage } from '../src/lib/content/findText';
import { describeObjects, readPage } from '../src/lib/content/page';

async function page() {
  const doc = await PDFDocument.create();
  const p = doc.addPage([400, 400]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  p.drawText('Hello world, hello again', { x: 20, y: 350, size: 20, font: helv });
  p.drawText('Othello said hello', { x: 20, y: 300, size: 10, font: helv });
  const loaded = await PDFDocument.load(await doc.save());
  return { doc: loaded, page: loaded.getPage(0), helv, width: (s: string, size: number) => helv.widthOfTextAtSize(s, size) };
}

const texts = (p: Awaited<ReturnType<typeof page>>['page']) => describeObjects(readPage(p)).filter((o) => o.kind === 'text').map((o) => o.text);

describe('find in page content', () => {
  it('finds matches with exact glyph boxes', async () => {
    const { page: p, width } = await page();
    const m = findOnPage(p, 'hello', { matchCase: false, wholeWord: false });
    expect(m.map((x) => [x.object, x.start])).toEqual([[0, 0], [0, 13], [1, 2], [1, 13]]);
    const [first, second] = m;
    expect(first.rects[0].x).toBeCloseTo(20, 1);
    expect(first.rects[0].w).toBeCloseTo(width('Hello', 20), 1);
    expect(second.rects[0].x).toBeCloseTo(20 + width('Hello world, ', 20), 0);
    // Boxes span the font's height around the baseline.
    expect(first.rects[0].y).toBeLessThan(350);
    expect(first.rects[0].y + first.rects[0].h).toBeGreaterThan(360);
  });

  it('respects match case and whole words', async () => {
    const { page: p } = await page();
    expect(findOnPage(p, 'hello', { matchCase: true, wholeWord: false })).toHaveLength(3);
    expect(findOnPage(p, 'hello', { matchCase: false, wholeWord: true }).map((x) => [x.object, x.start])).toEqual([[0, 0], [0, 13], [1, 13]]);
    expect(findOnPage(p, 'a.b', { matchCase: false, wholeWord: false })).toEqual([]);
  });

  it('replaces all or one occurrence, rewriting the line', async () => {
    const { page: p } = await page();
    expect(await replaceOnPage(p, 'hello', 'bye', { matchCase: false, wholeWord: true })).toBe(3);
    expect(texts(p)).toEqual(['bye world, bye again', 'Othello said bye']);
    expect(await replaceOnPage(p, 'bye', 'Hi', { matchCase: false, wholeWord: false }, { object: 0, start: 11 })).toBe(1);
    expect(texts(p)).toEqual(['bye world, Hi again', 'Othello said bye']);
  });

  it('removes a line that is replaced by nothing', async () => {
    const { page: p } = await page();
    await replaceOnPage(p, 'Othello said hello', '', { matchCase: true, wholeWord: false });
    expect(texts(p)).toEqual(['Hello world, hello again']);
  });
});
