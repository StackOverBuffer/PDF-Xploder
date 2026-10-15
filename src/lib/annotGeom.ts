import type { Annotation, PageGeom, Pt, Rect } from './types';
import { NOTE_SIZE } from './types';
import { pdfRectToView, pdfToView, rectFromPoints, viewRectToPdf, type VRect } from './geometry';

const movePt = (p: Pt, dx: number, dy: number): Pt => ({ x: p.x + dx, y: p.y + dy });
const moveRect = (r: Rect, dx: number, dy: number): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });

/** Patch that translates an annotation by (dx, dy) in user space. */
export function translatePatch(a: Annotation, dx: number, dy: number): Partial<Annotation> {
  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return { rects: a.rects.map((r) => moveRect(r, dx, dy)) };
    case 'ink':
      return { paths: a.paths.map((p) => p.map((q) => movePt(q, dx, dy))) };
    case 'line':
    case 'arrow':
      return { p1: movePt(a.p1, dx, dy), p2: movePt(a.p2, dx, dy) };
    case 'polygon':
    case 'polyline':
    case 'cloud':
      return { vertices: a.vertices.map((p) => movePt(p, dx, dy)) };
    case 'note':
      return { at: movePt(a.at, dx, dy) };
    default:
      return { rect: moveRect(a.rect, dx, dy) };
  }
}

/** Whether the annotation is defined by a single resizable rectangle. */
export function hasRect(a: Annotation): a is Extract<Annotation, { rect: Rect }> {
  return 'rect' in a;
}

function unionView(rects: VRect[]): VRect {
  const l = Math.min(...rects.map((r) => r.left));
  const t = Math.min(...rects.map((r) => r.top));
  const r = Math.max(...rects.map((v) => v.left + v.width));
  const b = Math.max(...rects.map((v) => v.top + v.height));
  return { left: l, top: t, width: r - l, height: b - t };
}

/** Bounding box of an annotation in view space at scale 1. */
export function viewBounds(a: Annotation, g: PageGeom): VRect {
  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return unionView(a.rects.map((r) => pdfRectToView(g, r)));
    case 'ink': {
      const pts = a.paths.flat().map((p) => pdfToView(g, p));
      const pad = a.width / 2;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      return {
        left: Math.min(...xs) - pad,
        top: Math.min(...ys) - pad,
        width: Math.max(...xs) - Math.min(...xs) + 2 * pad,
        height: Math.max(...ys) - Math.min(...ys) + 2 * pad,
      };
    }
    case 'line':
    case 'arrow': {
      const r = rectFromPoints(pdfToView(g, a.p1), pdfToView(g, a.p2));
      return { left: r.x - 4, top: r.y - 4, width: r.w + 8, height: r.h + 8 };
    }
    case 'polygon':
    case 'polyline':
    case 'cloud': {
      const pts = a.vertices.map((p) => pdfToView(g, p));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const l = Math.min(...xs);
      const t = Math.min(...ys);
      return { left: l, top: t, width: Math.max(...xs) - l, height: Math.max(...ys) - t };
    }
    case 'note': {
      const v = pdfToView(g, a.at);
      return { left: v.x, top: v.y, width: NOTE_SIZE, height: NOTE_SIZE };
    }
    default:
      return pdfRectToView(g, a.rect);
  }
}

/** Resize a rect-based annotation to a new view-space box. */
export function resizePatch(g: PageGeom, v: VRect): { rect: Rect } {
  return { rect: viewRectToPdf(g, { ...v, width: Math.max(4, v.width), height: Math.max(4, v.height) }) };
}

export const ANNOT_LABELS: Record<Annotation['type'], string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'Strikeout',
  ink: 'Pencil',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  polygon: 'Polygon',
  polyline: 'Polyline',
  cloud: 'Cloud',
  text: 'Text box',
  note: 'Sticky note',
  image: 'Image',
  stamp: 'Stamp',
  redact: 'Redaction mark',
};

export function annotSummary(a: Annotation): string {
  switch (a.type) {
    case 'text':
    case 'note':
      return a.text;
    case 'stamp':
      return a.label;
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return a.text ?? '';
    case 'image':
      return a.signature ? 'Signature' : '';
    default:
      return '';
  }
}

/**
 * A "cloudy" outline: scallops (arcs bulging outwards) along the edges, as
 * PDF-XChange and Acrobat draw /BE S /Cloudy. The shared geometry for the
 * on-screen SVG and the PDF appearance stream: each edge a→b is replaced by
 * a quadratic Bézier with the control point `bulge` above the midpoint,
 * outwards (the winding of a closed outline is detected so the bumps always
 * point away from the interior; open paths bulge to the left of travel).
 */
export function cloudEdges(points: Pt[], bulge: number, close: boolean): { a: Pt; c: Pt; b: Pt }[] {
  if (points.length < 2) return points.map((p) => ({ a: p, c: p, b: p }));
  const n = points.length;
  // Twice the signed area (shoelace): > 0 means counter-clockwise in y-up space.
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    area2 += p.x * q.y - q.x * p.y;
  }
  const flip = close && area2 > 0 ? -1 : 1;
  const segs: { a: Pt; c: Pt; b: Pt }[] = [];
  for (let i = 0; i < (close ? n : n - 1); i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    // Rotating the direction (dx, dy) by ±90° gives the outward normal.
    const nx = (-(b.y - a.y) / len) * bulge * flip;
    const ny = ((b.x - a.x) / len) * bulge * flip;
    const c = { x: (a.x + b.x) / 2 + nx, y: (a.y + b.y) / 2 + ny };
    segs.push({ a, c, b });
  }
  return segs;
}

/** Points of a quadratic Bézier a–c–b, for on-screen drawing. */
export function quadraticPoints(s: { a: Pt; c: Pt; b: Pt }, steps = 8): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * s.a.x + 2 * u * t * s.c.x + t * t * s.b.x,
      y: u * u * s.a.y + 2 * u * t * s.c.y + t * t * s.b.y,
    });
  }
  return out;
}
