import { expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib';
import { cleanImageDataUrl, jpegOrientation, stripJpegMetadata, stripPngMetadata } from '../src/lib/imageMeta';
import * as ops from '../src/lib/pdfOps';

const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
/** A minimal JPEG: SOI, JFIF, EXIF (orientation `o`, a GPS-looking string), comment, ICC, a fake scan, EOI. */
function jpeg(o = 1): Uint8Array {
  // Big-endian TIFF: one IFD entry, tag 0x0112 (orientation), SHORT, count 1.
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0, ...ascii('GPS 52.5N')];
  return Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xe0, ascii('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    ...seg(0xe1, [...ascii('Exif\0\0'), ...tiff]),
    ...seg(0xfe, ascii('secret comment')),
    ...seg(0xe2, ascii('ICC_PROFILE\0')),
    0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9,
  ]);
}

it('reads the EXIF orientation and strips EXIF and comments from JPEGs, keeping colour data', () => {
  expect(jpegOrientation(jpeg(6))).toBe(6);
  expect(jpegOrientation(jpeg(1))).toBe(1);
  const out = Buffer.from(stripJpegMetadata(jpeg())).toString('latin1');
  expect(out).not.toContain('Exif');
  expect(out).not.toContain('GPS');
  expect(out).not.toContain('secret');
  expect(out).toContain('JFIF');
  expect(out).toContain('ICC_PROFILE');
  expect(out.endsWith('\x01\x02\x03\xff\xd9')).toBe(true);
  // A sideways photo has to be drawn upright first.
  expect(cleanImageDataUrl(`data:image/jpeg;base64,${Buffer.from(jpeg(6)).toString('base64')}`).rotated).toBe(true);
});

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

it('strips text and EXIF chunks from PNGs', () => {
  const b = Buffer.from(PNG, 'base64');
  const chunk = (type: string, data: number[]) => { const len = data.length; return [len >> 24, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...ascii(type), ...data, 0, 0, 0, 0]; };
  const withText = Uint8Array.from([...b.subarray(0, 33), ...chunk('tEXt', ascii('Author\0Jo Doe')), ...chunk('eXIf', [1, 2]), ...b.subarray(33)]);
  const out = stripPngMetadata(withText);
  expect(Buffer.from(out).equals(b)).toBe(true);
});

it('stores an image stamp\'s JPEG once, and reads it back', async () => {
  const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  const src = `data:image/jpeg;base64,${jpg.toString('base64')}`;
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const img = { id: 'i1', type: 'image', rect: { x: 10, y: 10, w: 50, h: 50 }, rot: 0, src, color: '#000000', opacity: 1, author: 'Jo', createdAt: 0 } as never;
  const out = await ops.exportWithAnnotations(await doc.save(), [[img]]);
  const loaded = await PDFDocument.load(out);
  const jpegs = loaded.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Filter'))?.toString() === '/DCTDecode');
  expect(jpegs).toHaveLength(1);
  const annot = loaded.context.lookup(loaded.getPage(0).node.Annots()!.get(0)) as PDFDict;
  expect(annot.get(PDFName.of('AwesomePDFSrc'))).toBe(jpegs[0][0]);
  const back = (await ops.importForEditing(out)).annotations[0][0] as { src: string };
  expect(back.src).toBe(src);
});
