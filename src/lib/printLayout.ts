/**
 * Print layout, as in PDF-XChange's print dialog: page range and subset, paper
 * size and orientation, scaling, several pages per sheet. The result is a new
 * PDF with one page per printed sheet, handed to the browser's print dialog.
 */
import { PDFDocument, PDFRef, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject, rectangle, clip, endPath } from '@cantoo/pdf-lib';
import { load } from './pdfOps';
import { uprightMatrix } from './organize';
import { inv, mul, type M } from './content/matrix';
import { normRot } from './geometry';
import type { PageGeom } from './types';

export const PAPERS = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008],
} as const;

export type Paper = 'document' | keyof typeof PAPERS;
export type PerSheet = 1 | 2 | 4 | 6 | 9 | 16;

export interface PrintOptions {
  /** 0-based page indices in document order, before subset and reverse. */
  pages: number[];
  subset: 'all' | 'odd' | 'even';
  reverse: boolean;
  comments: boolean;
  paper: Paper;
  orientation: 'auto' | 'portrait' | 'landscape';
  scaling: 'fit' | 'shrink' | 'actual' | 'custom';
  /** Percent, for custom scaling. */
  customScale: number;
  perSheet: PerSheet;
  /** Order of pages on a sheet: rows first or columns first. */
  order: 'horizontal' | 'vertical';
  borders: boolean;
  /** Sheet margin in millimetres. */
  margin: number;
}

export const DEFAULT_PRINT: Omit<PrintOptions, 'pages'> = {
  subset: 'all',
  reverse: false,
  comments: true,
  paper: 'document',
  orientation: 'auto',
  scaling: 'fit',
  customScale: 100,
  perSheet: 1,
  order: 'horizontal',
  borders: false,
  margin: 0,
};

const MM = 72 / 25.4;
/** Space between pages on one sheet. */
const GUTTER = 4 * MM;

export interface Placement {
  page: number;
  /** Lower-left corner of the page on the sheet (points, y up) and its scale. */
  x: number;
  y: number;
  scale: number;
  /** Size on the sheet. */
  w: number;
  h: number;
  /** The cell it sits in (pages larger than it are clipped). */
  cell: { x: number; y: number; w: number; h: number };
}

export interface Sheet {
  width: number;
  height: number;
  items: Placement[];
  /** Thin frame around each page. */
  borders: boolean;
}

/** Pages actually printed, in order. Odd/even refer to page numbers. */
export function printedPages(o: Pick<PrintOptions, 'pages' | 'subset' | 'reverse'>): number[] {
  const list = o.pages.filter((i) => o.subset === 'all' || (o.subset === 'odd' ? i % 2 === 0 : i % 2 === 1));
  return o.reverse ? list.reverse() : list;
}

/** Columns × rows for n pages on a portrait sheet (swapped on landscape sheets). */
function grid(n: PerSheet, landscape: boolean): [number, number] {
  const portrait: Record<PerSheet, [number, number]> = { 1: [1, 1], 2: [1, 2], 4: [2, 2], 6: [2, 3], 9: [3, 3], 16: [4, 4] };
  const [c, r] = portrait[n];
  return landscape ? [r, c] : [c, r];
}

const orient = (w: number, h: number, landscape: boolean): [number, number] => (landscape === w > h ? [w, h] : [h, w]);

/**
 * Lay out the printed pages on sheets. `sizes[i]` is page i as displayed
 * (width × height in points, rotation applied).
 */
export function planSheets(o: PrintOptions, sizes: { width: number; height: number }[]): Sheet[] {
  const pages = printedPages(o).filter((i) => sizes[i]);
  if (!pages.length) return [];
  const n = o.perSheet;
  const margin = Math.max(0, o.margin) * MM;
  const sheets: Sheet[] = [];
  for (let k = 0; k < pages.length; k += n) {
    const group = pages.slice(k, k + n);
    const first = sizes[group[0]];
    const firstLandscape = first.width > first.height;
    // Auto: one page follows the page; 2 and 6 per sheet turn the sheet the other way so the pages stay large.
    const landscape = o.orientation === 'auto' ? (n === 2 || n === 6 ? !firstLandscape : firstLandscape) : o.orientation === 'landscape';
    const base: readonly [number, number] = o.paper === 'document' ? [first.width, first.height] : PAPERS[o.paper];
    const [width, height] = orient(base[0], base[1], landscape);
    const [cols, rows] = grid(n, width > height);
    const gap = n > 1 ? GUTTER : 0;
    const cw = (width - 2 * margin - gap * (cols - 1)) / cols;
    const ch = (height - 2 * margin - gap * (rows - 1)) / rows;
    const items = group.map((page, j): Placement => {
      const col = o.order === 'horizontal' ? j % cols : Math.floor(j / rows);
      const row = o.order === 'horizontal' ? Math.floor(j / cols) : j % rows;
      const cell = { x: margin + col * (cw + gap), y: height - margin - (row + 1) * ch - row * gap, w: cw, h: ch };
      const s = sizes[page];
      const fit = Math.min(cell.w / s.width, cell.h / s.height);
      const scale = o.scaling === 'fit' ? fit : o.scaling === 'shrink' ? Math.min(1, fit) : o.scaling === 'actual' ? 1 : Math.max(0.01, o.customScale / 100);
      const w = s.width * scale;
      const h = s.height * scale;
      return { page, scale, w, h, cell, x: cell.x + (cell.w - w) / 2, y: cell.y + (cell.h - h) / 2 };
    });
    sheets.push({ width, height, items, borders: o.borders && n > 1 });
  }
  return sheets;
}

/** Whether printing the prepared document as is gives the same result (no re-layout needed). */
export function isPlain(o: PrintOptions, count: number): boolean {
  const all = o.pages.length === count && o.pages.every((p, i) => p === i);
  return all && o.subset === 'all' && !o.reverse && o.paper === 'document' && o.perSheet === 1 && o.orientation === 'auto' && o.margin === 0 && (o.scaling === 'fit' || o.scaling === 'shrink' || o.scaling === 'actual' || o.customScale === 100);
}

/** Build the sheets as a PDF from the prepared document (comments and form fields already in the page content). */
export async function buildPrintPdf(bytes: Uint8Array, sheets: Sheet[]): Promise<Uint8Array> {
  const src = await load(bytes);
  const srcPages = src.getPages();
  const out = await PDFDocument.create();
  const embedded = new Map<number, { ref: PDFRef; g: PageGeom }>();
  for (const sheet of sheets) {
    const page = out.addPage([sheet.width, sheet.height]);
    for (const it of sheet.items) {
      const sp = srcPages[it.page];
      if (!sp) continue;
      if (sheet.borders) page.drawRectangle({ x: it.x, y: it.y, width: it.w, height: it.h, borderWidth: 0.5, borderColor: rgb(0.35, 0.35, 0.35) });
      // A page without content (e.g. a new blank page) prints as an empty area.
      if (!sp.node.Contents()) continue;
      if (!embedded.has(it.page)) {
        const c = sp.getCropBox();
        const form = await out.embedPage(sp, { left: c.x, bottom: c.y, right: c.x + c.width, top: c.y + c.height });
        // Form space is the crop box moved to the origin.
        embedded.set(it.page, { ref: form.ref, g: { view: [0, 0, form.width, form.height], rotation: normRot(sp.getRotation().angle) } });
      }
      const { ref, g } = embedded.get(it.page)!;
      const place: M = [it.scale, 0, 0, it.scale, it.x, it.y];
      const m = mul(inv(uprightMatrix(g))!, place);
      const name = page.node.newXObject('Pg', ref);
      const { x, y, w, h } = it.cell;
      page.pushOperators(pushGraphicsState(), rectangle(x, y, w, h), clip(), endPath(), concatTransformationMatrix(...m), drawObject(name), popGraphicsState());
    }
  }
  return out.save({ useObjectStreams: true });
}
