import { describe, expect, it } from 'vitest';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream } from '@cantoo/pdf-lib';
import { drawContext } from '../src/lib/pdfOps';
import { importAnnotations, writeNativeAnnotation } from '../src/lib/annotIO';
import type { Annotation, ImageAnnot, PageGeom } from '../src/lib/types';

const g: PageGeom = { view: [0, 0, 300, 200], rotation: 0 };
const N = (s: string) => PDFName.of(s);
const utf8 = (s: string) => new TextEncoder().encode(s).length;

const samples: [string, Annotation][] = [
  ['note with reply', {
    id: 'n1', type: 'note', at: { x: 10, y: 150 }, text: 'Please shorten this paragraph.', color: '#fbc02d',
    opacity: 1, author: 'Jane', createdAt: 1_764_620_000_000,
    replies: [{ id: 'r1', author: 'Bob', text: 'Will do.', createdAt: 1_764_620_100_000 }],
  } as Annotation],
  ['highlight with comment', {
    id: 'h1', type: 'highlight', rects: [{ x: 72, y: 120, w: 214.6, h: 11.4 }], text: 'the marked sentence',
    color: '#ffee58', opacity: 1, comment: 'Needs a source.', author: 'Jane', createdAt: 1_764_620_200_000,
  } as Annotation],
  ['FreeText box', {
    id: 't1', type: 'text', rect: { x: 40, y: 40, w: 120, h: 40 }, text: 'Approved with changes.',
    fontSize: 12, border: false, color: '#000000', opacity: 1, author: 'Jane', createdAt: 1_764_620_300_000,
  } as Annotation],
];

/** The /AwesomePDF model of `a`, written through the normal path into a fresh document. */
async function privateModel(a: Annotation): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]);
  const ctx = await drawContext(doc);
  await writeNativeAnnotation(ctx, doc.getPages()[0], g, a);
  const loaded = await PDFDocument.load(await doc.save());
  for (const r of loaded.getPage(0).node.Annots()?.asArray() ?? []) {
    const priv = (loaded.context.lookup(r) as PDFDict).lookup(N('AwesomePDF'));
    if (priv instanceof PDFHexString) return priv.decodeText();
  }
  throw new Error('no private model');
}

describe('the private model of a comment', () => {
  it('stays small, because defaults come from the dictionary', async () => {
    for (const [, a] of samples) expect(utf8(await privateModel(a))).toBeLessThan(400);
  });

  it('reads back exactly as it was written', async () => {
    for (const [, a] of samples) {
      const doc = await PDFDocument.create();
      doc.addPage([300, 200]);
      await writeNativeAnnotation(await drawContext(doc), doc.getPages()[0], g, a);
      const res = await importAnnotations(await PDFDocument.load(await doc.save()), [g], () => 'x');
      expect(res.count).toBe(1);
      const { foreign, ...back } = res.annotations[0][0];
      expect(foreign).toBeTruthy();
      expect(back).toEqual(a);
    }
  });
});

// ---------------------------------------------------------------- image stamps

/** A small PNG with distinct pixels (truecolour with alpha), built by hand. */
function samplePng(w: number, h: number): { png: Uint8Array; raw: Uint8Array; idat: Uint8Array } {
  const concat = (parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const head = new Uint8Array(8);
    new DataView(head.buffer).setUint32(0, data.length);
    for (let i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i);
    const body = concat([head.subarray(4), data]);
    const crc = new Uint8Array(4);
    new DataView(crc.buffer).setUint32(0, crc32(body) >>> 0);
    return concat([head, data, crc]);
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  const raw = new Uint8Array(h * (w * 4 + 1)); // rows, each with a "no filter" byte
  for (let i = 0; i < w * h; i++) {
    const o = Math.floor(i / w) * (w * 4 + 1) + 1 + (i % w) * 4;
    raw[o] = (i * 37) % 256;
    raw[o + 1] = (i * 53) % 256;
    raw[o + 2] = (i * 97) % 256;
    raw[o + 3] = i % 3 === 0 ? 255 : 128;
  }
  const idat = deflateSync(raw);
  return { png: concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]), raw, idat };
}

/** The data of the PNG chunk `type`, walking the chunk list. */
function pngChunkData(png: Uint8Array, type: string): Uint8Array {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let off = 8; off + 12 <= png.length;) {
    const len = dv.getUint32(off);
    const name = String.fromCharCode(...png.subarray(off + 4, off + 8));
    if (name === type) return png.subarray(off + 8, off + 8 + len);
    off += 12 + len;
  }
  throw new Error(`no ${type} chunk`);
}

const image = (src: string): ImageAnnot => ({
  id: 'img1', type: 'image', rect: { x: 40, y: 40, w: 80, h: 60 }, src,
  color: '#000000', opacity: 1, author: 'Jane', createdAt: 1_764_620_400_000,
});

describe('an image stamp', () => {
  it("stores its pixels once: the private source is the appearance's image", async () => {
    const { png, raw, idat } = samplePng(4, 3);
    const doc = await PDFDocument.create();
    doc.addPage([300, 200]);
    await writeNativeAnnotation(await drawContext(doc), doc.getPages()[0], g, image(`data:image/png;base64,${Buffer.from(png).toString('base64')}`));
    const bytes = await doc.save();
    const loaded = await PDFDocument.load(bytes);
    const dict = (loaded.getPage(0).node.Annots()!.asArray().map((r) => loaded.context.lookup(r) as PDFDict))
      .find((d) => d.has(N('AwesomePDFSrc')))!;
    // The private source is the very image XObject the appearance draws: stored once.
    const form = (dict.lookup(N('AP')) as PDFDict).lookup(N('N')) as PDFRawStream;
    const images = (form.dict.lookup(N('Resources')) as PDFDict).lookup(N('XObject')) as PDFDict;
    expect([...images.entries()]).toHaveLength(1);
    expect(dict.get(N('AwesomePDFSrc'))!.toString()).toBe(images.entries()[0][1].toString());
    // The original PNG bytes are not in the file at all (they used to be a second copy).
    expect(Buffer.from(bytes).indexOf(idat)).toBe(-1);
    // The round trip rebuilds the image from the stored samples, same pixels.
    const res = await importAnnotations(await PDFDocument.load(bytes), [g], () => 'x');
    const img = res.annotations[0][0] as ImageAnnot;
    expect(img.src.startsWith('data:image/png;base64,')).toBe(true);
    const rebuilt = Uint8Array.from(atob(img.src.slice(22)), (c) => c.charCodeAt(0));
    expect([...inflateSync(pngChunkData(rebuilt, 'IDAT'))]).toEqual([...raw]);
  });
});
