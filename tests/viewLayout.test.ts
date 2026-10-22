import { describe, expect, it } from 'vitest';
import { computeLayout, GAP, PAD, rowAtY, rowOfPage, rowsOf, stepPage } from '../src/lib/viewLayout';
import type { PageGeom } from '../src/lib/types';

const page = (w = 600, h = 800, rotation = 0): PageGeom => ({ view: [0, 0, w, h], rotation });
const pages = (n: number) => Array.from({ length: n }, () => page());

describe('page layouts', () => {
  it('pairs pages, with the first alone as a cover', () => {
    expect(rowsOf(5, 'continuous', false)).toEqual([[0], [1], [2], [3], [4]]);
    expect(rowsOf(5, 'facing', false)).toEqual([[0, 1], [2, 3], [4]]);
    expect(rowsOf(5, 'continuousFacing', true)).toEqual([[0], [1, 2], [3, 4]]);
    expect(rowsOf(0, 'facing', true)).toEqual([]);
  });

  it('stacks every row when continuous, one row otherwise', () => {
    const c = computeLayout(pages(3), 0.5, 'continuous');
    expect(c.rows.map((r) => r.top)).toEqual([PAD, PAD + 400 + GAP, PAD + 2 * (400 + GAP)]);
    expect(c.lefts[1]).toBe(-150);
    expect(c.total).toBe(PAD * 2 + 3 * 400 + 2 * GAP);
    const single = computeLayout(pages(3), 0.5, 'single', false, 2);
    expect(single.rows).toEqual([{ pages: [2], top: PAD, height: 400 }]);
    expect(single.tops[0]).toBeUndefined();
  });

  it('meets facing pages at the centre; a cover and an odd last page keep their side', () => {
    const f = computeLayout(pages(3), 0.5, 'continuousFacing', false);
    expect([f.lefts[0], f.lefts[1]]).toEqual([-GAP / 2 - 300, GAP / 2]);
    expect(f.lefts[2]).toBe(-GAP / 2 - 300);
    expect(f.maxWidth).toBe(600 + GAP);
    const cover = computeLayout(pages(3), 0.5, 'continuousFacing', true);
    expect(cover.rows[0].pages).toEqual([0]);
    expect(cover.lefts[0]).toBe(GAP / 2);
    // Rows are as high as their taller page.
    const mixed = computeLayout([page(600, 800), page(800, 600)], 1, 'facing');
    expect(mixed.rows[0].height).toBe(800);
  });

  it('finds rows and steps one view at a time', () => {
    const f = computeLayout(pages(6), 1, 'continuousFacing', true);
    expect(rowAtY(f, 0)).toBe(0);
    expect(rowAtY(f, f.rows[2].top + 5)).toBe(2);
    expect(rowOfPage(4, 'facing', true)).toBe(2);
    expect(rowOfPage(4, 'facing', false)).toBe(2);
    expect(rowOfPage(3, 'single', false)).toBe(3);
    expect(stepPage(1, 1, 6, 'facing', true)).toBe(3);
    expect(stepPage(2, 1, 6, 'facing', true)).toBe(3);
    expect(stepPage(3, -1, 6, 'facing', true)).toBe(1);
    expect(stepPage(5, 1, 6, 'facing', true)).toBe(5);
    expect(stepPage(0, -1, 6, 'continuous', false)).toBe(0);
    expect(stepPage(2, 1, 6, 'continuous', false)).toBe(3);
  });
});
