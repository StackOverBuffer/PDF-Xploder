import { describe, expect, it } from 'vitest';
import { cloudEdges, quadraticPoints, translatePatch, viewBounds } from '../src/lib/annotGeom';
import { annotationRect } from '../src/lib/appearance';
import type { Annotation, PageGeom } from '../src/lib/types';

const g: PageGeom = { view: [0, 0, 300, 200], rotation: 0 };

describe('cloud geometry', () => {
  const triangle = [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 200 },
  ];

  it('makes one scallop per closed edge, bulging outwards', () => {
    const segs = cloudEdges(triangle, 10, true);
    expect(segs).toHaveLength(3);
    // The shoelace area of the triangle is positive (counter-clockwise in y-up
    // space), so the bumps flip to the outside of the outline.
    expect(segs[0].a).toEqual(triangle[0]);
    expect(segs[0].b).toEqual(triangle[1]);
    // First edge is the bottom: the bump must sit below it (outside).
    expect(segs[0].c.y).toBeLessThan(95);
    expect(segs[0].c.x).toBeCloseTo(150);
    // Second edge is the right side: the bump must be to its right (outside).
    expect(segs[1].c.x).toBeGreaterThan(205);
    expect(segs[1].c.y).toBeCloseTo(150);
  });

  it('makes one scallop fewer for open polylines', () => {
    expect(cloudEdges(triangle, 10, false)).toHaveLength(2);
  });

  it('scales the bump with the bulge parameter', () => {
    const [s10] = cloudEdges([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10, false);
    const [s30] = cloudEdges([{ x: 0, y: 0 }, { x: 100, y: 0 }], 30, false);
    expect(s10.c.y).toBeCloseTo(10);
    expect(s30.c.y).toBeCloseTo(30);
  });

  it('samples quadratic Bézier scallops from endpoint to endpoint through the bump', () => {
    const seg = { a: { x: 0, y: 0 }, c: { x: 50, y: 50 }, b: { x: 100, y: 0 } };
    const pts = quadraticPoints(seg);
    expect(pts[0]).toEqual(seg.a);
    expect(pts[pts.length - 1]).toEqual(seg.b);
    const apex = pts.reduce((m, p) => (p.y > m.y ? p : m), pts[0]);
    expect(apex.y).toBeCloseTo(25); // apex of the quadratic = half the control offset
    expect(apex.x).toBeCloseTo(50);
  });

  it('never produces NaN for degenerate (zero length) edges', () => {
    const segs = cloudEdges([{ x: 5, y: 5 }, { x: 5, y: 5 }], 8, true);
    expect(segs).toHaveLength(0);
  });
});

describe('polygon geometry', () => {
  const poly: Annotation = {
    id: 'p', type: 'polygon', color: '#ff0000', opacity: 1, author: '', createdAt: 0,
    vertices: [{ x: 10, y: 10 }, { x: 100, y: 50 }, { x: 60, y: 150 }], width: 2, fill: null,
  };

  it('moves all vertices with the annotation', () => {
    const patch = translatePatch(poly, 5, -7) as { vertices: { x: number; y: number }[] };
    expect(patch.vertices[0]).toEqual({ x: 15, y: 3 });
    expect(patch.vertices[2]).toEqual({ x: 65, y: 143 });
  });

  it('bounds the vertices in view space', () => {
    const v = viewBounds(poly, g);
    expect(v.left).toBe(10);
    expect(v.top).toBe(50); // view y is down: user y=150 is the smallest view y
    expect(v.width).toBe(90);
    expect(v.height).toBe(140);
  });

  it('pads the appearance rect by half the line width plus 1', () => {
    const r = annotationRect(poly, g);
    // width/2 + 1 = 2 on each side of the vertex bounds (10..100, 10..150).
    expect(r.x).toBe(8);
    expect(r.y).toBe(8);
    expect(r.w).toBe(94);
    expect(r.h).toBe(144);
  });

  it('includes the cloud bumps in the appearance rect', () => {
    // A right triangle: two scallops stick out beyond the vertical and horizontal legs.
    const cloud: Annotation = { ...poly, type: 'cloud', vertices: [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 10, y: 100 }] };
    const r = annotationRect(cloud, g);
    expect(r.w).toBeGreaterThan(94);
    expect(r.h).toBeGreaterThan(94);
  });
});
