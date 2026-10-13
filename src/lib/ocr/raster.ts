/**
 * Plain pixel buffers and the image operations OCR needs. Everything works on
 * ImageData-compatible RGBA buffers so it runs (and is tested) without a DOM.
 */

/** RGBA pixels, row by row (compatible with ImageData). */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** One byte per pixel (luminance, or 1/0 for ink in binary images). */
export interface Gray {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Axis-aligned pixel box, inclusive-exclusive: x0 ≤ x < x1. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type RGB = [number, number, number];

export function createRaster(width: number, height: number, fill: RGB = [255, 255, 255]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = 255;
  }
  return { width, height, data };
}

export const cloneRaster = (r: Raster): Raster => ({ width: r.width, height: r.height, data: r.data.slice() });

export const lum = (r: number, g: number, b: number) => (r * 299 + g * 587 + b * 114) / 1000;

export function toGray(r: Raster): Gray {
  const out = new Uint8Array(r.width * r.height);
  const d = r.data;
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  return { width: r.width, height: r.height, data: out };
}

/** Otsu's threshold of a luminance image (or of the part inside `box`). */
export function otsu(g: Gray, box?: Box): number {
  const hist = new Float64Array(256);
  const { x0, y0, x1, y1 } = box ?? { x0: 0, y0: 0, x1: g.width, y1: g.height };
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[g.data[y * g.width + x]]++;
  let total = 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    sum += i * hist[i];
  }
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Ink mask: 1 where the pixel is darker than the threshold (Otsu by default, capped so blank pages stay blank). */
export function binarize(g: Gray, threshold?: number): Gray {
  const t = threshold ?? Math.min(otsu(g), 200);
  const out = new Uint8Array(g.data.length);
  for (let i = 0; i < out.length; i++) out[i] = g.data[i] <= t ? 1 : 0;
  return { width: g.width, height: g.height, data: out };
}

/** Shrink by an integer factor, averaging blocks. */
export function downscale(g: Gray, f: number): Gray {
  if (f <= 1) return g;
  const w = Math.max(1, Math.floor(g.width / f));
  const h = Math.max(1, Math.floor(g.height / f));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * g.width + x * f;
        for (let dx = 0; dx < f; dx++) s += g.data[row + dx];
      }
      out[y * w + x] = s / (f * f);
    }
  return { width: w, height: h, data: out };
}

/** Swap rows and columns. */
export function transpose(g: Gray): Gray {
  const out = new Uint8Array(g.data.length);
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) out[x * g.height + y] = g.data[y * g.width + x];
  return { width: g.height, height: g.width, data: out };
}

/** Rotate by a multiple of 90° clockwise. */
export function rotateQuarter(r: Raster, quarters: number): Raster {
  const q = ((quarters % 4) + 4) % 4;
  if (!q) return r;
  const { width: w, height: h } = r;
  const W = q % 2 ? h : w;
  const H = q % 2 ? w : h;
  const src = new Uint32Array(r.data.buffer, r.data.byteOffset, w * h);
  const outData = new Uint8ClampedArray(W * H * 4);
  const dst = new Uint32Array(outData.buffer);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [X, Y] = q === 1 ? [h - 1 - y, x] : q === 2 ? [w - 1 - x, h - 1 - y] : [y, w - 1 - x];
      dst[Y * W + X] = src[y * w + x];
    }
  return { width: W, height: H, data: outData };
}

/**
 * Rotate by `deg` (clockwise on screen) about the centre, keeping the size.
 * Bilinear; uncovered corners get `bg`.
 */
export function rotateRaster(r: Raster, deg: number, bg: RGB = [255, 255, 255]): Raster {
  const { width: w, height: h, data } = r;
  const out = new Uint8ClampedArray(w * h * 4);
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  for (let Y = 0; Y < h; Y++) {
    const dy = Y + 0.5 - cy;
    for (let X = 0; X < w; X++) {
      const dx = X + 0.5 - cx;
      // Inverse rotation: where does the output pixel come from?
      const sx = cos * dx + sin * dy + cx - 0.5;
      const sy = -sin * dx + cos * dy + cy - 0.5;
      const o = (Y * w + X) * 4;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < -1 || y0 < -1 || x0 >= w || y0 >= h) {
        out[o] = bg[0];
        out[o + 1] = bg[1];
        out[o + 2] = bg[2];
        out[o + 3] = 255;
        continue;
      }
      const fx = sx - x0;
      const fy = sy - y0;
      for (let c = 0; c < 3; c++) {
        const p = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? bg[c] : data[(yy * w + xx) * 4 + c]);
        const top = p(x0, y0) * (1 - fx) + p(x0 + 1, y0) * fx;
        const bot = p(x0, y0 + 1) * (1 - fx) + p(x0 + 1, y0 + 1) * fx;
        out[o + c] = top * (1 - fy) + bot * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

export function clampBox(b: Box, w: number, h: number): Box {
  return {
    x0: Math.max(0, Math.min(w, Math.floor(b.x0))),
    y0: Math.max(0, Math.min(h, Math.floor(b.y0))),
    x1: Math.max(0, Math.min(w, Math.ceil(b.x1))),
    y1: Math.max(0, Math.min(h, Math.ceil(b.y1))),
  };
}

export const boxW = (b: Box) => b.x1 - b.x0;
export const boxH = (b: Box) => b.y1 - b.y0;

export function grow(b: Box, d: number): Box {
  return { x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d };
}

export function crop(r: Raster, box: Box): Raster {
  const b = clampBox(box, r.width, r.height);
  const w = Math.max(1, boxW(b));
  const h = Math.max(1, boxH(b));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h && b.y0 + y < r.height; y++) {
    const s = ((b.y0 + y) * r.width + b.x0) * 4;
    out.set(r.data.subarray(s, s + Math.min(w, r.width - b.x0) * 4), y * w * 4);
  }
  return { width: w, height: h, data: out };
}

export function fillBox(r: Raster, box: Box, c: RGB) {
  const b = clampBox(box, r.width, r.height);
  for (let y = b.y0; y < b.y1; y++)
    for (let x = b.x0; x < b.x1; x++) {
      const o = (y * r.width + x) * 4;
      r.data[o] = c[0];
      r.data[o + 1] = c[1];
      r.data[o + 2] = c[2];
      r.data[o + 3] = 255;
    }
}

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};
export { median };

/**
 * Background colour around a box: the pixels of a frame just outside it, taking
 * the brighter half so neighbouring ink does not darken it.
 */
export function localBackground(r: Raster, box: Box, margin = 3): RGB {
  const outer = clampBox(grow(box, margin), r.width, r.height);
  const inner = clampBox(box, r.width, r.height);
  const px: [number, number, number, number][] = [];
  const step = Math.max(1, Math.round((boxW(outer) + boxH(outer)) / 200));
  for (let y = outer.y0; y < outer.y1; y++) {
    const insideRow = y >= inner.y0 && y < inner.y1;
    for (let x = outer.x0; x < outer.x1; x += insideRow ? 1 : step) {
      if (insideRow && x >= inner.x0 && x < inner.x1) {
        x = inner.x1 - 1;
        continue;
      }
      const o = (y * r.width + x) * 4;
      px.push([r.data[o], r.data[o + 1], r.data[o + 2], lum(r.data[o], r.data[o + 1], r.data[o + 2])]);
    }
  }
  if (!px.length) return [255, 255, 255];
  const m = median(px.map((p) => p[3]));
  const bright = px.filter((p) => p[3] >= m);
  return [0, 1, 2].map((c) => median(bright.map((p) => p[c]))) as RGB;
}

/** Most common bright colour of the page (its paper colour), sampled on a grid. */
export function pageBackground(r: Raster): RGB {
  const counts = new Map<number, { n: number; s: RGB }>();
  const step = Math.max(1, Math.floor(Math.sqrt((r.width * r.height) / 40000)));
  for (let y = 0; y < r.height; y += step)
    for (let x = 0; x < r.width; x += step) {
      const o = (y * r.width + x) * 4;
      const [R, G, B] = [r.data[o], r.data[o + 1], r.data[o + 2]];
      const key = ((R >> 4) << 8) | ((G >> 4) << 4) | (B >> 4);
      const e = counts.get(key) ?? counts.set(key, { n: 0, s: [0, 0, 0] }).get(key)!;
      e.n++;
      e.s[0] += R;
      e.s[1] += G;
      e.s[2] += B;
    }
  let best: { n: number; s: RGB } | null = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  return best ? (best.s.map((v) => Math.round(v / best!.n)) as RGB) : [255, 255, 255];
}

export const toHex = (c: RGB) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
