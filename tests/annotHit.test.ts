import { describe, expect, it } from 'vitest';
import { annotationsAt, hitsAnnotation } from '../src/lib/annotHit';
import type { Annotation, PageGeom } from '../src/lib/types';

// An unrotated 600 × 800 page: view y = 800 − user y.
const g: PageGeom = { view: [0, 0, 600, 800], rotation: 0 };
const base = { color: '#ff0000', opacity: 1, author: 'a', createdAt: 0 };
const rect = (id: string, x: number, y: number, w: number, h: number, fill: string | null = null): Annotation => ({ ...base, id, type: 'rect', rect: { x, y, w, h }, width: 2, fill });
const line: Annotation = { ...base, id: 'line', type: 'line', p1: { x: 100, y: 100 }, p2: { x: 300, y: 100 }, width: 1 };
const v = (x: number, y: number) => ({ x, y: 800 - y });

describe('annotation hit testing', () => {
  it('reaches thin lines within the tolerance only', () => {
    expect(hitsAnnotation(line, g, v(200, 103), 5)).toBe(true);
    expect(hitsAnnotation(line, g, v(200, 110), 5)).toBe(false);
  });

  it('unfilled shapes count near their outline, filled ones inside', () => {
    const open = rect('open', 100, 100, 200, 200);
    expect(hitsAnnotation(open, g, v(200, 200), 5)).toBe(false);
    expect(hitsAnnotation(open, g, v(102, 200), 5)).toBe(true);
    expect(hitsAnnotation(rect('filled', 100, 100, 200, 200, '#00ff00'), g, v(200, 200), 5)).toBe(true);
  });

  it('puts a small annotation before a large one over it, then the one on top', () => {
    const small = rect('small', 190, 190, 20, 20, '#0000ff');
    const big = rect('big', 100, 100, 300, 300, '#00ff00'); // drawn later: on top
    expect(annotationsAt([small, big], g, v(200, 200), 5).map((a) => a.id)).toEqual(['small', 'big']);
    // Similar sizes keep their stacking order (top first).
    const a = rect('a', 100, 100, 100, 100, '#000000');
    const b = rect('b', 110, 110, 100, 100, '#000000');
    expect(annotationsAt([a, b], g, v(150, 150), 5).map((x) => x.id)).toEqual(['b', 'a']);
  });
});
