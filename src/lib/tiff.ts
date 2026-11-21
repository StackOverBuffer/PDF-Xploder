/**
 * Baseline TIFF encoder: little-endian, uncompressed, the whole image in one strip.
 * Enough for handing rasterised pages to other programs — Photoshop, Preview, GIMP
 * and Windows Photos all read this shape (baseline tags in ascending order, no tiles).
 * A pure module: no PDF, worker or canvas code, so tests run it in node.
 */

export interface TiffOptions {
  /** Resolution recorded in the file, in pixels per inch (72 when omitted). */
  dpi?: number;
  /** Write 8-bit greyscale (Rec. 601 luma) instead of RGB. */
  grayscale?: boolean;
}

const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;

/** Write one IFD entry. `offset` points at a value that does not fit the 4-byte field. */
function entry(dv: DataView, at: number, tag: number, type: number, count: number, value: number, offset?: number) {
  dv.setUint16(at, tag, true);
  dv.setUint16(at + 2, type, true);
  dv.setUint32(at + 4, count, true);
  // SHORT values sit in the low half of the field, LONG values fill it completely.
  if (offset !== undefined) dv.setUint32(at + 8, offset, true);
  else if (type === SHORT) dv.setUint16(at + 8, value, true);
  else dv.setUint32(at + 8, value, true);
}

export function encodeTiff(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray, o: TiffOptions = {}): Uint8Array {
  const dpi = o.dpi ?? 72;
  const grey = !!o.grayscale;
  const samples = grey ? 1 : 3;
  const n = width * height;
  // The strip holds the pixels without their alpha channel; the luma weights are
  // greyscale.ts's Rec. 601 ones, kept local so this module stays dependency-free.
  const strip = new Uint8Array(n * samples);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (grey) strip[i] = Math.round(0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]);
    else {
      strip[i * 3] = rgba[j];
      strip[i * 3 + 1] = rgba[j + 1];
      strip[i * 3 + 2] = rgba[j + 2];
    }
  }

  // Layout: header, IFD (12 entries), the RGB BitsPerSample array, both resolutions, the strip.
  const ifdEnd = 8 + 2 + 12 * 12 + 4;
  const bitsOffset = grey ? 0 : ifdEnd;
  const xResOffset = grey ? ifdEnd : ifdEnd + 6;
  const yResOffset = xResOffset + 8;
  const stripOffset = yResOffset + 8;

  const out = new Uint8Array(stripOffset + strip.length);
  const dv = new DataView(out.buffer);
  out[0] = out[1] = 0x49; // "II": little-endian
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true); // the first IFD follows the header at once
  dv.setUint16(8, 12, true); // tag count
  let e = 10;
  entry(dv, e, 256, LONG, 1, width); // ImageWidth
  entry(dv, e += 12, 257, LONG, 1, height); // ImageLength
  entry(dv, e += 12, 258, SHORT, samples, 8, grey ? undefined : bitsOffset); // BitsPerSample
  entry(dv, e += 12, 259, SHORT, 1, 1); // Compression: none
  entry(dv, e += 12, 262, SHORT, 1, grey ? 1 : 2); // Photometric: BlackIsZero / RGB
  entry(dv, e += 12, 273, LONG, 1, stripOffset); // StripOffsets
  entry(dv, e += 12, 277, SHORT, 1, samples); // SamplesPerPixel
  entry(dv, e += 12, 278, LONG, 1, height); // RowsPerStrip: one strip for the whole image
  entry(dv, e += 12, 279, LONG, 1, strip.length); // StripByteCounts
  entry(dv, e += 12, 282, RATIONAL, 1, 0, xResOffset); // XResolution
  entry(dv, e += 12, 283, RATIONAL, 1, 0, yResOffset); // YResolution
  entry(dv, e + 12, 296, SHORT, 1, 2); // ResolutionUnit: inch
  if (!grey) for (let i = 0; i < 3; i++) dv.setUint16(bitsOffset + i * 2, 8, true);
  dv.setUint32(xResOffset, dpi, true);
  dv.setUint32(xResOffset + 4, 1, true);
  dv.setUint32(yResOffset, dpi, true);
  dv.setUint32(yResOffset + 4, 1, true);
  out.set(strip, stripOffset);
  return out;
}
