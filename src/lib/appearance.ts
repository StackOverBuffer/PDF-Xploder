/**
 * Appearance streams for annotations. Each annotation is drawn into a Form
 * XObject in page user space; the same XObject serves as the /AP of a native
 * PDF annotation, or is painted straight into the page content when flattening.
 */
import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFName,
  PDFOperator,
  PDFRef,
  closePath,
  degrees,
  drawEllipse,
  drawImage,
  drawRectangle,
  drawText,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setFillingColor,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  stroke,
  type Color,
} from 'pdf-lib';
import { hexToRgb } from './color';
import { frameGeom, pdfRectToView, pdfToView, viewToPdf } from './geometry';
import type { Annotation, PageGeom, Pt, Rect } from './types';
import { NOTE_SIZE } from './types';

/** Text shaping: how a string is split over fonts and how wide it is. */
export interface TextEngine {
  runs(text: string): { font: PDFFont; text: string }[];
  width(text: string, size: number): number;
}

/** Engine using one font, replacing characters it cannot encode with '?'. */
export function singleFontEngine(font: PDFFont): TextEngine {
  const supported = new Set(font.getCharacterSet());
  const clean = (t: string) => [...t].map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : '?')).join('');
  return {
    runs: (text) => [{ font, text: clean(text) }],
    width: (text, size) => font.widthOfTextAtSize(clean(text), size),
  };
}

/** Greedy word wrap, honouring explicit newlines. */
export function wrapLines(engine: TextEngine, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(/(\s+)/)) {
      const candidate = line + w;
      if (line && engine.width(candidate.trimEnd(), size) > maxWidth) {
        lines.push(line.trimEnd());
        line = w.trimStart();
      } else {
        line = candidate;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** Collects content-stream operators plus the resources they reference. */
export class Canvas {
  readonly ops: PDFOperator[] = [];
  private fonts = new Map<PDFFont, string>();
  private images = new Map<PDFImage, string>();
  private gstates = new Map<string, { name: string; ca: number; CA: number; BM?: string }>();

  private gs(opacity: number, blend?: 'Multiply'): string | undefined {
    if (opacity >= 1 && !blend) return undefined;
    const key = `${opacity}:${blend ?? ''}`;
    let g = this.gstates.get(key);
    if (!g) {
      g = { name: `GS${this.gstates.size}`, ca: opacity, CA: opacity, BM: blend };
      this.gstates.set(key, g);
    }
    return g.name;
  }

  private fontName(f: PDFFont): string {
    if (!this.fonts.has(f)) this.fonts.set(f, `F${this.fonts.size}`);
    return this.fonts.get(f)!;
  }

  rect(r: Rect, o: { stroke?: string; fill?: string | null; width?: number; opacity?: number; blend?: 'Multiply'; dash?: number[] }) {
    this.ops.push(
      ...drawRectangle({
        x: r.x, y: r.y, width: r.w, height: r.h,
        borderWidth: o.stroke ? o.width ?? 1 : 0,
        borderColor: o.stroke ? hexToRgb(o.stroke) : undefined,
        color: o.fill ? hexToRgb(o.fill) : undefined,
        borderDashArray: o.dash,
        rotate: degrees(0), xSkew: degrees(0), ySkew: degrees(0),
        graphicsState: this.gs(o.opacity ?? 1, o.blend),
      }),
    );
  }

  ellipse(r: Rect, o: { stroke: string; fill: string | null; width: number; opacity: number }) {
    this.ops.push(
      ...drawEllipse({
        x: r.x + r.w / 2, y: r.y + r.h / 2, xScale: r.w / 2, yScale: r.h / 2,
        borderWidth: o.width, borderColor: hexToRgb(o.stroke),
        color: o.fill ? hexToRgb(o.fill) : undefined,
        graphicsState: this.gs(o.opacity),
      }),
    );
  }

  /** Stroke a polyline (or fill a dot when it has a single point). */
  polyline(points: Pt[], o: { color: string; width: number; opacity: number }) {
    if (!points.length) return;
    const gs = this.gs(o.opacity);
    const color: Color = hexToRgb(o.color);
    this.ops.push(pushGraphicsState());
    if (gs) this.ops.push(setGraphicsState(gs));
    if (points.length === 1) {
      const { x, y } = points[0];
      const r = o.width / 2;
      this.ops.push(setFillingColor(color), ...drawEllipse({ x, y, xScale: r, yScale: r, color, borderColor: undefined, borderWidth: 0 }), popGraphicsState());
      return;
    }
    this.ops.push(setStrokingColor(color), setLineWidth(o.width), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round), moveTo(points[0].x, points[0].y));
    for (const p of points.slice(1)) this.ops.push(lineTo(p.x, p.y));
    this.ops.push(stroke(), popGraphicsState());
  }

  polygonFill(points: Pt[], colorHex: string, opacity = 1) {
    const gs = this.gs(opacity);
    this.ops.push(pushGraphicsState());
    if (gs) this.ops.push(setGraphicsState(gs));
    this.ops.push(setFillingColor(hexToRgb(colorHex)), moveTo(points[0].x, points[0].y));
    for (const p of points.slice(1)) this.ops.push(lineTo(p.x, p.y));
    this.ops.push(closePath(), fill(), popGraphicsState());
  }

  /** Draw one line of text starting at `at` (baseline origin, user space), rotated `angle` degrees CCW. */
  text(engine: TextEngine, line: string, at: Pt, o: { size: number; color: string; opacity: number; angle: number }) {
    const a = (o.angle * Math.PI) / 180;
    let dx = 0;
    for (const run of engine.runs(line)) {
      if (!run.text) continue;
      this.ops.push(
        ...drawText(run.font.encodeText(run.text), {
          font: this.fontName(run.font),
          size: o.size,
          color: hexToRgb(o.color),
          x: at.x + Math.cos(a) * dx,
          y: at.y + Math.sin(a) * dx,
          rotate: degrees(o.angle), xSkew: degrees(0), ySkew: degrees(0),
          graphicsState: this.gs(o.opacity),
        }),
      );
      dx += run.font.widthOfTextAtSize(run.text, o.size);
    }
  }

  image(img: PDFImage, at: Pt, w: number, h: number, angle: number, opacity: number) {
    if (!this.images.has(img)) this.images.set(img, `Im${this.images.size}`);
    this.ops.push(
      ...drawImage(this.images.get(img)!, {
        x: at.x, y: at.y, width: w, height: h,
        rotate: degrees(angle), xSkew: degrees(0), ySkew: degrees(0),
        graphicsState: this.gs(opacity),
      }),
    );
  }

  /** Register the collected drawing as a Form XObject with the given bounding box. */
  toXObject(doc: PDFDocument, bbox: Rect): PDFRef {
    const ctx = doc.context;
    const Font: Record<string, PDFRef> = {};
    this.fonts.forEach((name, f) => (Font[name] = f.ref));
    const XObject: Record<string, PDFRef> = {};
    this.images.forEach((name, img) => (XObject[name] = img.ref));
    const ExtGState: Record<string, unknown> = {};
    this.gstates.forEach((g) => {
      ExtGState[g.name] = g.BM ? { Type: 'ExtGState', ca: g.ca, CA: g.CA, BM: PDFName.of(g.BM) } : { Type: 'ExtGState', ca: g.ca, CA: g.CA };
    });
    const stream = ctx.formXObject(this.ops, {
      BBox: [bbox.x, bbox.y, bbox.x + bbox.w, bbox.y + bbox.h],
      Matrix: [1, 0, 0, 1, 0, 0],
      Resources: { Font, XObject, ExtGState } as never,
    });
    return ctx.register(stream);
  }
}

// ---------------------------------------------------------------- bounds

const pad = (r: Rect, p: number): Rect => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });

function boundsOf(points: Pt[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function unionRects(rects: Rect[]): Rect {
  return boundsOf(rects.flatMap((r) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }]));
}

export function arrowHeadPoints(p1: Pt, p2: Pt, width: number): [Pt, Pt] {
  const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const len = Math.max(8, width * 4);
  const pts = [-1, 1].map((s) => {
    const t = ang + Math.PI + s * (Math.PI / 7);
    return { x: p2.x + Math.cos(t) * len, y: p2.y + Math.sin(t) * len };
  });
  return [pts[0], pts[1]];
}

/** User-space rectangle an annotation occupies (its /Rect and appearance BBox). */
export function annotationRect(a: Annotation, g: PageGeom): Rect {
  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return pad(unionRects(a.rects), 1);
    case 'ink':
      return pad(boundsOf(a.paths.flat()), a.width / 2 + 1);
    case 'line':
      return pad(boundsOf([a.p1, a.p2]), a.width / 2 + 1);
    case 'arrow':
      return pad(boundsOf([a.p1, a.p2, ...arrowHeadPoints(a.p1, a.p2, a.width)]), a.width / 2 + 1);
    case 'rect':
    case 'ellipse':
      return pad(a.rect, a.width / 2);
    case 'stamp':
      return pad(a.rect, 1.5);
    case 'note': {
      const v = pdfToView(g, a.at);
      return boundsOf([a.at, viewToPdf(g, { x: v.x + NOTE_SIZE, y: v.y + NOTE_SIZE })]);
    }
    default:
      return a.rect;
  }
}

// ---------------------------------------------------------------- drawing

export interface DrawContext {
  doc: PDFDocument;
  engine: TextEngine;
  bold: TextEngine;
  /** Embedded images, cached by data URL. */
  images: Map<string, PDFImage>;
}

function dataUrlBytes(src: string): { bytes: Uint8Array; png: boolean } {
  const [head, data] = src.split(',');
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { bytes: out, png: head.includes('image/png') };
}

async function embedImage(ctx: DrawContext, src: string): Promise<PDFImage> {
  let img = ctx.images.get(src);
  if (!img) {
    const { bytes, png } = dataUrlBytes(src);
    img = png ? await ctx.doc.embedPng(bytes) : await ctx.doc.embedJpg(bytes);
    ctx.images.set(src, img);
  }
  return img;
}

/** Map a view-space point of `frame` to user space and draw a line between two of them. */
function viewLine(c: Canvas, frame: PageGeom, a: Pt, b: Pt, color: string, width: number, opacity: number) {
  c.polyline([viewToPdf(frame, a), viewToPdf(frame, b)], { color, width, opacity });
}

export interface AppearanceOptions {
  /** Draw redaction marks as solid black (when applying them) instead of as a preview outline. */
  burnRedactions?: boolean;
}

/** Build the appearance of an annotation; returns the XObject and the rect it covers. */
export async function buildAppearance(
  ctx: DrawContext,
  a: Annotation,
  g: PageGeom,
  opts: AppearanceOptions = {},
): Promise<{ ref: PDFRef; rect: Rect }> {
  const c = new Canvas();
  const op = a.opacity;
  switch (a.type) {
    case 'highlight':
      for (const r of a.rects) c.rect(r, { fill: a.color, opacity: op, blend: 'Multiply' });
      break;
    case 'underline':
    case 'strikeout': {
      const fg = frameGeom(g, a.rot);
      for (const r of a.rects) {
        const v = pdfRectToView(fg, r);
        const y = a.type === 'underline' ? v.top + v.height * 0.94 : v.top + v.height * 0.55;
        viewLine(c, fg, { x: v.left, y }, { x: v.left + v.width, y }, a.color, Math.max(0.8, v.height * 0.07), op);
      }
      break;
    }
    case 'ink':
      for (const path of a.paths) c.polyline(path, { color: a.color, width: a.width, opacity: op });
      break;
    case 'rect':
      c.rect(a.rect, { stroke: a.color, fill: a.fill, width: a.width, opacity: op });
      break;
    case 'ellipse':
      c.ellipse(a.rect, { stroke: a.color, fill: a.fill, width: a.width, opacity: op });
      break;
    case 'line':
    case 'arrow':
      c.polyline([a.p1, a.p2], { color: a.color, width: a.width, opacity: op });
      if (a.type === 'arrow') {
        const [h1, h2] = arrowHeadPoints(a.p1, a.p2, a.width);
        c.polyline([h1, a.p2, h2], { color: a.color, width: a.width, opacity: op });
      }
      break;
    case 'text': {
      const fg = frameGeom(g, a.rot);
      const v = pdfRectToView(fg, a.rect);
      if (a.border) c.rect(a.rect, { stroke: a.color, width: 1, opacity: op });
      const p = 4;
      const lh = a.fontSize * 1.2;
      wrapLines(ctx.engine, a.text, a.fontSize, v.width - p * 2).forEach((line, i) => {
        const baseline = v.top + p + a.fontSize * 0.9 + i * lh;
        if (line && baseline <= v.top + v.height + a.fontSize * 0.3) {
          c.text(ctx.engine, line, viewToPdf(fg, { x: v.left + p, y: baseline }), { size: a.fontSize, color: a.color, opacity: op, angle: fg.rotation });
        }
      });
      break;
    }
    case 'stamp': {
      const fg = frameGeom(g, a.rot);
      const v = pdfRectToView(fg, a.rect);
      c.rect(a.rect, { stroke: a.color, width: 3, opacity: op });
      const label = a.label.toUpperCase();
      let size = v.height * 0.55;
      const tw = ctx.bold.width(label, size);
      if (tw > v.width * 0.9) size *= (v.width * 0.9) / tw;
      const w = ctx.bold.width(label, size);
      c.text(ctx.bold, label, viewToPdf(fg, { x: v.left + (v.width - w) / 2, y: v.top + v.height / 2 + size * 0.35 }), { size, color: a.color, opacity: op, angle: fg.rotation });
      break;
    }
    case 'image': {
      const fg = frameGeom(g, a.rot);
      const v = pdfRectToView(fg, a.rect);
      const img = await embedImage(ctx, a.src);
      c.image(img, viewToPdf(fg, { x: v.left, y: v.top + v.height }), v.width, v.height, fg.rotation, op);
      break;
    }
    case 'redact':
      if (opts.burnRedactions) c.rect(a.rect, { fill: '#000000' });
      else c.rect(a.rect, { stroke: '#d50000', fill: '#000000', width: 1.5, opacity: 0.35, dash: [4, 2] });
      break;
    case 'note': {
      // A speech bubble drawn in the note's own upright frame.
      const o = pdfToView(g, a.at);
      const s = NOTE_SIZE / 20;
      const P = (x: number, y: number) => viewToPdf(g, { x: o.x + x * s, y: o.y + y * s });
      const bubble = [P(1.5, 1), P(18.5, 1), P(18.5, 14), P(7, 14), P(2.5, 18.5), P(2.5, 14), P(1.5, 14)];
      c.polygonFill(bubble, a.color);
      c.polyline([...bubble, bubble[0]], { color: '#5d4037', width: 1, opacity: 1 });
      c.polyline([P(5, 5.5), P(15, 5.5)], { color: '#5d4037', width: 1, opacity: 1 });
      c.polyline([P(5, 9.5), P(12, 9.5)], { color: '#5d4037', width: 1, opacity: 1 });
      break;
    }
  }
  const rect = annotationRect(a, g);
  return { ref: c.toXObject(ctx.doc, rect), rect };
}
