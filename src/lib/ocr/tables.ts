/**
 * Table recognition: ruling lines are long, thin runs of ink; lines that cross
 * each other form tables, whose cells are the grid between them (cells
 * spanning a missing ruling are merged).
 */
import { transpose, type Box, type Gray, type Raster } from './raster';
import type { RulingLine, Table } from './types';

interface Segment {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
}

/** Horizontal ink runs of at least `minLen` (bridging gaps ≤ `gap`), tolerant of ±1 px of slope. */
function horizontalSegments(bin: Gray, minLen: number, gap: number, maxThick: number): Segment[] {
  const { width: w, height: h, data } = bin;
  const at = (x: number, y: number) => data[y * w + x] || (y > 0 && data[(y - 1) * w + x]) || (y < h - 1 && data[(y + 1) * w + x]);
  const open: (Segment & { last: number })[] = [];
  const done: Segment[] = [];
  for (let y = 0; y < h; y++) {
    const runs: [number, number][] = [];
    let start = -1;
    let lastInk = -1;
    for (let x = 0; x <= w; x++) {
      const ink = x < w && at(x, y);
      if (ink) {
        if (start < 0) start = x;
        lastInk = x;
      } else if (start >= 0 && (x === w || x - lastInk > gap)) {
        if (lastInk + 1 - start >= minLen) runs.push([start, lastInk + 1]);
        start = -1;
      }
    }
    for (const [a, b] of runs) {
      const seg = open.find((s) => s.last === y - 1 && Math.min(s.x1, b) - Math.max(s.x0, a) > 0.5 * Math.min(s.x1 - s.x0, b - a));
      if (seg) {
        seg.last = y;
        seg.y1 = y + 1;
        seg.x0 = Math.min(seg.x0, a);
        seg.x1 = Math.max(seg.x1, b);
      } else open.push({ y0: y, y1: y + 1, x0: a, x1: b, last: y });
    }
    for (let i = open.length - 1; i >= 0; i--)
      if (open[i].last < y) {
        done.push(open[i]);
        open.splice(i, 1);
      }
  }
  done.push(...open);
  // The ±1 px tolerance adds a row on each side.
  return done.filter((s) => s.y1 - s.y0 - 2 <= maxThick);
}

/** Measure a segment on the real ink: centre row and thickness. */
function refine(bin: Gray, s: Segment): { y: number; thickness: number } {
  let n = 0;
  let sy = 0;
  for (let y = Math.max(0, s.y0); y < Math.min(bin.height, s.y1); y++)
    for (let x = s.x0; x < s.x1; x++)
      if (bin.data[y * bin.width + x]) {
        n++;
        sy += y;
      }
  const len = s.x1 - s.x0;
  return { y: n ? sy / n + 0.5 : (s.y0 + s.y1) / 2, thickness: Math.max(1, n / len) };
}

/** Mean colour of the ink of a line. */
function inkColor(img: Raster | undefined, bin: Gray, box: Box): [number, number, number] {
  if (!img) return [0, 0, 0];
  const s = [0, 0, 0];
  let n = 0;
  const step = Math.max(1, Math.floor((box.x1 - box.x0) * (box.y1 - box.y0) / 4000));
  let i = 0;
  for (let y = Math.max(0, box.y0); y < Math.min(bin.height, box.y1); y++)
    for (let x = Math.max(0, box.x0); x < Math.min(bin.width, box.x1); x++)
      if (bin.data[y * bin.width + x] && i++ % step === 0) {
        const o = (y * img.width + x) * 4;
        s[0] += img.data[o];
        s[1] += img.data[o + 1];
        s[2] += img.data[o + 2];
        n++;
      }
  const c = s.map((v) => (n ? v / n : 0)) as [number, number, number];
  return Math.max(...c) - Math.min(...c) < 40 && Math.max(...c) < 110 ? [0, 0, 0] : (c.map(Math.round) as [number, number, number]);
}

export interface RulingOptions {
  /** Resolution of the image, to scale lengths. */
  dpi: number;
  /** Minimum line length in inches. */
  minLength?: number;
  /** Maximum line thickness in inches. */
  maxThickness?: number;
}

/** Long thin horizontal and vertical lines in a binary image. */
export function detectRulings(bin: Gray, opts: RulingOptions, img?: Raster): RulingLine[] {
  const minLen = Math.round(opts.dpi * (opts.minLength ?? 0.4));
  const maxThick = Math.max(2, Math.round(opts.dpi * (opts.maxThickness ?? 0.03)));
  const gap = Math.max(1, Math.round(opts.dpi / 150));
  const out: RulingLine[] = [];
  for (const s of horizontalSegments(bin, minLen, gap, maxThick)) {
    const { y, thickness } = refine(bin, s);
    out.push({ dir: 'h', x0: s.x0, x1: s.x1, y0: y, y1: y, thickness, color: inkColor(img, bin, { x0: s.x0, x1: s.x1, y0: s.y0, y1: s.y1 }) });
  }
  const t = transpose(bin);
  for (const s of horizontalSegments(t, minLen, gap, maxThick)) {
    const { y: x, thickness } = refine(t, s);
    out.push({ dir: 'v', x0: x, x1: x, y0: s.x0, y1: s.x1, thickness, color: inkColor(img, bin, { x0: s.y0, x1: s.y1, y0: s.x0, y1: s.x1 }) });
  }
  return out;
}

/** Pixel box covered by a ruling line, grown by `pad`. */
export function rulingBox(l: RulingLine, pad = 1): Box {
  const h = l.thickness / 2 + pad;
  return l.dir === 'h'
    ? { x0: l.x0 - pad, x1: l.x1 + pad, y0: l.y0 - h, y1: l.y0 + h }
    : { x0: l.x0 - h, x1: l.x0 + h, y0: l.y0 - pad, y1: l.y1 + pad };
}

/** Group crossing lines into tables (at least two rows and two columns of rulings). */
export function detectTables(lines: RulingLine[], dpi: number): Table[] {
  const tol = Math.max(3, dpi * 0.03);
  const parent = lines.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const crosses = (h: RulingLine, v: RulingLine) => {
    const t = tol + Math.max(h.thickness, v.thickness);
    return v.x0 >= h.x0 - t && v.x0 <= h.x1 + t && h.y0 >= v.y0 - t && h.y0 <= v.y1 + t;
  };
  for (let i = 0; i < lines.length; i++)
    for (let j = 0; j < lines.length; j++)
      if (lines[i].dir === 'h' && lines[j].dir === 'v' && crosses(lines[i], lines[j])) parent[find(i)] = find(j);

  const groups = new Map<number, RulingLine[]>();
  lines.forEach((l, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(l));
  const tables: Table[] = [];
  for (const g of groups.values()) {
    const hs = g.filter((l) => l.dir === 'h');
    const vs = g.filter((l) => l.dir === 'v');
    if (hs.length < 2 || vs.length < 2) continue;
    const cluster = (vals: number[]) => {
      const out: number[] = [];
      for (const v of [...vals].sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > tol) out.push(v);
      return out;
    };
    const rows = cluster(hs.map((l) => l.y0));
    const cols = cluster(vs.map((l) => l.x0));
    if (rows.length < 2 || cols.length < 2) continue;
    const box = {
      x0: Math.min(...g.map((l) => l.x0)),
      y0: Math.min(...g.map((l) => l.y0)),
      x1: Math.max(...g.map((l) => l.x1)),
      y1: Math.max(...g.map((l) => l.y1)),
    };
    // Grid cells, merged across rulings that are missing at the cell.
    const R = rows.length - 1;
    const C = cols.length - 1;
    const cellParent = Array.from({ length: R * C }, (_, i) => i);
    const cf = (i: number): number => (cellParent[i] === i ? i : (cellParent[i] = cf(cellParent[i])));
    const hasV = (x: number, y: number) => vs.some((l) => Math.abs(l.x0 - x) <= tol && l.y0 - tol <= y && l.y1 + tol >= y);
    const hasH = (y: number, x: number) => hs.some((l) => Math.abs(l.y0 - y) <= tol && l.x0 - tol <= x && l.x1 + tol >= x);
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++) {
        const ym = (rows[r] + rows[r + 1]) / 2;
        const xm = (cols[c] + cols[c + 1]) / 2;
        if (c + 1 < C && !hasV(cols[c + 1], ym)) cellParent[cf(r * C + c)] = cf(r * C + c + 1);
        if (r + 1 < R && !hasH(rows[r + 1], xm)) cellParent[cf(r * C + c)] = cf((r + 1) * C + c);
      }
    const cells = new Map<number, Box>();
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++) {
        const k = cf(r * C + c);
        const b = cells.get(k);
        const cell = { x0: cols[c], y0: rows[r], x1: cols[c + 1], y1: rows[r + 1] };
        cells.set(k, b ? { x0: Math.min(b.x0, cell.x0), y0: Math.min(b.y0, cell.y0), x1: Math.max(b.x1, cell.x1), y1: Math.max(b.y1, cell.y1) } : cell);
      }
    tables.push({ box, rows, cols, cells: [...cells.values()] });
  }
  return tables;
}
