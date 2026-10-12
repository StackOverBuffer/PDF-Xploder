/**
 * Document-level operations implemented with pdf-lib. Every function takes the
 * current PDF bytes and returns new bytes, so the store can keep immutable
 * snapshots for undo/redo. Nothing here touches the DOM, so it is unit-testable.
 */
import {
  BlendMode,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFPage,
  PDFRadioGroup,
  PDFString,
  PDFTextField,
  StandardFonts,
  degrees,
  LineCapStyle,
} from 'pdf-lib';
import { hexToRgb, hexToRgbTuple } from './color';
import { frameGeom, normRot, pdfRectToView, viewRectToPdf, viewSize, viewToPdf, pdfToView, type VRect } from './geometry';
import type { Annotation, PageGeom, Pt } from './types';
import { NOTE_SIZE } from './types';

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

/** Replace characters the standard font cannot encode, so drawText never throws. */
export function sanitize(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  return [...text].map((ch) => (ch === '\n' || supported.has(ch.codePointAt(0)!) ? ch : '?')).join('');
}

/** Greedy word wrap, honouring explicit newlines. */
export function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const candidate = line + w;
      if (line && font.widthOfTextAtSize(candidate.trimEnd(), size) > maxWidth) {
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

interface UprightOpts {
  font: PDFFont;
  size: number;
  color: string;
  opacity?: number;
}

/** Draw a line of text that reads upright in the *displayed* (rotated) page orientation. */
function drawUprightText(page: PDFPage, g: PageGeom, text: string, at: Pt, o: UprightOpts, extraRotate = 0) {
  const origin = viewToPdf(g, at);
  page.drawText(text, {
    x: origin.x,
    y: origin.y,
    size: o.size,
    font: o.font,
    color: hexToRgb(o.color),
    opacity: o.opacity ?? 1,
    rotate: degrees(normRot(g.rotation) + extraRotate),
  });
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
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = sanitize(font, o.text);
  for (const page of pickPages(doc, o.pages)) {
    const g = geomOf(page);
    const vs = viewSize(g);
    const tw = font.widthOfTextAtSize(text, o.fontSize);
    const th = font.heightAtSize(o.fontSize, { descender: false });
    // Centre the text: start from the centre and back off half the text box along the rotated axes.
    const a = (o.angle * Math.PI) / 180;
    const cx = vs.width / 2;
    const cy = vs.height / 2;
    // In view space (y down) the baseline runs along (cos a, -sin a) and "up" is (-sin a, -cos a).
    const at = {
      x: cx - (Math.cos(a) * tw) / 2 + (Math.sin(a) * th) / 2,
      y: cy + (Math.sin(a) * tw) / 2 + (Math.cos(a) * th) / 2,
    };
    drawUprightText(page, g, text, at, { font, size: o.fontSize, color: o.color, opacity: o.opacity }, o.angle);
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
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const all = doc.getPages();
  const title = doc.getTitle() ?? '';
  for (const page of pickPages(doc, o.pages)) {
    const idx = all.indexOf(page);
    const text = sanitize(font, formatHeaderFooter(o, idx, all.length, title));
    const g = geomOf(page);
    const vs = viewSize(g);
    const tw = font.widthOfTextAtSize(text, o.fontSize);
    const [vert, horiz] = o.position.split('-');
    const x = horiz === 'left' ? o.margin : horiz === 'right' ? vs.width - o.margin - tw : (vs.width - tw) / 2;
    const y = vert === 'top' ? o.margin + o.fontSize : vs.height - o.margin;
    drawUprightText(page, g, text, { x, y }, { font, size: o.fontSize, color: o.color });
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
  if (opts.flatten) form.flatten();
  return save(doc);
}

// ---------------------------------------------------------------- export annotations

function dataUrlBytes(src: string): { bytes: Uint8Array; png: boolean } {
  const [head, data] = src.split(',');
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { bytes: out, png: head.includes('image/png') };
}

function drawViewLine(page: PDFPage, g: PageGeom, a: Pt, b: Pt, color: string, width: number, opacity: number) {
  page.drawLine({
    start: viewToPdf(g, a),
    end: viewToPdf(g, b),
    thickness: width,
    color: hexToRgb(color),
    opacity,
    lineCap: LineCapStyle.Round,
  });
}

function addNoteAnnotation(doc: PDFDocument, page: PDFPage, g: PageGeom, a: Extract<Annotation, { type: 'note' }>) {
  const v = pdfToView(g, a.at);
  const r = viewRectToPdf(g, { left: v.x, top: v.y, width: NOTE_SIZE, height: NOTE_SIZE });
  // An appearance stream makes the icon render in every viewer, not only those with built-in icons.
  const [cr, cg, cb] = hexToRgbTuple(a.color);
  const icon = [
    `${cr} ${cg} ${cb} rg 0.36 0.25 0.22 RG 1 w`,
    '1.5 19 m 18.5 19 l 18.5 6 l 7 6 l 2.5 1.5 l 2.5 6 l 1.5 6 l h B',
    '5 14.5 m 15 14.5 l S 5 10.5 m 12 10.5 l S',
  ].join('\n');
  const ap = doc.context.register(
    doc.context.stream(icon, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, NOTE_SIZE, NOTE_SIZE] }),
  );
  const dict = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    AP: { N: ap },
    Rect: [r.x, r.y, r.x + r.w, r.y + r.h],
    Contents: PDFHexString.fromText(a.text),
    T: PDFHexString.fromText(a.author),
    M: PDFString.fromDate(new Date(a.createdAt)),
    C: hexToRgbTuple(a.color),
    Name: 'Comment',
    F: 4 | 8 | 16, // Print, NoZoom, NoRotate

    Open: false,
  });
  page.node.addAnnot(doc.context.register(dict));
}

/** Draw one annotation onto a page. Notes become real (non-flattened) PDF text annotations. */
async function drawAnnotation(doc: PDFDocument, page: PDFPage, a: Annotation, font: PDFFont) {
  const g = geomOf(page);
  const op = a.opacity;
  switch (a.type) {
    case 'highlight':
      for (const r of a.rects) {
        page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: hexToRgb(a.color), opacity: op, blendMode: BlendMode.Multiply });
      }
      break;
    case 'underline':
    case 'strikeout':
      for (const r of a.rects) {
        const fg = frameGeom(g, a.rot);
        const v = pdfRectToView(fg, r);
        const y = a.type === 'underline' ? v.top + v.height * 0.94 : v.top + v.height * 0.55;
        const w = Math.max(0.8, v.height * 0.07);
        drawViewLine(page, fg, { x: v.left, y }, { x: v.left + v.width, y }, a.color, w, op);
      }
      break;
    case 'ink':
      for (const path of a.paths) {
        if (path.length === 1) {
          page.drawCircle({ x: path[0].x, y: path[0].y, size: a.width / 2, color: hexToRgb(a.color), opacity: op });
        }
        for (let i = 1; i < path.length; i++) {
          page.drawLine({ start: path[i - 1], end: path[i], thickness: a.width, color: hexToRgb(a.color), opacity: op, lineCap: LineCapStyle.Round });
        }
      }
      break;
    case 'rect':
      page.drawRectangle({
        x: a.rect.x, y: a.rect.y, width: a.rect.w, height: a.rect.h,
        borderColor: hexToRgb(a.color), borderWidth: a.width, borderOpacity: op,
        color: a.fill ? hexToRgb(a.fill) : undefined, opacity: op,
      });
      break;
    case 'ellipse':
      page.drawEllipse({
        x: a.rect.x + a.rect.w / 2, y: a.rect.y + a.rect.h / 2, xScale: a.rect.w / 2, yScale: a.rect.h / 2,
        borderColor: hexToRgb(a.color), borderWidth: a.width, borderOpacity: op,
        color: a.fill ? hexToRgb(a.fill) : undefined, opacity: op,
      });
      break;
    case 'line':
    case 'arrow': {
      page.drawLine({ start: a.p1, end: a.p2, thickness: a.width, color: hexToRgb(a.color), opacity: op, lineCap: LineCapStyle.Round });
      if (a.type === 'arrow') {
        const ang = Math.atan2(a.p2.y - a.p1.y, a.p2.x - a.p1.x);
        const len = Math.max(8, a.width * 4);
        for (const s of [-1, 1]) {
          const t = ang + Math.PI + s * (Math.PI / 7);
          page.drawLine({
            start: a.p2,
            end: { x: a.p2.x + Math.cos(t) * len, y: a.p2.y + Math.sin(t) * len },
            thickness: a.width, color: hexToRgb(a.color), opacity: op, lineCap: LineCapStyle.Round,
          });
        }
      }
      break;
    }
    case 'text': {
      const fg = frameGeom(g, a.rot);
      const v = pdfRectToView(fg, a.rect);
      if (a.border) {
        page.drawRectangle({ x: a.rect.x, y: a.rect.y, width: a.rect.w, height: a.rect.h, borderColor: hexToRgb(a.color), borderWidth: 1, borderOpacity: op });
      }
      const pad = 4;
      const lines = wrapText(font, sanitize(font, a.text), a.fontSize, v.width - pad * 2);
      const lh = a.fontSize * 1.2;
      lines.forEach((line, i) => {
        if (!line) return;
        const baseline = v.top + pad + a.fontSize * 0.9 + i * lh;
        drawUprightText(page, fg, line, { x: v.left + pad, y: baseline }, { font, size: a.fontSize, color: a.color, opacity: op });
      });
      break;
    }
    case 'stamp': {
      const fg = frameGeom(g, a.rot);
      const v = pdfRectToView(fg, a.rect);
      page.drawRectangle({ x: a.rect.x, y: a.rect.y, width: a.rect.w, height: a.rect.h, borderColor: hexToRgb(a.color), borderWidth: 3, borderOpacity: op });
      const label = sanitize(font, a.label.toUpperCase());
      let size = v.height * 0.55;
      const tw = font.widthOfTextAtSize(label, size);
      if (tw > v.width * 0.9) size *= (v.width * 0.9) / tw;
      const w = font.widthOfTextAtSize(label, size);
      drawUprightText(page, fg, label, { x: v.left + (v.width - w) / 2, y: v.top + v.height / 2 + size * 0.35 }, { font, size, color: a.color, opacity: op });
      break;
    }
    case 'image': {
      const { bytes, png } = dataUrlBytes(a.src);
      const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const fg = frameGeom(g, a.rot);
      const v = pdfRectToView(fg, a.rect);
      const origin = viewToPdf(fg, { x: v.left, y: v.top + v.height });
      page.drawImage(img, { x: origin.x, y: origin.y, width: v.width, height: v.height, rotate: degrees(fg.rotation), opacity: op });
      break;
    }
    case 'redact':
      page.drawRectangle({ x: a.rect.x, y: a.rect.y, width: a.rect.w, height: a.rect.h, color: hexToRgb('#000000') });
      break;
    case 'note':
      addNoteAnnotation(doc, page, g, a);
      break;
  }
}

/**
 * Produce the final PDF: draws (flattens) every annotation into page content.
 * `annotationsByPage[i]` holds the annotations for page index i.
 */
export async function exportWithAnnotations(
  bytes: Uint8Array,
  annotationsByPage: Annotation[][],
  opts: { includeRedactions?: boolean } = {},
): Promise<Uint8Array> {
  if (annotationsByPage.every((l) => l.length === 0)) return bytes;
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    for (const a of annotationsByPage[i] ?? []) {
      if (a.type === 'redact' && !opts.includeRedactions) continue;
      await drawAnnotation(doc, pages[i], a, a.type === 'stamp' ? bold : font);
    }
  }
  return save(doc);
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
