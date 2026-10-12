import type { PageGeom, Pt, Rect } from './types';

/** Normalised rotation in {0, 90, 180, 270}. */
export function normRot(r: number): number {
  return (((Math.round(r / 90) * 90) % 360) + 360) % 360;
}

/** Size of the page as displayed (after rotation) at scale 1. */
export function viewSize(g: PageGeom): { width: number; height: number } {
  const w = g.view[2] - g.view[0];
  const h = g.view[3] - g.view[1];
  return normRot(g.rotation) % 180 === 0 ? { width: w, height: h } : { width: h, height: w };
}

/**
 * Map a point from PDF user space to view space (origin top-left, y down, scale 1).
 * The page rotation is applied clockwise, as viewers display /Rotate.
 */
export function pdfToView(g: PageGeom, p: Pt): Pt {
  const [x0, y0, x1, y1] = g.view;
  switch (normRot(g.rotation)) {
    case 90:
      return { x: p.y - y0, y: p.x - x0 };
    case 180:
      return { x: x1 - p.x, y: p.y - y0 };
    case 270:
      return { x: y1 - p.y, y: x1 - p.x };
    default:
      return { x: p.x - x0, y: y1 - p.y };
  }
}

/** Inverse of {@link pdfToView}. */
export function viewToPdf(g: PageGeom, v: Pt): Pt {
  const [x0, y0, x1, y1] = g.view;
  switch (normRot(g.rotation)) {
    case 90:
      return { x: v.y + x0, y: v.x + y0 };
    case 180:
      return { x: x1 - v.x, y: v.y + y0 };
    case 270:
      return { x: x1 - v.y, y: y1 - v.x };
    default:
      return { x: v.x + x0, y: y1 - v.y };
  }
}

/** A rectangle in view space: left/top/width/height. */
export interface VRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function rectFromPoints(a: Pt, b: Pt): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function pdfRectToView(g: PageGeom, r: Rect): VRect {
  const a = pdfToView(g, { x: r.x, y: r.y });
  const b = pdfToView(g, { x: r.x + r.w, y: r.y + r.h });
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function viewRectToPdf(g: PageGeom, v: VRect): Rect {
  const a = viewToPdf(g, { x: v.left, y: v.top });
  const b = viewToPdf(g, { x: v.left + v.width, y: v.top + v.height });
  return rectFromPoints(a, b);
}

export function translateRect(r: Rect, dx: number, dy: number): Rect {
  return { ...r, x: r.x + dx, y: r.y + dy };
}

export function rectContains(r: Rect, p: Pt): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Geometry of the page as it was oriented when an annotation was created. */
export function frameGeom(g: PageGeom, rot: number | undefined): PageGeom {
  return rot === undefined ? g : { view: g.view, rotation: normRot(rot) };
}

/**
 * SVG/canvas matrix [a, b, c, d, e, f] mapping view coordinates of `frame`
 * (scale 1) to view coordinates of `g` at the given scale.
 */
export function frameMatrix(g: PageGeom, frame: PageGeom, scale: number): [number, number, number, number, number, number] {
  const map = (x: number, y: number) => pdfToView(g, viewToPdf(frame, { x, y }));
  const o = map(0, 0);
  const px = map(1, 0);
  const py = map(0, 1);
  return [(px.x - o.x) * scale, (px.y - o.y) * scale, (py.x - o.x) * scale, (py.y - o.y) * scale, o.x * scale, o.y * scale];
}
