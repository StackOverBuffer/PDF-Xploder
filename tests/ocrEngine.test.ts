/**
 * End-to-end OCR in node: a synthetic scanned page (skewed, with a table and
 * styled words) is recognised by tesseract.js with the npm language data and
 * written back in all three output types.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { PDFDocument, PDFName, PDFDict } from '@cantoo/pdf-lib';
import { draw, encodePng, hasCanvas } from './ocrHelpers';
import { createEngine, type OcrEngine } from '../src/lib/ocr/engine';
import { analysePage, type PageAnalysis } from '../src/lib/ocr/analyse';
import { createWriter, removeUnreferenced, type OutputMode } from '../src/lib/ocr/writer';
import type { M } from '../src/lib/ocr/mapping';
import type { Raster } from '../src/lib/ocr/raster';

const DPI = 200;
const PAGE = { w: 595.28, h: 841.89 };
const langDir = (l: string) => resolve(`node_modules/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`);
const available = hasCanvas && ['deu', 'eng'].every((l) => existsSync(langDir(l)));

/** An A4 "scan" at 200 dpi, rotated 2° clockwise. */
function scan(): Raster {
  const W = Math.round((PAGE.w / 72) * DPI);
  const H = Math.round((PAGE.h / 72) * DPI);
  return draw(W, H, (g) => {
    g.translate(W / 2, H / 2);
    g.rotate((2 * Math.PI) / 180);
    g.translate(-W / 2, -H / 2);
    g.fillStyle = '#000';
    g.font = 'bold 64px "DejaVu Sans"';
    g.fillText('Rechnung', 160, 300);
    g.font = '40px "DejaVu Serif"';
    g.fillText('Sehr geehrte Damen und Herren, vielen Dank für Ihren Auftrag.', 160, 420);
    g.fillText('Wir berechnen Ihnen die folgenden Positionen:', 160, 480);
    // A 3 × 3 table.
    const xs = [160, 700, 1000, 1400];
    const ys = [560, 640, 720, 800];
    for (const y of ys) g.fillRect(160, y - 2, 1243, 4);
    for (const x of xs) g.fillRect(x - 2, 560, 4, 243);
    g.font = '36px "DejaVu Sans"';
    [['Beschreibung', 'Menge', 'Preis'], ['Beratung', '3', '450,00'], ['Software', '1', '1200,00']].forEach((row, r) =>
      row.forEach((cell, c) => g.fillText(cell, xs[c] + 24, ys[r] + 56)),
    );
    g.font = '40px "DejaVu Serif"';
    g.fillText('Bitte überweisen Sie den Betrag bis zum Monatsende.', 160, 920);
    g.fillText('Mit freundlichen Grüßen', 160, 1040);
    g.fillRect(160, 1050, g.measureText('Mit freundlichen Grüßen').width, 4);
  });
}

/** pdf.js viewport transform of an unrotated A4 page at the scan resolution. */
const viewport: M = [DPI / 72, 0, 0, -DPI / 72, 0, (PAGE.h * DPI) / 72];

async function scannedPdf(img: Raster): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.w, PAGE.h]);
  page.drawImage(await doc.embedPng(encodePng(img)), { x: 0, y: 0, width: PAGE.w, height: PAGE.h });
  return doc.save();
}

async function textOf(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: `${resolve('node_modules/pdfjs-dist/standard_fonts')}/` }).promise;
  const page = await pdf.getPage(1);
  const tc = await page.getTextContent();
  const items = tc.items.filter((i): i is typeof i & { str: string; transform: number[] } => 'str' in i);
  await pdf.destroy();
  return { text: items.map((i) => i.str).join(' ').replace(/\s+/g, ' '), items };
}

describe.skipIf(!available)('OCR end to end (tesseract.js)', () => {
  let engine: OcrEngine;
  let dir: string;
  let img: Raster;
  let analysis: PageAnalysis;
  let source: Uint8Array;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ocr-lang-'));
    for (const l of ['deu', 'eng']) await symlink(langDir(l), join(dir, `${l}.traineddata.gz`));
    engine = await createEngine({ langs: ['deu', 'eng'], threads: 2, dpi: DPI, langPath: dir });
    img = scan();
    source = await scannedPdf(img);
    analysis = await analysePage(img, { dpi: DPI, detectSkew: true, detectRotation: true, styles: true, tables: true, pictures: true }, (r) =>
      engine.recognize(Buffer.from(encodePng(r))),
    );
  }, 120_000);

  afterAll(async () => {
    await engine?.terminate();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('recognises text, skew, styles and the table', () => {
    expect(analysis.quarterTurns).toBe(0);
    expect(Math.abs(analysis.skew - 2)).toBeLessThan(0.3);
    const words = analysis.lines.flatMap((l) => l.words);
    const text = words.map((w) => w.text).join(' ');
    for (const w of ['Rechnung', 'Auftrag.', 'Beschreibung', 'Software', '1200,00', 'überweisen', 'Grüßen']) expect(text).toContain(w);
    expect(analysis.confidence).toBeGreaterThan(80);
    const find = (t: string) => words.find((w) => w.text === t)!;
    expect(find('Rechnung').style.bold).toBe(true);
    expect(find('Auftrag.').style.bold).toBe(false);
    expect(['Mit', 'freundlichen', 'Grüßen'].map((t) => find(t).style.underline)).toEqual([true, true, true]);
    expect(find('Auftrag.').style.family).toBe('serif');
    expect(find('Software').style.family).toBe('sans');
    expect(analysis.tables).toHaveLength(1);
    expect(analysis.tables[0].cells).toHaveLength(9);
    // The underline is a decoration, not a ruling of its own.
    expect(analysis.rulings.filter((l) => l.dir === 'h')).toHaveLength(4);
    expect(analysis.pictures).toEqual([]);
  });

  async function write(mode: OutputMode, correctSkew = false) {
    const doc = await PDFDocument.load(source);
    await createWriter(doc).writePage(doc.getPage(0), analysis, {
      mode,
      correctSkew,
      correctRotation: true,
      viewport,
      turnedViewport: viewport,
      encodeImage: async (r) => ({ bytes: encodePng(r), format: 'png' }),
    });
    removeUnreferenced(doc);
    return doc.save();
  }

  it('writes searchable text over the unchanged scan', async () => {
    const out = await write('searchable');
    const { text, items } = await textOf(out);
    expect(text).toContain('Rechnung');
    expect(text).toContain('Mit freundlichen Grüßen');
    // "Rechnung" was drawn at (160, 300) px before the 2° rotation: x ≈ 160·72/200 + skew shift.
    const r = items.find((i) => i.str.startsWith('Rechnung'))!;
    const [a, b, , , e, f] = r.transform;
    expect(Math.atan2(b, a) * (180 / Math.PI)).toBeCloseTo(-2, 0);
    expect(Math.abs(e - 70)).toBeLessThan(15);
    expect(Math.abs(PAGE.h - f - 98)).toBeLessThan(15);
    const doc = await PDFDocument.load(out);
    const content = new TextDecoder().decode(inflateSync(lastStream(doc)));
    expect(content).toContain('3 Tr');
    // The original image is still there.
    expect(xobjects(doc)).toBe(1);
  });

  it('writes editable text over the cleaned, deskewed image', async () => {
    const out = await write('editable');
    const { text, items } = await textOf(out);
    expect(text).toContain('Bitte überweisen Sie den Betrag');
    const r = items.find((i) => i.str.startsWith('Rechnung'))!;
    // Upright now, at the deskewed position.
    expect(Math.abs(r.transform[1])).toBeLessThan(1e-6);
    const doc = await PDFDocument.load(out);
    expect(xobjects(doc)).toBe(1);
    const fonts = (doc.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict)).keys().length;
    expect(fonts).toBeGreaterThanOrEqual(3); // Helvetica, Helvetica-Bold, Times-Roman
    expect(out.length).toBeLessThan(source.length * 1.5);
  });

  it('writes fine page content without the scan', async () => {
    const out = await write('fine');
    const { text } = await textOf(out);
    expect(text).toContain('Beratung');
    const doc = await PDFDocument.load(out);
    expect(xobjects(doc)).toBe(0);
    // The scan is gone from the file.
    expect(out.length).toBeLessThan(source.length / 4);
  });
});

function lastStream(doc: PDFDocument): Uint8Array {
  const contents = doc.getPage(0).node.Contents()!;
  const arr = contents as unknown as { size(): number; lookup(i: number): { getContents(): Uint8Array } };
  return arr.lookup(arr.size() - 1).getContents();
}

function xobjects(doc: PDFDocument): number {
  const x = doc.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'));
  return x instanceof PDFDict ? x.keys().length : 0;
}
