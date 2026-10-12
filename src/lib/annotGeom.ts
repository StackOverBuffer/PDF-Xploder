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
