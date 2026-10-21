/**
 * Which annotations are under the pointer, by their shape (not the browser's notion
 * of what is painted on top): lines, unfilled shapes and freehand strokes count near
 * their outline, filled shapes and boxes (text, stamps, pictures, notes) inside. The
 * smallest comes first, so a small comment is not hidden by a large one around it;
 * among equals the one on top.
 */
import { viewBounds, cloudRadius } from './annotGeom';
import { pdfToView } from './geometry';
import type { Annotation, PageGeom, Pt } from './types';

/** Distance from p to the segment a–b. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pathDist(p: Pt, pts: Pt[], closed: boolean): number {
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i - 1], pts[i]));
  if (closed && pts.length > 2) d = Math.min(d, segDist(p, pts[pts.length - 1], pts[0]));
  return d;
}

function inPolygon(p: Pt, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Whether `a` is under `p` (view coordinates at scale 1); `tol` is the reach in the same units. */
export function hitsAnnotation(a: Annotation, g: PageGeom, p: Pt, tol: number): boolean {
  const v = viewBounds(a, g);
  // Cheap reject first.
  if (p.x < v.left - tol || p.x > v.left + v.width + tol || p.y < v.top - tol || p.y > v.top + v.height + tol) return false;
  const view = (q: Pt) => pdfToView(g, q);
  switch (a.type) {
    case 'line':
    case 'arrow':
      return segDist(p, view(a.p1), view(a.p2)) <= tol + a.width / 2;
    case 'ink':
      return a.paths.some((path) => pathDist(p, path.map(view), false) <= tol + a.width / 2);
    case 'polyline':
      return pathDist(p, a.vertices.map(view), false) <= tol + a.width / 2;
    case 'polygon':
    case 'cloud': {
      const pts = a.vertices.map(view);
      if (a.fill && inPolygon(p, pts)) return true;
      const reach = a.type === 'cloud' ? cloudRadius(a.width) : 0;
      return pathDist(p, pts, true) <= tol + a.width / 2 + reach;
    }
    case 'rect': {
      const inside = p.x >= v.left && p.x <= v.left + v.width && p.y >= v.top && p.y <= v.top + v.height;
      if (a.fill) return inside;
      const edge = Math.min(Math.abs(p.x - v.left), Math.abs(p.x - v.left - v.width), Math.abs(p.y - v.top), Math.abs(p.y - v.top - v.height));
      const within = p.x >= v.left - tol && p.x <= v.left + v.width + tol && p.y >= v.top - tol && p.y <= v.top + v.height + tol;
      return within && edge <= tol + a.width / 2;
    }
    case 'ellipse': {
      const rx = v.width / 2;
      const ry = v.height / 2;
      if (rx <= 0 || ry <= 0) return false;
      const r = Math.hypot((p.x - v.left - rx) / rx, (p.y - v.top - ry) / ry);
      if (a.fill && r <= 1) return true;
      return Math.abs(r - 1) * Math.min(rx, ry) <= tol + a.width / 2;
    }
    default:
      // Boxes and text markup: inside their area.
      return p.x >= v.left - tol / 2 && p.x <= v.left + v.width + tol / 2 && p.y >= v.top - tol / 2 && p.y <= v.top + v.height + tol / 2;
  }
}

/** The annotations under `p`, in the order a click picks them (see the module comment). */
export function annotationsAt(annots: Annotation[], g: PageGeom, p: Pt, tol: number): Annotation[] {
  const area = (a: Annotation) => {
    const v = viewBounds(a, g);
    return Math.max(1, v.width) * Math.max(1, v.height);
  };
  // Sizes in steps of 1.5×: clearly smaller first, similar sizes in their stacking order (top first).
  const step = (x: number) => Math.floor(Math.log(x) / Math.log(1.5));
  return annots
    .map((a, z) => ({ a, z, size: step(area(a)) }))
    .filter((x) => hitsAnnotation(x.a, g, p, tol))
    .sort((x, y) => x.size - y.size || y.z - x.z)
    .map((x) => x.a);
}
