import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import type { PDFPageProxy } from '../src/lib/pdfjs';
import { IMAGE_MAX_AREA_BYTES } from '../src/lib/render/protocol';

const downloads: { name: string; data: Uint8Array; type?: string }[] = [];
vi.mock('../src/lib/download', async (orig) => ({
  ...(await orig<typeof import('../src/lib/download')>()),
  downloadBlob: (data: Uint8Array, name: string, type?: string) => void downloads.push({ data, name, type }),
}));

const { useStore } = await import('../src/store/store');
const { scaleFor, split } = await import('../src/store/commands');
const { extractPageList, splitDocument } = await import('../src/store/organizeCommands');

async function makeDoc(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) doc.addPage([200 + i, 300]).drawText(`Page ${i + 1}`, { x: 20, y: 250, size: 12, font });
  return doc.save();
}

/** A page stand-in with the one method scaleFor needs. */
const page = (w: number, h: number) => ({ getViewport: () => ({ width: w, height: h }) }) as unknown as PDFPageProxy;

/** Names of the files inside a ZIP written by lib/zip (stored entries, so names sit in the clear). */
function zipNames(data: Uint8Array): string[] {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const names: string[] = [];
  for (let at = 0; at + 4 <= data.length && v.getUint32(at, true) === 0x04034b50; ) {
    const nameLen = v.getUint16(at + 26, true);
    names.push(new TextDecoder().decode(data.subarray(at + 30, at + 30 + nameLen)));
    at += 30 + nameLen + v.getUint32(at + 18, true);
  }
  return names;
}

describe('scaleFor', () => {
  it('gives a small page the full dpi', () => {
    expect(scaleFor(page(612, 792), 200)).toBe(200 / 72);
  });

  it('caps the scale so a huge page stays within the canvas limit', () => {
    // An A0 drawing at 200 dpi would be ~19 megapixels, more than browsers hand out as one canvas.
    const p = page(2384, 3370);
    const v = p.getViewport({ scale: 1 });
    const scale = scaleFor(p, 200);
    expect(scale).toBeLessThan(200 / 72);
    // sqrt rounds, so allow a pixel of slack over the exact cap.
    expect(v.width * scale * (v.height * scale)).toBeLessThanOrEqual(IMAGE_MAX_AREA_BYTES / 4 + 1);
    // Even a small page is capped once the dpi alone would burst the limit.
    const l = page(612, 792);
    expect(scaleFor(l, 1200)).toBeLessThan(1200 / 72);
    const lv = l.getViewport({ scale: 1 });
    expect(lv.width * scaleFor(l, 1200) * (lv.height * scaleFor(l, 1200))).toBeLessThanOrEqual(IMAGE_MAX_AREA_BYTES / 4 + 1);
  });
});

describe('downloads of several files', () => {
  beforeEach(async () => {
    downloads.length = 0;
    useStore.setState({ fileName: 'doc.pdf', bytes: await makeDoc(5), pageIds: Array.from({ length: 5 }, (_, i) => `p${i}`), pdf: {} as never, annotations: {} });
  });

  it('packs several split parts into one ZIP', async () => {
    await split(2);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('doc-parts.zip');
    expect(downloads[0].type).toBe('application/zip');
    expect(zipNames(downloads[0].data)).toEqual(['doc-part1.pdf', 'doc-part2.pdf', 'doc-part3.pdf']);
  });

  it('downloads a single split part as a plain PDF', async () => {
    await split(10);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('doc-part1.pdf');
    expect(downloads[0].type).toBeUndefined();
  });

  it('packs pages extracted separately into one ZIP', async () => {
    await extractPageList([0, 2, 4], { separate: true, deleteAfter: false });
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('doc-pages.zip');
    expect(downloads[0].type).toBe('application/zip');
    expect(zipNames(downloads[0].data)).toEqual(['doc-p1.pdf', 'doc-p3.pdf', 'doc-p5.pdf']);
  });

  it('downloads a single extracted page as a plain PDF', async () => {
    await extractPageList([1], { separate: true, deleteAfter: false });
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('doc-p2.pdf');
  });

  it('packs an organize split of several parts into one ZIP', async () => {
    await splitDocument({ kind: 'pages', every: 2 });
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('doc-parts.zip');
    expect(downloads[0].type).toBe('application/zip');
    expect(zipNames(downloads[0].data)).toEqual(['doc-1.pdf', 'doc-2.pdf', 'doc-3.pdf']);
  });

  it('downloads a one-part organize split as a plain PDF', async () => {
    await splitDocument({ kind: 'pages', every: 10 });
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('doc-1.pdf');
  });
});
