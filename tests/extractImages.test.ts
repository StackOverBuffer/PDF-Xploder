import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib';
import { findImages } from '../src/lib/extractImages';

const N = PDFName.of;

describe('finding images to extract', () => {
  it('lists each image once in page order, JPEGs as stored, without masks', async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const rgb = new Uint8Array(10 * 10 * 3).fill(128);
    const mask = ctx.register(ctx.flateStream(new Uint8Array(100).fill(255), { Type: 'XObject', Subtype: 'Image', Width: 10, Height: 10, BitsPerComponent: 8, ColorSpace: 'DeviceGray' }));
    const png = ctx.register(ctx.flateStream(rgb, { Type: 'XObject', Subtype: 'Image', Width: 10, Height: 10, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', SMask: mask }));
    const jpg = ctx.register(PDFRawStream.of(ctx.obj({ Type: 'XObject', Subtype: 'Image', Width: 12, Height: 10, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode' }) as PDFDict, new Uint8Array([0xff, 0xd8, 0xff, 1])));
    const bw = ctx.register(ctx.flateStream(new Uint8Array(2 * 16), { Type: 'XObject', Subtype: 'Image', Width: 16, Height: 16, BitsPerComponent: 1, ColorSpace: 'DeviceGray' }));
    const form = ctx.register(ctx.stream('/J Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1], Resources: { XObject: { J: jpg } } }));
    const p1 = doc.addPage();
    p1.node.set(N('Resources'), ctx.obj({ XObject: { F: form } }));
    const p2 = doc.addPage();
    p2.node.set(N('Resources'), ctx.obj({ XObject: { A: png, B: jpg, C: bw } }));
    const found = await findImages(doc);
    expect(found.map((f) => [f.page, f.width, f.jpeg ? 'jpeg' : 'rgb' in f.source! ? 'rgb' : 'pdf'])).toEqual([[0, 12, 'jpeg'], [1, 10, 'rgb'], [1, 16, 'pdf']]);
  });
});
