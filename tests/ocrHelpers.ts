/** Synthetic images for the OCR tests, drawn with @napi-rs/canvas (pdf.js's optional node canvas). */
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import type { Raster } from '../src/lib/ocr/raster';

const require = createRequire(import.meta.url);

type Ctx = CanvasRenderingContext2D;

let napi: { createCanvas(w: number, h: number): { getContext(t: '2d'): Ctx } } | null = null;
try {
  napi = require('@napi-rs/canvas');
} catch {
  napi = null;
}

/** Whether text can be drawn (the native canvas is an optional dependency). */
export const hasCanvas = !!napi;

/** Draw on a white canvas and return its pixels. */
export function draw(width: number, height: number, fn: (g: Ctx) => void): Raster {
  const c = napi!.createCanvas(width, height);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, width, height);
  g.fillStyle = '#000';
  g.textBaseline = 'alphabetic';
  fn(g);
  const d = g.getImageData(0, 0, width, height);
  return { width, height, data: new Uint8ClampedArray(d.data) };
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal RGB PNG encoder. */
export function encodePng(r: Raster): Uint8Array {
  const raw = new Uint8Array((r.width * 3 + 1) * r.height);
  for (let y = 0; y < r.height; y++) {
    raw[y * (r.width * 3 + 1)] = 0;
    for (let x = 0; x < r.width; x++) {
      const s = (y * r.width + x) * 4;
      const d = y * (r.width * 3 + 1) + 1 + x * 3;
      raw[d] = r.data[s];
      raw[d + 1] = r.data[s + 1];
      raw[d + 2] = r.data[s + 2];
    }
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, r.width);
  v.setUint32(4, r.height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
