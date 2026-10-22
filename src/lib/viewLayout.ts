/**
 * Where pages go in the viewer: one page per row (single page, continuous) or two side by
 * side (facing pages, continuous facing), optionally with the first page alone as a cover.
 * Continuous layouts stack every row; the others show one row at a time. Positions come
 * from the page geometry, so the DOM never has to be measured.
 */
import { viewSize } from './geometry';
import type { PageGeom } from './types';

export type PageLayout = 'single' | 'continuous' | 'facing' | 'continuousFacing';

export const GAP = 16;
export const PAD = 24;

export const isFacing = (m: PageLayout) => m === 'facing' || m === 'continuousFacing';
export const isContinuous = (m: PageLayout) => m === 'continuous' || m === 'continuousFacing';

/** The pages of each row: one each, or pairs (the first page alone with a cover). */
export function rowsOf(n: number, mode: PageLayout, cover: boolean): number[][] {
  const rows: number[][] = [];
  if (!isFacing(mode)) {
    for (let i = 0; i < n; i++) rows.push([i]);
    return rows;
  }
  let i = 0;
  if (cover && n) rows.push([i++]);
  for (; i < n; i += 2) rows.push(i + 1 < n ? [i, i + 1] : [i]);
  return rows;
}

export interface Layout {
  scale: number;
  mode: PageLayout;
  /** Rows laid out (all of them when continuous, else only the current one). */
  rows: { pages: number[]; top: number; height: number }[];
  /** Per page (only for pages in `rows`): top, its offset from the centre line, size. */
  tops: Record<number, number>;
  lefts: Record<number, number>;
  widths: Record<number, number>;
  heights: Record<number, number>;
  total: number;
  maxWidth: number;
}

/**
 * The layout at `scale`; `row` is the one shown when not continuous. In a facing row the
 * pages meet at the centre (left page to its left, right page to its right); a page alone
 * there sits on its own side: the cover on the right, an odd last page on the left.
 */
export function computeLayout(geoms: PageGeom[], scale: number, mode: PageLayout = 'continuous', cover = false, row = 0): Layout {
  const all = rowsOf(geoms.length, mode, cover);
  const shown = isContinuous(mode) ? all : all.slice(Math.max(0, Math.min(row, all.length - 1)), Math.max(0, Math.min(row, all.length - 1)) + 1);
  const size = (i: number) => {
    const { width, height } = viewSize(geoms[i]);
    return { w: Math.floor(width * scale), h: Math.floor(height * scale) };
  };
  const L: Layout = { scale, mode, rows: [], tops: {}, lefts: {}, widths: {}, heights: {}, total: 0, maxWidth: 0 };
  const facing = isFacing(mode);
  let y = PAD;
  let half = 0;
  for (const pages of shown) {
    const sizes = pages.map(size);
    const height = Math.max(...sizes.map((s) => s.h));
    pages.forEach((p, k) => {
      const { w, h } = sizes[k];
      L.tops[p] = y;
      L.widths[p] = w;
      L.heights[p] = h;
      if (!facing) L.lefts[p] = -w / 2;
      else {
        const right = pages.length === 2 ? k === 1 : cover && p === 0;
        L.lefts[p] = right ? GAP / 2 : -GAP / 2 - w;
      }
      half = Math.max(half, facing ? w + GAP / 2 : w / 2);
    });
    L.rows.push({ pages, top: y, height });
    y += height + GAP;
  }
  L.total = y + PAD - GAP;
  L.maxWidth = Math.ceil(half * 2);
  return L;
}

/** The row at `y`: the last one whose top is at or above it (binary search). */
export function rowAtY(L: Layout, y: number): number {
  let lo = 0;
  let hi = L.rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (L.rows[mid].top <= y) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** The row a page is in. */
export function rowOfPage(page: number, mode: PageLayout, cover: boolean): number {
  if (!isFacing(mode)) return page;
  return cover ? Math.floor((page + 1) / 2) : Math.floor(page / 2);
}

/** The first page of the next (dir 1) or previous (dir -1) row: one view further, as Page Down does. */
export function stepPage(current: number, dir: 1 | -1, n: number, mode: PageLayout, cover: boolean): number {
  const rows = rowsOf(n, mode, cover);
  const r = Math.max(0, Math.min(rows.length - 1, rowOfPage(current, mode, cover) + dir));
  return rows[r]?.[0] ?? 0;
}
