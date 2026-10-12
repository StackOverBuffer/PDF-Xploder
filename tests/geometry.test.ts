import { describe, expect, it } from 'vitest';
import { frameMatrix, pdfToView, viewToPdf, viewSize, pdfRectToView, viewRectToPdf } from '../src/lib/geometry';
import type { PageGeom } from '../src/lib/types';

const base: [number, number, number, number] = [10, 20, 210, 320]; // 200 x 300, offset origin

describe('geometry', () => {
  for (const rotation of [0, 90, 180, 270]) {
    const g: PageGeom = { view: base, rotation };
    it(`round-trips points at ${rotation}°`, () => {
      for (const p of [{ x: 10, y: 20 }, { x: 210, y: 320 }, { x: 57, y: 133 }]) {
        const back = viewToPdf(g, pdfToView(g, p));
        expect(back.x).toBeCloseTo(p.x);
        expect(back.y).toBeCloseTo(p.y);
      }
    });
    it(`maps the crop box onto the view box at ${rotation}°`, () => {
      const vs = viewSize(g);
      const v = pdfRectToView(g, { x: 10, y: 20, w: 200, h: 300 });
      expect(v).toEqual({ left: 0, top: 0, width: vs.width, height: vs.height });
      expect(viewRectToPdf(g, v)).toEqual({ x: 10, y: 20, w: 200, h: 300 });
    });
  }

  it('puts the user-space top-left at the view top-left when unrotated', () => {
    expect(pdfToView({ view: base, rotation: 0 }, { x: 10, y: 320 })).toEqual({ x: 0, y: 0 });
  });

  it('puts the user-space bottom-left at the view top-left when rotated 90° clockwise', () => {
    expect(pdfToView({ view: base, rotation: 90 }, { x: 10, y: 20 })).toEqual({ x: 0, y: 0 });
    expect(viewSize({ view: base, rotation: 90 })).toEqual({ width: 300, height: 200 });
  });
});

describe('frameMatrix', () => {
  const apply = (m: number[], x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  it('is a pure scale when the orientation is unchanged', () => {
    const g: PageGeom = { view: base, rotation: 90 };
    expect(frameMatrix(g, g, 2)).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('maps content created upright at 0° onto a page rotated 90°', () => {
    const now: PageGeom = { view: base, rotation: 90 };
    const created: PageGeom = { view: base, rotation: 0 };
    const m = frameMatrix(now, created, 1);
    // The old top-left corner moves to the top-right of the rotated view.
    const [x, y] = apply(m, 0, 0);
    expect(x).toBeCloseTo(300);
    expect(y).toBeCloseTo(0);
    // ...and agrees with going through user space point by point.
    const p = { x: 40, y: 70 };
    const viaPdf = pdfToView(now, viewToPdf(created, p));
    const [mx, my] = apply(m, p.x, p.y);
    expect(mx).toBeCloseTo(viaPdf.x);
    expect(my).toBeCloseTo(viaPdf.y);
  });
});
