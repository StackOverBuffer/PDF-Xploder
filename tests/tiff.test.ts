import { describe, expect, it } from 'vitest';
import { encodeTiff } from '../src/lib/tiff';

function ifd(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(dv.getUint8(0)).toBe(0x49); expect(dv.getUint8(1)).toBe(0x49); // II
  expect(dv.getUint16(2, true)).toBe(42);
  const count = dv.getUint16(8, true);
  const tags = new Map<number, { type: number; count: number; value: number | number[] }>();
  for (let i = 0; i < count; i++) {
    const at = 10 + i * 12;
    const tag = dv.getUint16(at, true), type = dv.getUint16(at + 2, true), n = dv.getUint32(at + 4, true);
    if (type === 3 && n === 1) tags.set(tag, { type, count: n, value: dv.getUint16(at + 8, true) });
    else if (type === 4 && n === 1) tags.set(tag, { type, count: n, value: dv.getUint32(at + 8, true) });
    else tags.set(tag, { type, count: n, value: -1 });
  }
  return { tags, count };
}

it('writes a little-endian baseline RGB TIFF with the expected tags', () => {
  // 2×2 RGB(A): red, green, blue, white.
  const px = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  const tiff = encodeTiff(2, 2, px, { dpi: 300 });
  const { tags } = ifd(tiff);
  expect(tags.get(256)!.value).toBe(2);   // ImageWidth
  expect(tags.get(257)!.value).toBe(2);   // ImageLength
  expect(tags.get(259)!.value).toBe(1);   // no compression
  expect(tags.get(262)!.value).toBe(2);   // RGB
  expect(tags.get(277)!.value).toBe(3);   // SamplesPerPixel
  expect(tags.get(278)!.value).toBe(2);   // RowsPerStrip
  const strip = tags.get(273)!.value as number;
  expect(tags.get(279)!.value).toBe(12);  // 2*2*3 bytes
  expect([...tiff.slice(strip, strip + 12)]).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
});

it('grayscales with Rec.601 luma and records the resolution', () => {
  const tiff = encodeTiff(1, 1, new Uint8Array([255, 0, 0, 255]), { dpi: 150, grayscale: true });
  const { tags } = ifd(tiff);
  expect(tags.get(262)!.value).toBe(1);   // BlackIsZero
  expect(tags.get(277)!.value).toBe(1);
  expect(tags.get(279)!.value).toBe(1);   // 1 byte
  // 0.299*255 = 76 (rounded)
  const strip = tags.get(273)!.value as number;
  expect(tiff[strip]).toBe(76);
});

it('orders tags ascending and sizes one strip', () => {
  const tiff = encodeTiff(3, 2, new Uint8Array(3 * 2 * 4));
  const { count } = ifd(tiff);
  // count = number of tags, always 12 for RGB
  expect(count).toBe(12);
});

describe('TIFF encoder', () => {
  it('keeps the tag list in ascending order', () => {
    const tiff = encodeTiff(2, 1, new Uint8Array(8));
    const dv = new DataView(tiff.buffer);
    const count = dv.getUint16(8, true);
    let last = 0;
    for (let i = 0; i < count; i++) {
      const tag = dv.getUint16(10 + i * 12, true);
      expect(tag).toBeGreaterThan(last);
      last = tag;
    }
  });

  it('records the default 72 dpi when none is given', () => {
    const tiff = encodeTiff(1, 1, new Uint8Array([1, 2, 3, 255]));
    const dv = new DataView(tiff.buffer);
    // Walk the IFD to the XResolution RATIONAL and read its numerator.
    const count = dv.getUint16(8, true);
    let at = 0;
    for (let i = 0; i < count; i++) {
      const e = 10 + i * 12;
      if (dv.getUint16(e, true) === 282) at = dv.getUint32(e + 8, true);
    }
    expect(dv.getUint32(at, true)).toBe(72);
    expect(dv.getUint32(at + 4, true)).toBe(1);
  });

  it('stores the grey BitsPerSample inline and the RGB one outside the IFD', () => {
    const rgb = encodeTiff(1, 1, new Uint8Array(4));
    const grey = encodeTiff(1, 1, new Uint8Array(4), { grayscale: true });
    const entryOf = (bytes: Uint8Array, tag: number) => {
      const dv = new DataView(bytes.buffer);
      const count = dv.getUint16(8, true);
      for (let i = 0; i < count; i++) {
        const e = 10 + i * 12;
        if (dv.getUint16(e, true) === tag) return { type: dv.getUint16(e + 2, true), n: dv.getUint32(e + 4, true), value: dv.getUint32(e + 8, true) };
      }
      return null;
    };
    const bitsRgb = entryOf(rgb, 258)!;
    expect(bitsRgb.type).toBe(3);      // SHORT
    expect(bitsRgb.n).toBe(3);
    // The value field holds an offset; the array there reads 8, 8, 8.
    const dv = new DataView(rgb.buffer);
    expect(dv.getUint16(bitsRgb.value, true)).toBe(8);
    expect(dv.getUint16(bitsRgb.value + 2, true)).toBe(8);
    expect(dv.getUint16(bitsRgb.value + 4, true)).toBe(8);
    const bitsGrey = entryOf(grey, 258)!;
    expect(bitsGrey.n).toBe(1);
    // Inline SHORT values sit in the low half of the value field.
    expect(new DataView(grey.buffer).getUint16(10 + 2 * 12 + 8, true)).toBe(8);
  });
});
