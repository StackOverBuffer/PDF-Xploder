/**
 * Text style recognition from the pixels of each word box. Tesseract's LSTM
 * engine reports no font attributes, so they are measured:
 *
 *   colour     mean colour of the word's darkest (core) ink pixels
 *   bold       stroke width (2 × ink area / ink perimeter) relative to the font
 *              size, compared with the regular weight of the page
 *   italic     the mean drift of near-vertical stroke segments from row to row
 *   underline  a dark run across ≥ 85 % of the word just below the baseline
 *   strikeout  the same through the middle of the x-height
 *   serif      vertical stems whose foot widens on both sides at the baseline
 *   monospace  (per line) evenly spaced character boxes
 */
import { clampBox, lum, type Box, type Raster, type RGB } from './raster';
import type { FontFamily, OcrLine, OcrWord, StyledLine, StyledWord } from './types';

/** Measurements of one word before page-wide classification. */
export interface WordMetrics {
  size: number;
  baselineY: number;
  color: RGB;
  /** Stroke width divided by font size. */
  stroke: number;
  /** tan of the slant (positive leans right). */
  slant: number;
  underline: Box | null;
  strikeout: Box | null;
  /** Share of stems with serifs (−1: no stems). */
  foot: number;
  /** Ink pixels measured (0 if the word had no contrast). */
  ink: number;
}

/** Font size in pixels of a line (from Tesseract's row height, else the box). */
export function lineSize(line: OcrLine): number {
  const h = line.box.y1 - line.box.y0;
  return line.rowHeight > 0 ? Math.min(line.rowHeight / 0.93, h * 1.6) : h / 0.93;
}

export function baselineAt(line: OcrLine, x: number): number {
  const b = line.baseline;
  if (b.x1 === b.x0) return b.y0;
  return b.y0 + ((x - b.x0) * (b.y1 - b.y0)) / (b.x1 - b.x0);
}

/** Longest run of ink in a row of a mask between x0 and x1, bridging gaps up to `gap`. */
function longestRun(mask: Uint8Array, w: number, y: number, x0: number, x1: number, gap: number) {
  let best = 0;
  let start = -1;
  let lastInk = -1;
  for (let x = x0; x < x1; x++) {
    if (!mask[y * w + x]) continue;
    if (start < 0 || x - lastInk > gap + 1) start = x;
    lastInk = x;
    best = Math.max(best, x - start + 1);
  }
  return best;
}

/** Ink runs [start, end) of a mask row. */
function rowRuns(mask: Uint8Array, w: number, y: number): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let x = 0; x <= w; x++) {
    const ink = x < w && mask[y * w + x];
    if (ink && s < 0) s = x;
    else if (!ink && s >= 0) {
      out.push([s, x]);
      s = -1;
    }
  }
  return out;
}

/**
 * Slant as the mean drift of near-vertical stroke segments from row to row.
 * Opposite diagonals (v, w, o) cancel out, so only a common lean remains.
 */
export function estimateSlant(mask: Uint8Array, w: number, h: number, size: number): number {
  let sum = 0;
  let n = 0;
  let prev = rowRuns(mask, w, 0);
  for (let y = 1; y < h; y++) {
    const cur = rowRuns(mask, w, y);
    for (const [a, b] of prev) {
      if (b - a > size * 0.25) continue;
      const below = cur.filter(([c, d]) => c < b && d > a);
      if (below.length !== 1) continue;
      const [c, d] = below[0];
      if (Math.abs(d - c - (b - a)) > Math.max(1, (b - a) * 0.5)) continue;
      const dx = (c + d - a - b) / 2;
      if (Math.abs(dx) > 1.5) continue;
      sum += dx;
      n++;
    }
    prev = cur;
  }
  // Going down a right-leaning stroke moves left.
  return n >= 8 ? -sum / n : 0;
}

/** Undo a slant: shift rows so right-leaning strokes become vertical. */
function deshear(mask: Uint8Array, w: number, h: number, slant: number, baseline: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const shift = Math.round(slant * (baseline - y));
    for (let x = 0; x < w; x++) {
      const sx = x + shift;
      if (sx >= 0 && sx < w) out[y * w + x] = mask[y * w + sx];
    }
  }
  return out;
}

/**
 * Share of vertical stems standing on the baseline whose foot widens on both
 * sides (a serif). Returns -1 when the word has no stems to judge.
 */
export function serifScore(mask: Uint8Array, w: number, h: number, baseline: number, size: number): number {
  const minLen = size * 0.3;
  const stemCols: boolean[] = [];
  const bottoms: number[] = [];
  for (let x = 0; x < w; x++) {
    // Longest vertical run ending near the baseline.
    let y = Math.min(h - 1, baseline + 1);
    while (y > baseline - 3 && y >= 0 && !mask[y * w + x]) y--;
    let top = y;
    while (top >= 0 && mask[top * w + x]) top--;
    const ok = y > baseline - 3 && y - top >= minLen;
    stemCols.push(ok);
    bottoms.push(y);
  }
  let stems = 0;
  let feet = 0;
  for (let x = 0; x < w; ) {
    if (!stemCols[x]) {
      x++;
      continue;
    }
    let e = x;
    while (e < w && stemCols[e]) e++;
    const sw = e - x;
    if (sw <= size * 0.2) {
      stems++;
      const bottom = Math.max(...bottoms.slice(x, e));
      const mid = (x + e) >> 1;
      let left = 0;
      let right = 0;
      for (let y = Math.max(0, Math.round(bottom - size * 0.06)); y <= bottom; y++) {
        const run = rowRuns(mask, w, y).find(([a, b]) => a <= mid && b > mid);
        if (!run) continue;
        left = Math.max(left, x - run[0]);
        right = Math.max(right, run[1] - e);
      }
      // Anti-aliasing and resampling widen a stem's foot by a pixel; a serif reaches further.
      const need = Math.max(1.5, sw * 0.5, size * 0.035);
      if (left >= need && right >= need) feet++;
    }
    x = e;
  }
  return stems ? feet / stems : -1;
}

/** Measure a word in `img` (the image it was recognised in). */
export function measureWord(img: Raster, line: OcrLine, word: OcrWord): WordMetrics {
  const size = lineSize(line);
  const cx = (word.box.x0 + word.box.x1) / 2;
  const baselineY = baselineAt(line, cx);
  // The analysed region reaches below the baseline far enough to include an underline.
  const region = clampBox(
    { x0: word.box.x0 - 1, y0: word.box.y0 - 1, x1: word.box.x1 + 1, y1: Math.max(word.box.y1, baselineY + size * 0.38) + 1 },
    img.width,
    img.height,
  );
  const W = region.x1 - region.x0;
  const H = region.y1 - region.y0;
  const none: WordMetrics = { size, baselineY, color: [0, 0, 0], stroke: 0, slant: 0, underline: null, strikeout: null, foot: -1, ink: 0 };
  if (W < 2 || H < 2) return none;

  const L = new Float32Array(W * H);
  const sorted: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = ((region.y0 + y) * img.width + region.x0 + x) * 4;
      const v = lum(img.data[o], img.data[o + 1], img.data[o + 2]);
      L[y * W + x] = v;
      sorted.push(v);
    }
  sorted.sort((a, b) => a - b);
  const dark = sorted[Math.floor(sorted.length * 0.03)];
  const light = sorted[Math.floor(sorted.length * 0.9)];
  if (light - dark < 40) return none;
  const threshold = (dark + light) / 2;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) mask[i] = L[i] <= threshold ? 1 : 0;

  // Colour: core ink, away from anti-aliased edges.
  const core = dark + (light - dark) * 0.3;
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (L[y * W + x] <= core) {
        const o = ((region.y0 + y) * img.width + region.x0 + x) * 4;
        sum[0] += img.data[o];
        sum[1] += img.data[o + 1];
        sum[2] += img.data[o + 2];
        n++;
      }
  const color = sum.map((s) => s / Math.max(1, n)) as RGB;

  // Decorations: a nearly unbroken horizontal run across the word.
  const by = baselineY - region.y0;
  const gap = Math.max(1, Math.round(size / 40));
  const findBand = (from: number, to: number, cover: number): Box | null => {
    const a = Math.max(0, Math.floor(from));
    const b = Math.min(H, Math.ceil(to));
    let hit = -1;
    let bestRun = 0;
    for (let y = a; y < b; y++) {
      const r = longestRun(mask, W, y, 0, W, gap);
      if (r > bestRun) [hit, bestRun] = [y, r];
    }
    const wordW = word.box.x1 - word.box.x0;
    if (hit < 0 || bestRun < wordW * cover) return null;
    let top = hit;
    let bot = hit;
    while (top > 0 && longestRun(mask, W, top - 1, 0, W, gap) >= wordW * cover * 0.8) top--;
    while (bot < H - 1 && longestRun(mask, W, bot + 1, 0, W, gap) >= wordW * cover * 0.8) bot++;
    return { x0: region.x0, y0: region.y0 + top, x1: region.x1, y1: region.y0 + bot + 1 };
  };
  const underline = findBand(by + size * 0.03, by + size * 0.36, 0.85);
  const strikeout = findBand(by - size * 0.42, by - size * 0.12, 0.9);

  // Glyph rows only: the word box minus decorations.
  const glyph = new Uint8Array(mask);
  for (const d of [underline, strikeout]) {
    if (!d) continue;
    for (let y = d.y0 - region.y0 - 1; y <= d.y1 - region.y0; y++) if (y >= 0 && y < H) glyph.fill(0, y * W, (y + 1) * W);
  }
  const gy1 = Math.min(H, word.box.y1 + 1 - region.y0);
  let area = 0;
  let perim = 0;
  for (let y = 0; y < gy1; y++)
    for (let x = 0; x < W; x++) {
      if (!glyph[y * W + x]) continue;
      area++;
      if (x === 0 || !glyph[y * W + x - 1]) perim++;
      if (x === W - 1 || !glyph[y * W + x + 1]) perim++;
      if (y === 0 || !glyph[(y - 1) * W + x]) perim++;
      if (y === gy1 - 1 || !glyph[(y + 1) * W + x]) perim++;
    }
  const stroke = perim ? (2 * area) / perim / size : 0;

  const slant = estimateSlant(glyph, W, gy1, size);
  const foot = serifScore(slant ? deshear(glyph, W, gy1, slant, by) : glyph, W, gy1, Math.round(by), size);

  return { size, baselineY, color, stroke, slant: Math.round(slant * 1000) / 1000, underline, strikeout, foot, ink: area };
}

/** Whether the symbol boxes of a line are evenly spaced, as in monospaced fonts. */
export function isMonospaced(line: OcrLine): boolean {
  const steps: number[] = [];
  const widths: number[] = [];
  for (const w of line.words) {
    const s = w.symbols.filter((x) => x.box.x1 > x.box.x0);
    for (let i = 1; i < s.length; i++) steps.push((s[i].box.x0 + s[i].box.x1) / 2 - (s[i - 1].box.x0 + s[i - 1].box.x1) / 2);
    for (const x of s) widths.push(x.box.x1 - x.box.x0);
  }
  if (steps.length < 5) return false;
  const m = steps.reduce((a, b) => a + b, 0) / steps.length;
  const sd = Math.sqrt(steps.reduce((a, b) => a + (b - m) ** 2, 0) / steps.length);
  return m > 0 && sd / m < 0.12;
}

const snapColor = (c: RGB): RGB => {
  const chroma = Math.max(...c) - Math.min(...c);
  if (chroma < 40 && lum(...c) < 100) return [0, 0, 0];
  return c.map((v) => Math.round(v)) as RGB;
};

export interface StyleOptions {
  /** Measure bold, italic, decorations and fonts (otherwise only size and colour defaults). */
  styles: boolean;
}

/** Thresholds for classifying the measurements. */
export const STYLE_LIMITS = {
  /**
   * Bold if stroke/size exceeds the regular weight by this factor. The regular
   * weight is the lower quartile of the font family's words on the page (so a
   * few bold headings do not shift it); bold weights measure 1.5–1.8×.
   */
  boldRelative: 1.3,
  /** Used while fewer than `minWords` words give a reference. */
  boldAbsolute: 0.085,
  minWords: 4,
  /** Slant (tan) from which a word counts as italic; upright fonts measure < 0.05, italics 0.1–0.45. */
  italicSlant: 0.08,
  /** Mean share of stems with serifs on a line; upright sans lines measure ≈ 0–0.3, upright serif lines ≥ 0.7. */
  serifShare: 0.6,
};

const quantile = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};

/** Measure and classify all words of a page. */
export function styleLines(img: Raster, lines: OcrLine[], opts: StyleOptions): StyledLine[] {
  const measured = lines.map((line) => line.words.map((w) => (opts.styles ? measureWord(img, line, w) : null)));
  const usable = (m: WordMetrics | null): m is WordMetrics => !!m && m.ink > 20 && m.stroke > 0;
  const families: FontFamily[] = lines.map((line, li) => {
    if (!opts.styles) return 'sans';
    if (isMonospaced(line)) return 'mono';
    // Serifs are judged per line: single words are too noisy.
    // Digits are left out: many sans fonts give the 1 a foot.
    const feet = measured[li].filter((m, wi) => usable(m) && m.foot >= 0 && /\p{L}{3}/u.test(line.words[wi].text)).map((m) => m!.foot);
    return feet.length > 0 && feet.reduce((a, b) => a + b, 0) / feet.length >= STYLE_LIMITS.serifShare ? 'serif' : 'sans';
  });
  const strokesOf = (f?: FontFamily) => measured.flatMap((ms, li) => (!f || families[li] === f ? ms.filter(usable).map((m) => m.stroke) : []));
  const all = strokesOf();
  const boldLimit = (f: FontFamily) => {
    const own = strokesOf(f);
    const ref = own.length >= STYLE_LIMITS.minWords ? own : all.length >= STYLE_LIMITS.minWords ? all : null;
    return ref ? quantile(ref, 0.25) * STYLE_LIMITS.boldRelative : STYLE_LIMITS.boldAbsolute;
  };
  const limits = new Map<FontFamily, number>((['sans', 'serif', 'mono'] as const).map((f) => [f, boldLimit(f)]));
  const lettered = (t: string) => (t.match(/\p{L}/gu)?.length ?? 0) >= 2;
  return lines.map((line, li) => {
    const size = lineSize(line);
    const family = families[li];
    // Digits and symbols (7, 4, /) lean on their own: such words follow the slant of the line's words.
    const slanted = measured[li].filter((m, wi) => m && m.ink && lettered(line.words[wi].text)).map((m) => m!.slant >= STYLE_LIMITS.italicSlant);
    const lineItalic = slanted.filter(Boolean).length > slanted.length / 2;
    const words: StyledWord[] = line.words.map((w, wi) => {
      const m = measured[li][wi];
      const baselineY = m?.baselineY ?? baselineAt(line, (w.box.x0 + w.box.x1) / 2);
      if (!m || !m.ink)
        return { ...w, baselineY, style: { color: m ? snapColor(m.color) : [0, 0, 0], bold: false, italic: false, underline: false, strikeout: false, family, size, decorations: [] } };
      return {
        ...w,
        baselineY,
        style: {
          color: snapColor(m.color),
          bold: m.stroke > limits.get(family)!,
          italic: lettered(w.text) ? m.slant >= STYLE_LIMITS.italicSlant : lineItalic,
          underline: !!m.underline,
          strikeout: !!m.strikeout,
          family,
          size,
          decorations: [m.underline, m.strikeout].filter((d): d is Box => !!d),
        },
      };
    });
    return { words, box: line.box };
  });
}
