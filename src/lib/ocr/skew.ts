/**
 * Page geometry detection on binarised images: skew angle (projection
 * profiles), whether text lines run horizontally or vertically, and whether
 * text is upside down (ascenders outnumber descenders in Latin scripts).
 */
import type { Gray } from './raster';

/** Ink pixel coordinates, subsampled to at most `max` points. */
function inkPoints(bin: Gray, max = 250_000): Float32Array {
  let n = 0;
  for (let i = 0; i < bin.data.length; i++) n += bin.data[i];
  const step = Math.max(1, Math.ceil(n / max));
  const pts = new Float32Array(Math.ceil(n / step) * 2 + 2);
  let k = 0;
  let c = 0;
  for (let y = 0; y < bin.height; y++)
    for (let x = 0; x < bin.width; x++)
      if (bin.data[y * bin.width + x] && c++ % step === 0) {
        pts[k++] = x;
        pts[k++] = y;
      }
  return pts.subarray(0, k);
}

/** Sharpness of the horizontal projection after undoing a rotation of `deg`. */
function profileScore(pts: Float32Array, deg: number, h: number, w: number): number {
  const r = (deg * Math.PI) / 180;
  const sin = Math.sin(r);
  const cos = Math.cos(r);
  const off = Math.ceil(w * Math.abs(sin)) + 1;
  const bins = new Float64Array(Math.ceil(h + w * Math.abs(sin)) + 3);
  for (let i = 0; i < pts.length; i += 2) bins[Math.round(pts[i + 1] * cos - pts[i] * sin) + off]++;
  let s = 0;
  for (let i = 0; i < bins.length; i++) s += bins[i] * bins[i];
  return s;
}

export interface SkewResult {
  /** Clockwise rotation of the content in degrees (rotate by −angle to correct). */
  angle: number;
  /** How much sharper the best profile is than a typical angle's (≥ 0; text pages ≫ 0.1). */
  confidence: number;
}

/** Skew of text lines within ±maxDeg, by maximising projection-profile sharpness. */
export function detectSkew(bin: Gray, maxDeg = 15): SkewResult {
  const pts = inkPoints(bin);
  if (pts.length < 200) return { angle: 0, confidence: 0 };
  const score = (a: number) => profileScore(pts, a, bin.height, bin.width);
  let best = 0;
  let bestScore = -1;
  const scores: number[] = [];
  for (let a = -maxDeg; a <= maxDeg + 1e-9; a += 0.5) {
    const s = score(a);
    scores.push(s);
    if (s > bestScore) [best, bestScore] = [a, s];
  }
  const coarse = best;
  for (let a = coarse - 0.5; a <= coarse + 0.5 + 1e-9; a += 0.05) {
    const s = score(a);
    if (s > bestScore) [best, bestScore] = [a, s];
  }
  const sorted = [...scores].sort((x, y) => x - y);
  const med = sorted[sorted.length >> 1];
  return { angle: Math.round(best * 100) / 100, confidence: med ? (bestScore - med) / med : 0 };
}

function inkBounds(bin: Gray) {
  let [x0, y0, x1, y1] = [bin.width, bin.height, -1, -1];
  for (let y = 0; y < bin.height; y++)
    for (let x = 0; x < bin.width; x++)
      if (bin.data[y * bin.width + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Normalised variance of a profile: high when ink comes in bands with gaps. */
function bandiness(p: Float64Array) {
  let s = 0;
  for (const v of p) s += v;
  const m = s / p.length;
  if (!m) return 0;
  let v = 0;
  for (const x of p) v += (x - m) ** 2;
  return v / p.length / (m * m);
}

/**
 * Whether text lines run horizontally (0°/180°) or vertically (90°/270°),
 * comparing how banded the row and column projections are. Null if unclear.
 */
export function lineDirection(bin: Gray): 'horizontal' | 'vertical' | null {
  const b = inkBounds(bin);
  if (!b) return null;
  const rows = new Float64Array(b.y1 - b.y0);
  const cols = new Float64Array(b.x1 - b.x0);
  for (let y = b.y0; y < b.y1; y++)
    for (let x = b.x0; x < b.x1; x++)
      if (bin.data[y * bin.width + x]) {
        rows[y - b.y0]++;
        cols[x - b.x0]++;
      }
  const r = bandiness(rows);
  const c = bandiness(cols);
  if (r > c * 1.3) return 'horizontal';
  if (c > r * 1.3) return 'vertical';
  return null;
}

/**
 * Whether horizontal text lines are upright (1), upside down (−1) or unclear (0).
 * Within each line, ink above the dense x-height band (ascenders, capitals) is
 * compared with ink below it (descenders).
 */
export function uprightness(bin: Gray): { vote: -1 | 0 | 1; ratio: number } {
  const rows = new Float64Array(bin.height);
  for (let y = 0; y < bin.height; y++) {
    let s = 0;
    for (let x = 0; x < bin.width; x++) s += bin.data[y * bin.width + x];
    rows[y] = s;
  }
  let above = 0;
  let below = 0;
  let y = 0;
  while (y < bin.height) {
    if (!rows[y]) {
      y++;
      continue;
    }
    let e = y;
    while (e < bin.height && rows[e]) e++;
    // A text line spans rows y..e-1; its core is where density reaches half the peak.
    if (e - y >= 4) {
      let peak = 0;
      for (let i = y; i < e; i++) peak = Math.max(peak, rows[i]);
      let top = y;
      while (rows[top] < peak * 0.5) top++;
      let bot = e - 1;
      while (rows[bot] < peak * 0.5) bot--;
      for (let i = y; i < top; i++) above += rows[i];
      for (let i = bot + 1; i < e; i++) below += rows[i];
    }
    y = e;
  }
  const ratio = (above + 1) / (below + 1);
  return { vote: ratio > 1.25 ? 1 : ratio < 0.8 ? -1 : 0, ratio };
}
