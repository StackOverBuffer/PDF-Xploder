/**
 * Rebuild a PNG from the image XObject the stamp writer embedded (see annotIO): the
 * write path stores a PNG stamp only once, as the appearance's decoded samples, and
 * import turns those back into a PNG data URL. Loaded on demand: annotIO is part of
 * the start-up bundle, this is not.
 */
import { PDFArray, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';

const n = (o: unknown): number | undefined => (o instanceof PDFNumber ? o.asNumber() : undefined);

function numbers(o: unknown): number[] {
  return o instanceof PDFArray ? o.asArray().map((x) => n(x) ?? 0) : [];
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** CRC-32, as PNG chunks end with it. */
const crcTable = new Uint32Array(256).map((_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
  return c >>> 0;
});

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function crc32(b: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

/** Deflate in the zlib container, which is what PNG image data uses. */
async function deflateZlib(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return undefined;
  }
}

/**
 * The PNG behind an image XObject our writer embedded (embedPng: 8-bit DeviceRGB
 * samples, alpha split into /SMask). Undefined when the stream is not that shape.
 */
export async function pngFromSamples(stream: PDFRawStream, samples: Uint8Array): Promise<string | undefined> {
  const d = stream.dict;
  const w = n(d.get(PDFName.of('Width'))) ?? 0;
  const h = n(d.get(PDFName.of('Height'))) ?? 0;
  const cs = d.get(PDFName.of('ColorSpace'));
  if (!w || !h || n(d.get(PDFName.of('BitsPerComponent'))) !== 8 || !(cs instanceof PDFName) || cs.decodeText() !== 'DeviceRGB') return undefined;
  if (samples.length < w * h * 3) return undefined;
  let alpha: Uint8Array | undefined;
  const smask = d.lookup(PDFName.of('SMask'));
  if (smask instanceof PDFRawStream) {
    const sd = smask.dict;
    const scs = sd.get(PDFName.of('ColorSpace'));
    if (n(sd.get(PDFName.of('Width'))) !== w || n(sd.get(PDFName.of('Height'))) !== h || n(sd.get(PDFName.of('BitsPerComponent'))) !== 8 || !(scs instanceof PDFName) || scs.decodeText() !== 'DeviceGray') return undefined;
    const dec = numbers(sd.get(PDFName.of('Decode')));
    if (dec.length === 2 && (dec[0] !== 0 || dec[1] !== 1)) return undefined;
    try {
      alpha = decodePDFRawStream(smask).decode();
    } catch {
      return undefined;
    }
    if (alpha.length < w * h) return undefined;
  }
  // Each PNG row starts with a filter byte; we write plain rows ("no filter").
  const bpp = alpha ? 4 : 3;
  const raw = new Uint8Array((w * bpp + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * bpp + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 3;
      const o = y * (w * bpp + 1) + 1 + x * bpp;
      raw[o] = samples[s];
      raw[o + 1] = samples[s + 1];
      raw[o + 2] = samples[s + 2];
      if (alpha) raw[o + 3] = alpha[y * w + x];
    }
  }
  const idat = await deflateZlib(raw);
  if (!idat) return undefined;
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = alpha ? 6 : 2; // truecolour, with alpha when the image has any
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return bytesToDataUrl(out, 'image/png');
}
