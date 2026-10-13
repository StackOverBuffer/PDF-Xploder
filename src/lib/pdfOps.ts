/**
 * Document-level operations implemented with pdf-lib. Every function takes the
 * current PDF bytes and returns new bytes, so the store can keep immutable
 * snapshots for undo/redo. Nothing here touches the DOM, so it is unit-testable.
 */
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFPage,
  PDFRadioGroup,
  PDFTextField,
  degrees,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { hexToRgb } from './color';
import { normRot, viewRectToPdf, viewSize, viewToPdf, type VRect } from './geometry';
import type { Annotation, PageGeom, Pt } from './types';
import { buildAppearance, type DrawContext, type TextEngine } from './appearance';
import { createTextEngine, loadFontBytes } from './fonts';
import { importAnnotations, writeNativeAnnotation } from './annotIO';

export async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

async function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true });
}

export function geomOf(page: PDFPage): PageGeom {
  const b = page.getCropBox();
  return { view: [b.x, b.y, b.x + b.width, b.y + b.height], rotation: normRot(page.getRotation().angle) };
}

export async function createBlankDocument(width = 595.28, height = 841.89): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  return save(doc);
}

// ---------------------------------------------------------------- pages

export async function rotatePages(bytes: Uint8Array, indices: number[], delta: number): Promise<Uint8Array> {
  const doc = await load(bytes);
  for (const i of indices) {
    const p = doc.getPage(i);
    p.setRotation(degrees(normRot(p.getRotation().angle + delta)));
  }
  return save(doc);
}

export async function deletePages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  if (indices.length >= doc.getPageCount()) throw new Error('A document must keep at least one page.');
  [...new Set(indices)].sort((a, b) => b - a).forEach((i) => doc.removePage(i));
  return save(doc);
}

export async function insertBlankPage(bytes: Uint8Array, at: number, size?: [number, number]): Promise<Uint8Array> {
  const doc = await load(bytes);
  let dims = size;
  if (!dims) {
    const ref = doc.getPage(Math.min(Math.max(at - 1, 0), doc.getPageCount() - 1));
    const { width, height } = ref.getSize();
    dims = [width, height];
  }
  doc.insertPage(at, dims);
  return save(doc);
}

/** Reorder pages. `order[i]` is the old index of the page that ends up at position i. */
export async function reorderPages(bytes: Uint8Array, order: number[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  const pages = doc.getPages();
  if (order.length !== pages.length || new Set(order).size !== pages.length) {
    throw new Error('Invalid page order');
  }
  for (let i = pages.length - 1; i >= 0; i--) doc.removePage(i);
  order.forEach((old, i) => doc.insertPage(i, pages[old]));
  return save(doc);
}

export async function duplicatePages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  const sorted = [...new Set(indices)].sort((a, b) => b - a);
  for (const i of sorted) {
    const [copy] = await doc.copyPages(doc, [i]);
    doc.insertPage(i + 1, copy);
  }
  return save(doc);
}

export async function extractPages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return save(out);
}

/** Insert every page of `other` before position `at` (use page count to append). */
export async function insertDocument(bytes: Uint8Array, other: Uint8Array, at: number): Promise<{ bytes: Uint8Array; count: number }> {
  const doc = await load(bytes);
  const src = await load(other);
  const pages = await doc.copyPages(src, src.getPageIndices());
  pages.forEach((p, i) => doc.insertPage(at + i, p));
  return { bytes: await save(doc), count: pages.length };
}

export async function splitEvery(bytes: Uint8Array, n: number): Promise<Uint8Array[]> {
  const src = await load(bytes);
  const count = src.getPageCount();
  const parts: Uint8Array[] = [];
  for (let start = 0; start < count; start += n) {
    const idx = Array.from({ length: Math.min(n, count - start) }, (_, k) => start + k);
    parts.push(await extractPages(bytes, idx));
  }
  return parts;
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Shrink the crop box of each page by the given margins, measured as the page is displayed. */
export async function cropPages(bytes: Uint8Array, indices: number[], m: Margins): Promise<Uint8Array> {
  const doc = await load(bytes);
  for (const i of indices) {
    const page = doc.getPage(i);
    const g = geomOf(page);
    const vs = viewSize(g);
    const v: VRect = {
      left: m.left,
      top: m.top,
      width: vs.width - m.left - m.right,
      height: vs.height - m.top - m.bottom,
    };
    if (v.width < 10 || v.height < 10) throw new Error(`Margins are larger than page ${i + 1}.`);
    const r = viewRectToPdf(g, v);
    page.setCropBox(r.x, r.y, r.w, r.h);
  }
  return save(doc);
}

// ---------------------------------------------------------------- text helpers

interface UprightOpts {
  engine: TextEngine;
  size: number;
  color: string;
  opacity?: number;
}

/** Draw a line of text that reads upright in the *displayed* (rotated) page orientation. */
function drawUprightText(page: PDFPage, g: PageGeom, text: string, at: Pt, o: UprightOpts, extraRotate = 0) {
  const angle = normRot(g.rotation) + extraRotate;
  const a = (angle * Math.PI) / 180;
  const origin = viewToPdf(g, at);
  let dx = 0;
  for (const run of o.engine.runs(text)) {
    page.drawText(run.text, {
      x: origin.x + Math.cos(a) * dx,
      y: origin.y + Math.sin(a) * dx,
      size: o.size,
      font: run.font,
      color: hexToRgb(o.color),
      opacity: o.opacity ?? 1,
      rotate: degrees(angle),
    });
    dx += run.font.widthOfTextAtSize(run.text, o.size);
  }
}

// ---------------------------------------------------------------- stamping

export type PageSelection = 'all' | number[];

function pickPages(doc: PDFDocument, sel: PageSelection): PDFPage[] {
  const pages = doc.getPages();
  return sel === 'all' ? pages : sel.filter((i) => i >= 0 && i < pages.length).map((i) => pages[i]);
}

export interface WatermarkOptions {
  text: string;
  fontSize: number;
  color: string;
  opacity: number;
  /** Angle in degrees, counter-clockwise, relative to the displayed page. */
  angle: number;
  pages: PageSelection;
}

export async function addWatermark(bytes: Uint8Array, o: WatermarkOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const engine = await createTextEngine(doc, [o.text], 'bold');
  const text = o.text;
  for (const page of pickPages(doc, o.pages)) {
    const g = geomOf(page);
    const vs = viewSize(g);
    const tw = engine.width(text, o.fontSize);
    const th = o.fontSize * 0.72;
    // Centre the text: start from the centre and back off half the text box along the rotated axes.
    const a = (o.angle * Math.PI) / 180;
    const cx = vs.width / 2;
    const cy = vs.height / 2;
    // In view space (y down) the baseline runs along (cos a, -sin a) and "up" is (-sin a, -cos a).
    const at = {
      x: cx - (Math.cos(a) * tw) / 2 + (Math.sin(a) * th) / 2,
      y: cy + (Math.sin(a) * tw) / 2 + (Math.cos(a) * th) / 2,
    };
    drawUprightText(page, g, text, at, { engine, size: o.fontSize, color: o.color, opacity: o.opacity }, o.angle);
  }
  return save(doc);
}

export type Position = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface HeaderFooterOptions {
  /** Template; supports {page}, {pages}, {date}, {title} and {bates}. */
  template: string;
  position: Position;
  fontSize: number;
  color: string;
  margin: number;
  startNumber: number;
  batesPrefix: string;
  batesDigits: number;
  pages: PageSelection;
}

export function formatHeaderFooter(o: HeaderFooterOptions, pageNo: number, pageCount: number, title: string): string {
  const n = o.startNumber + pageNo;
  return o.template
    .replace(/\{page\}/g, String(n))
    .replace(/\{pages\}/g, String(pageCount + o.startNumber - 1))
    .replace(/\{date\}/g, new Date().toLocaleDateString())
    .replace(/\{title\}/g, title)
    .replace(/\{bates\}/g, o.batesPrefix + String(n).padStart(o.batesDigits, '0'));
}

export async function addHeaderFooter(bytes: Uint8Array, o: HeaderFooterOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const all = doc.getPages();
  const title = doc.getTitle() ?? '';
  const targets = pickPages(doc, o.pages);
  const texts = targets.map((page) => formatHeaderFooter(o, all.indexOf(page), all.length, title));
  const engine = await createTextEngine(doc, texts);
  for (const [k, page] of targets.entries()) {
    const text = texts[k];
    const g = geomOf(page);
    const vs = viewSize(g);
    const tw = engine.width(text, o.fontSize);
    const [vert, horiz] = o.position.split('-');
    const x = horiz === 'left' ? o.margin : horiz === 'right' ? vs.width - o.margin - tw : (vs.width - tw) / 2;
    const y = vert === 'top' ? o.margin + o.fontSize : vs.height - o.margin;
    drawUprightText(page, g, text, { x, y }, { engine, size: o.fontSize, color: o.color });
  }
  return save(doc);
}

// ---------------------------------------------------------------- metadata

export interface Metadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
}

export async function getMetadata(bytes: Uint8Array): Promise<Metadata> {
  const doc = await load(bytes);
  return {
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    keywords: doc.getKeywords() ?? '',
    creator: doc.getCreator() ?? '',
    producer: doc.getProducer() ?? '',
  };
}

export async function setMetadata(bytes: Uint8Array, m: Metadata): Promise<Uint8Array> {
  const doc = await load(bytes);
  doc.setTitle(m.title);
  doc.setAuthor(m.author);
  doc.setSubject(m.subject);
  doc.setKeywords(m.keywords.split(/[,;]\s*/).filter(Boolean));
  doc.setCreator(m.creator);
  doc.setProducer(m.producer);
  doc.setModificationDate(new Date());
  return save(doc);
}

// ---------------------------------------------------------------- forms

export type FieldInfo =
  | { kind: 'text'; name: string; value: string; multiline: boolean; readOnly: boolean }
  | { kind: 'checkbox'; name: string; value: boolean; readOnly: boolean }
  | { kind: 'radio' | 'dropdown'; name: string; value: string; options: string[]; readOnly: boolean }
  | { kind: 'list'; name: string; value: string[]; options: string[]; readOnly: boolean }
  | { kind: 'other'; name: string; readOnly: boolean };

export async function getFormFields(bytes: Uint8Array): Promise<FieldInfo[]> {
  const doc = await load(bytes);
  return doc.getForm().getFields().map((f): FieldInfo => {
    const name = f.getName();
    const readOnly = f.isReadOnly();
    if (f instanceof PDFTextField) {
      return { kind: 'text', name, value: f.getText() ?? '', multiline: f.isMultiline(), readOnly };
    }
    if (f instanceof PDFCheckBox) return { kind: 'checkbox', name, value: f.isChecked(), readOnly };
    if (f instanceof PDFRadioGroup) {
      return { kind: 'radio', name, value: f.getSelected() ?? '', options: f.getOptions(), readOnly };
    }
    if (f instanceof PDFDropdown) {
      return { kind: 'dropdown', name, value: f.getSelected()[0] ?? '', options: f.getOptions(), readOnly };
    }
    if (f instanceof PDFOptionList) {
      return { kind: 'list', name, value: f.getSelected(), options: f.getOptions(), readOnly };
    }
    return { kind: 'other', name, readOnly };
  });
}

export type FieldValue = string | boolean | string[];

export async function setFormValues(
  bytes: Uint8Array,
  values: Record<string, FieldValue>,
  opts: { flatten?: boolean } = {},
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    const f = form.getField(name);
    if (f instanceof PDFTextField) f.setText(String(value));
    else if (f instanceof PDFCheckBox) (value ? f.check() : f.uncheck());
    else if (f instanceof PDFRadioGroup) (value ? f.select(String(value)) : f.clear());
    else if (f instanceof PDFDropdown) (value ? f.select(String(value)) : f.clear());
    else if (f instanceof PDFOptionList) f.select(Array.isArray(value) ? value : [String(value)]);
  }
  // Helvetica only covers WinAnsi; use Noto Sans for appearances when values need more.
  const needsUnicode = Object.values(values).some((v) => [v].flat().some((x) => typeof x === 'string' && /[^\x00-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/.test(x)));
  if (needsUnicode) {
    const fontBytes = await loadFontBytes('sans');
    if (fontBytes) {
      doc.registerFontkit(fontkit);
      // Not subset: the font must contain every glyph a later edit of the field may need.
      form.updateFieldAppearances(await doc.embedFont(fontBytes, { subset: false }));
    }
  }
  if (opts.flatten) form.flatten();
  return save(doc);
}

// ---------------------------------------------------------------- export annotations

export interface ExportOptions {
  /** Paint annotations into the page content instead of writing editable PDF annotations. */
  flatten?: boolean;
  /** Burn redaction marks in as solid black (only used when applying redactions). */
  burnRedactions?: boolean;
}

/** Text drawn by an annotation, used to decide which fonts to embed. */
function annotationTexts(list: Annotation[]): { regular: string[]; bold: string[] } {
  return {
    regular: list.flatMap((a) => (a.type === 'text' ? [a.text] : [])),
    bold: list.flatMap((a) => (a.type === 'stamp' ? [a.label.toUpperCase()] : [])),
  };
}

export async function drawContext(doc: PDFDocument, texts: { regular?: string[]; bold?: string[] } = {}): Promise<DrawContext> {
  return {
    doc,
    engine: await createTextEngine(doc, texts.regular ?? [], 'regular'),
    bold: await createTextEngine(doc, texts.bold ?? [], 'bold'),
    images: new Map(),
  };
}

/**
 * Produce the final PDF from the document bytes plus the annotation model.
 * `annotationsByPage[i]` holds the annotations for page index i.
 */
export async function exportWithAnnotations(
  bytes: Uint8Array,
  annotationsByPage: Annotation[][],
  opts: ExportOptions = {},
): Promise<Uint8Array> {
  if (annotationsByPage.every((l) => l.length === 0)) return bytes;
  const doc = await load(bytes);
  const ctx = await drawContext(doc, annotationTexts(annotationsByPage.flat()));
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const g = geomOf(page);
    for (const a of annotationsByPage[i] ?? []) {
      const flatten = opts.flatten || (opts.burnRedactions && a.type === 'redact');
      if (!flatten) {
        await writeNativeAnnotation(ctx, page, g, a);
        continue;
      }
      if (a.type === 'redact' && !opts.burnRedactions) continue;
      const { ref } = await buildAppearance(ctx, a, g, { burnRedactions: opts.burnRedactions });
      const name = page.node.newXObject('Annot', ref);
      page.pushOperators(pushGraphicsState(), drawObject(name), popGraphicsState());
    }
  }
  return save(doc);
}

/** Open a document for editing: supported annotations move into the model. */
export async function importForEditing(
  bytes: Uint8Array,
  newId: () => string,
): Promise<{ bytes: Uint8Array; annotations: Annotation[][]; count: number }> {
  const doc = await load(bytes);
  const geoms = doc.getPages().map(geomOf);
  const res = importAnnotations(doc, geoms, newId);
  if (!res.count) return { bytes, annotations: res.annotations, count: 0 };
  return { bytes: await save(doc), annotations: res.annotations, count: res.count };
}

/** Replace pages with full-page images (used for secure redaction). Images are PNG bytes in view orientation. */
export async function replacePagesWithImages(
  bytes: Uint8Array,
  images: { index: number; png: Uint8Array }[],
): Promise<Uint8Array> {
  const doc = await load(bytes);
  for (const { index, png } of images) {
    const old = doc.getPage(index);
    const vs = viewSize(geomOf(old));
    doc.removePage(index);
    const page = doc.insertPage(index, [vs.width, vs.height]);
    const img = await doc.embedPng(png);
    page.drawImage(img, { x: 0, y: 0, width: vs.width, height: vs.height });
  }
  // Strip any per-page annotations (links, widgets) that might leak hidden data on the new pages.
  for (const { index } of images) doc.getPage(index).node.delete(PDFName.of('Annots'));
  return save(doc);
}
