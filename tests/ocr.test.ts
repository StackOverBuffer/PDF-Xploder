import { describe, expect, it } from 'vitest';
import { draw, hasCanvas } from './ocrHelpers';
import { binarize, createRaster, fillBox, rotateQuarter, rotateRaster, toGray, type Raster } from '../src/lib/ocr/raster';
import { detectSkew, uprightness } from '../src/lib/ocr/skew';
import { estimateSlant, isMonospaced, measureWord, styleLines } from '../src/lib/ocr/style';
import { detectRulings, detectTables } from '../src/lib/ocr/tables';
import { detectPictures } from '../src/lib/ocr/pictures';
import { analysePage, eraseRecognised } from '../src/lib/ocr/analyse';
import { apply, placement, quarterMatrix, rotationMatrix, textMatrix } from '../src/lib/ocr/mapping';
import type { OcrLine, OcrPage, OcrWord } from '../src/lib/ocr/types';

const SAMPLE = [
  'Sehr geehrte Damen und Herren, wir bedanken uns für Ihre Anfrage',
  'und bieten Ihnen hiermit die folgenden Leistungen an. Bitte prüfen',
  'Sie unser Angebot; bei Fragen stehen wir Ihnen gerne zur Verfügung.',
  'The quick brown fox jumps over the lazy dog while the band plays.',
  'Mit freundlichen Grüßen aus Köln, Ihre Buchhaltung und das Team.',
];

/** A page of text (≈ 100 dpi scale), optionally rotated clockwise by `deg`. */
function textPage(deg = 0, w = 900, h = 700): Raster {
  return draw(w, h, (g) => {
    g.translate(w / 2, h / 2);
    g.rotate((deg * Math.PI) / 180);
    g.translate(-w / 2, -h / 2);
    g.font = '22px "DejaVu Sans"';
    SAMPLE.forEach((t, i) => g.fillText(t, 60, 150 + i * 40));
    SAMPLE.forEach((t, i) => g.fillText(t.toLowerCase(), 60, 400 + i * 40));
  });
}

/** Ink bounds of a raster region. */
function inkBox(r: Raster, x0 = 0, y0 = 0, x1 = r.width, y1 = r.height) {
  const g = toGray(r);
  let b = { x0: x1, y0: y1, x1: x0, y1: y0 };
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (g.data[y * r.width + x] < 128) b = { x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x + 1), y1: Math.max(b.y1, y + 1) };
  return b;
}

/** A one-word line as Tesseract would report it, with the baseline at `base`. */
function wordLine(r: Raster, base: number, size: number, x0 = 0, x1 = r.width): { line: OcrLine; word: OcrWord } {
  const box = inkBox(r, x0, 0, x1, Math.round(base + size * 0.25));
  const word: OcrWord = { text: 'x', conf: 90, box, symbols: [] };
  return { word, line: { box, baseline: { x0: box.x0, y0: base, x1: box.x1, y1: base }, rowHeight: size * 0.93, words: [word] } };
}

describe('OCR raster geometry', () => {
  it('turns pixels exactly as quarterMatrix maps their centres', () => {
    const r = createRaster(5, 3, [255, 255, 255]);
    fillBox(r, { x0: 1, y0: 0, x1: 2, y1: 1 }, [0, 0, 0]);
    for (const q of [1, 2, 3]) {
      const t = rotateQuarter(r, q);
      const p = apply(quarterMatrix(q, 5, 3), 1.5, 0.5);
      const i = (Math.floor(p.y) * t.width + Math.floor(p.x)) * 4;
      expect(t.data[i]).toBe(0);
      expect([t.width, t.height]).toEqual(q % 2 ? [3, 5] : [5, 3]);
    }
  });

  it('rotates content clockwise about the centre as rotationMatrix describes', () => {
    const r = createRaster(101, 101);
    fillBox(r, { x0: 80, y0: 49, x1: 84, y1: 53 }, [0, 0, 0]);
    const t = rotateRaster(r, 90);
    const p = apply(rotationMatrix(90, 101, 101), 82, 51);
    expect(Math.round(p.x)).toBe(50);
    expect(Math.round(p.y)).toBe(82);
    expect(t.data[(Math.floor(p.y) * 101 + Math.floor(p.x)) * 4]).toBeLessThan(60);
  });

  it('maps recognised pixels into user space through the viewport (rotated page)', () => {
    // pdf.js viewport of a 600×800 page with /Rotate 90 at scale 2: user (x, y) → (2y, 2x).
    const viewport: [number, number, number, number, number, number] = [0, 2, 2, 0, 0, 0];
    const { pxToUser, imageToUser } = placement(viewport, [1, 0, 0, 1, 0, 0], 1600, 1200);
    expect(apply(pxToUser, 200, 100)).toEqual({ x: 50, y: 100 });
    // The image's unit square covers the whole page.
    expect(apply(imageToUser, 0, 0)).toEqual({ x: 600, y: 0 });
    expect(apply(imageToUser, 1, 1)).toEqual({ x: 0, y: 800 });
    // Text along the image's x axis runs along user +y here, upright in the view.
    const tm = textMatrix(pxToUser, 200, 100);
    expect(tm.map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 1, -1, 0, 50, 100]);
  });
});

describe.skipIf(!hasCanvas)('OCR skew and orientation', () => {
  it('detects small skews in both directions', () => {
    for (const deg of [0, 2.5, -4, 9]) {
      const s = detectSkew(binarize(toGray(textPage(deg))));
      expect(Math.abs(s.angle - deg)).toBeLessThan(0.2);
    }
  });

  it('tells upright text from upside-down text', () => {
    const page = textPage();
    expect(uprightness(binarize(toGray(page))).vote).toBe(1);
    expect(uprightness(binarize(toGray(rotateQuarter(page, 2)))).vote).toBe(-1);
  });

  it('finds the quarter turns and skew that make a page upright', async () => {
    const none = async (): Promise<OcrPage> => ({ width: 0, height: 0, lines: [], confidence: 0 });
    const opts = { dpi: 100, detectSkew: true, detectRotation: true, styles: false, tables: false, pictures: false };
    for (const q of [0, 1, 2, 3]) {
      const a = await analysePage(rotateQuarter(textPage(), q), opts, none);
      // The page was turned q times clockwise; turning it (4 − q) more makes it upright.
      expect(a.quarterTurns).toBe((4 - q) % 4);
      expect(a.skew).toBe(0);
    }
    const skewed = await analysePage(textPage(3), opts, none);
    expect(skewed.quarterTurns).toBe(0);
    expect(skewed.skew).toBeCloseTo(3, 0);
    expect(skewed.renderedToImage).toEqual(rotationMatrix(-skewed.skew, 900, 700));
  });
});

describe.skipIf(!hasCanvas)('OCR text styles', () => {
  const size = 46;
  const word = (style: string, text = 'Rechnung', extra?: (g: CanvasRenderingContext2D) => void) => {
    const r = draw(520, 120, (g) => {
      g.font = `${style}${size}px "DejaVu Sans"`;
      g.fillText(text, 20, 80);
      extra?.(g);
    });
    return { r, ...wordLine(r, 80, size) };
  };

  it('measures stroke width, slant and decorations', () => {
    const regular = word('');
    const bold = word('bold ');
    const italic = word('italic ');
    const mr = measureWord(regular.r, regular.line, regular.word);
    const mb = measureWord(bold.r, bold.line, bold.word);
    const mi = measureWord(italic.r, italic.line, italic.word);
    expect(mb.stroke / mr.stroke).toBeGreaterThan(1.5);
    expect(Math.abs(mr.slant)).toBeLessThan(0.05);
    expect(mi.slant).toBeGreaterThan(0.15);
    expect(mr.underline).toBeNull();
    expect(mr.strikeout).toBeNull();

    const under = word('', 'Rechnung', (g) => g.fillRect(20, 86, 205, 3));
    const strike = word('', 'Rechnung', (g) => g.fillRect(20, 66, 205, 3));
    const mu = measureWord(under.r, under.line, { ...under.word, box: regular.word.box });
    const ms = measureWord(strike.r, strike.line, strike.word);
    expect(mu.underline && [mu.underline.y0, mu.underline.y1]).toEqual([86, 89]);
    expect(mu.strikeout).toBeNull();
    expect(ms.strikeout && [ms.strikeout.y0, ms.strikeout.y1]).toEqual([66, 69]);
    expect(ms.underline).toBeNull();
  });

  it('estimates slant from synthetic sheared bars, ignoring opposite diagonals', () => {
    const W = 80;
    const H = 40;
    const bars = (shear: number, xs: number[]) => {
      const m = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (const x0 of xs) for (let x = 0; x < 4; x++) m[y * W + Math.round(x0 + x + shear * (H - y))] = 1;
      return m;
    };
    expect(estimateSlant(bars(0, [10, 30, 50]), W, H, 50)).toBeCloseTo(0, 2);
    expect(estimateSlant(bars(0.2, [10, 30, 50]), W, H, 50)).toBeCloseTo(0.2, 1);
    // A "v": one stroke each way averages out to upright.
    const v = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < 4; x++) {
        v[y * W + Math.round(20 + x + 0.3 * y)] = 1;
        v[y * W + Math.round(44 + x - 0.3 * y)] = 1;
      }
    expect(Math.abs(estimateSlant(v, W, H, 50))).toBeLessThan(0.03);
  });

  it('classifies a page of words: colour, bold, italic, serif and decorations', () => {
    // The last word is digits drawn in italic: digits lean on their own, so they follow the (upright) line.
    const fonts = ['', '', 'bold ', '', 'italic ', '', 'italic '];
    const r = draw(1800, 260, (g) => {
      let x = 20;
      fonts.forEach((f, i) => {
        g.font = `${f}${size}px "DejaVu Sans"`;
        g.fillStyle = i === 3 ? '#c62828' : '#000';
        g.fillText(i === 6 ? '2024-17' : 'Angebot', x, 80);
        x += 250;
      });
      g.fillStyle = '#000';
      g.font = `${size}px "DejaVu Serif"`;
      g.fillText('minimum', 20, 200);
      g.fillText('Rechnung', 300, 200);
      g.fillText('Leistung', 600, 200);
      g.fillRect(600, 206, 185, 3);
    });
    const words1 = fonts.map((_, i) => inkBox(r, 20 + i * 250, 0, 20 + i * 250 + 240, 100)).map((box, i) => ({ text: i === 6 ? "2024-17" : "Angebot", conf: 90, box, symbols: [] }));
    const words2 = [[20, 280], [300, 580], [600, 880]].map(([a, b], i) => ({ text: ['minimum', 'Rechnung', 'Leistung'][i], conf: 90, box: inkBox(r, a, 120, b, 205), symbols: [] }));
    const line = (words: OcrWord[], base: number): OcrLine => ({
      box: { x0: 0, y0: base - 45, x1: 1800, y1: base + 12 },
      baseline: { x0: 0, y0: base, x1: 1800, y1: base },
      rowHeight: size * 0.93,
      words,
    });
    const [sans, serif] = styleLines(r, [line(words1, 80), line(words2, 200)], { styles: true });
    expect(sans.words.map((w) => w.style.bold)).toEqual([false, false, true, false, false, false, false]);
    expect(sans.words.map((w) => w.style.italic)).toEqual([false, false, false, false, true, false, false]);
    expect(sans.words[0].style.color).toEqual([0, 0, 0]);
    const red = sans.words[3].style.color;
    expect(red[0]).toBeGreaterThan(150);
    expect(red[1]).toBeLessThan(80);
    expect(sans.words[0].style.family).toBe('sans');
    expect(serif.words[0].style.family).toBe('serif');
    expect(serif.words.map((w) => w.style.underline)).toEqual([false, false, true]);
  });

  it('recognises monospaced lines from evenly spaced characters', () => {
    const sym = (xs: number[], w: number[]) => xs.map((x, i) => ({ text: 'a', box: { x0: x, y0: 0, x1: x + w[i], y1: 10 } }));
    const line = (symbols: OcrWord['symbols']): OcrLine => ({ box: { x0: 0, y0: 0, x1: 200, y1: 10 }, baseline: { x0: 0, y0: 10, x1: 200, y1: 10 }, rowHeight: 10, words: [{ text: 'a', conf: 90, box: { x0: 0, y0: 0, x1: 200, y1: 10 }, symbols }] });
    const widths = [6, 8, 2, 7, 6, 8, 4];
    expect(isMonospaced(line(sym(widths.map((w, i) => i * 10 + (10 - w) / 2), widths)))).toBe(true);
    expect(isMonospaced(line(sym([0, 4, 14, 18, 30, 34, 50], [3, 9, 3, 11, 3, 14, 6])))).toBe(false);
  });
});

describe.skipIf(!hasCanvas)('OCR tables and pictures', () => {
  /** A 3×4 table at 150 dpi with one merged cell, some text and an underlined word. */
  const tablePage = () =>
    draw(1240, 900, (g) => {
      g.fillStyle = '#000';
      const xs = [100, 400, 650, 900, 1150];
      const ys = [100, 160, 220, 280];
      for (const y of ys) g.fillRect(100, y - 1, 1052, 3);
      for (const x of xs) g.fillRect(x - 1, 100, 3, 182);
      // Merge the first two cells of the middle row.
      g.fillStyle = '#fff';
      g.fillRect(398, 162, 5, 56);
      g.fillStyle = '#000';
      g.font = '24px "DejaVu Sans"';
      g.fillText('Position', 120, 140);
      g.fillText('Menge', 420, 140);
      g.fillText('Gesamtbetrag in Euro', 100, 500);
      g.fillRect(100, 506, 260, 2);
      // A grey "photo".
      const grad = g.createLinearGradient(700, 400, 1100, 800);
      grad.addColorStop(0, '#345');
      grad.addColorStop(1, '#9ab');
      g.fillStyle = grad;
      g.fillRect(700, 420, 400, 300);
    });

  it('finds ruling lines and the table grid with merged cells', () => {
    const page = tablePage();
    const lines = detectRulings(binarize(toGray(page)), { dpi: 150 }, page);
    const h = lines.filter((l) => l.dir === 'h' && l.x1 - l.x0 > 1000);
    const v = lines.filter((l) => l.dir === 'v' && l.y1 - l.y0 < 200);
    // Lines are 3 px thick, drawn from y − 1: their centre is at y + 0.5.
    const r1 = (v: number) => Math.round((v - 0.5) * 10) / 10;
    expect(h.map((l) => r1(l.y0))).toEqual([100, 160, 220, 280]);
    // The column ruling at 400 is interrupted by the merged cell.
    expect(v.map((l) => r1(l.x0))).toEqual([100, 400, 400, 650, 900, 1150]);
    for (const l of [...h, ...v]) expect(l.thickness).toBeCloseTo(3, 0);
    // The underline (260 px ≈ 1.7 in) counts as a line too; the analysis turns it into a decoration later.
    expect(lines.some((l) => l.dir === 'h' && Math.round(l.y0) === 507)).toBe(true);
    // The photo's edges are not lines.
    expect(lines.filter((l) => l.y0 > 400 && l.y0 < 730 && l.dir === 'h' && l.x0 >= 690)).toEqual([]);

    const tables = detectTables(lines, 150);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows.map(r1)).toEqual([100, 160, 220, 280]);
    expect(tables[0].cols.map(r1)).toEqual([100, 400, 650, 900, 1150]);
    expect(tables[0].cells).toHaveLength(11);
    expect(tables[0].cells.some((c) => r1(c.x0) === 100 && r1(c.x1) === 650 && r1(c.y0) === 160)).toBe(true);
  });

  it('finds picture regions outside text', () => {
    const page = tablePage();
    const text = [inkBox(page, 100, 470, 600, 520)];
    const pics = detectPictures(page, [255, 255, 255], [...text, { x0: 95, y0: 95, x1: 1156, y1: 285 }], 150);
    expect(pics).toHaveLength(1);
    const [p] = pics;
    expect(Math.abs(p.x0 - 700)).toBeLessThan(14);
    expect(Math.abs(p.y0 - 420)).toBeLessThan(14);
    expect(Math.abs(p.x1 - 1100)).toBeLessThan(14);
    expect(Math.abs(p.y1 - 720)).toBeLessThan(14);
  });

  it('removes recognised words, lines and decorations in the local background colour', async () => {
    const page = draw(400, 200, (g) => {
      g.fillStyle = '#f5ecd0';
      g.fillRect(0, 0, 400, 200);
      g.fillStyle = '#000';
      g.font = '30px "DejaVu Sans"';
      g.fillText('Wort', 40, 80);
    });
    const box = inkBox(page, 0, 0, 400, 200);
    const fake = async (): Promise<OcrPage> => ({
      width: 400,
      height: 200,
      confidence: 90,
      lines: [{ box, baseline: { x0: box.x0, y0: 80, x1: box.x1, y1: 80 }, rowHeight: 28, words: [{ text: 'Wort', conf: 90, box, symbols: [] }] }],
    });
    const a = await analysePage(page, { dpi: 100, detectSkew: false, detectRotation: false, styles: true, tables: true, pictures: false }, fake);
    expect(a.lines[0].words[0].text).toBe('Wort');
    const clean = eraseRecognised(a);
    expect(Math.min(...toGray(clean).data)).toBeGreaterThan(200);
    // Paper colour, not white.
    expect([clean.data[(60 * 400 + 60) * 4], clean.data[(60 * 400 + 60) * 4 + 2]]).toEqual([245, 208]);
  });
});
