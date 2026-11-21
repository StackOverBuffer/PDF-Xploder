/**
 * Document-level operations implemented with pdf-lib. Every function takes the
 * current PDF bytes and returns new bytes, so the store can keep immutable
 * snapshots for undo/redo. Nothing here touches the DOM, so it is unit-testable.
 */
import {
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFPage,
  PDFRadioGroup,
  PDFRef,
  PDFTextField,
  type PDFField,
  degrees,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from '@cantoo/pdf-lib';
import { hexToRgb } from './color';
import { normRot, viewRectToPdf, viewSize, viewToPdf, type VRect } from './geometry';
import type { Annotation, PageGeom, Pt } from './types';
import { buildAppearance, type DrawContext, type TextEngine } from './appearance';
import { createTextEngine, fontCovering, loadFontBytes, loadFontkit, type FontKey } from './fonts';
import { subsetFont } from './subset';
import { importAnnotations, writeNativeAnnotation } from './annotIO';
import { copyPages } from './pageCopy';

export async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return loadForEdit(bytes);
}

/**
 * Copy pages into `dest` without the pages they refer to: see pageCopy.ts. The fields of
 * copied form widgets are registered in `dest`'s form, links to pages left behind are cut.
 */
export { copyPages };
import { clearSignatures } from './staleSignatures';

/** A rewritten signed document: its signatures, which no longer match, become empty fields. */
export async function dropStaleSignatures(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await load(bytes);
  return clearSignatures(doc) ? save(doc) : bytes;
}

async function save(doc: PDFDocument): Promise<Uint8Array> {
  return saveDoc(doc);
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
    // As displayed: a rotated landscape page gets a landscape blank page next to it.
    const { width, height } = viewSize(geomOf(ref));
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
  // Rebuild the page tree as a single flat node. Attributes pages inherit from
  // intermediate nodes are copied onto each page first so nothing is lost.
  const rootRef = doc.catalog.get(PDFName.of('Pages')) as PDFRef;
  const root = doc.context.lookup(rootRef, PDFDict);
  for (const page of pages) {
    for (const key of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
      const name = PDFName.of(key);
      const v = page.node.getInheritableAttribute(name);
      if (v && !page.node.get(name)) page.node.set(name, v);
    }
    page.node.set(PDFName.of('Parent'), rootRef);
  }
  root.set(PDFName.of('Kids'), doc.context.obj(order.map((i) => pages[i].ref)));
  root.set(PDFName.of('Count'), doc.context.obj(pages.length));
  return save(doc);
}

export async function duplicatePages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  // One copy operation, so resources the pages share (fonts, images) are copied once.
  const copies = await copyPages(doc, doc, sorted);
  for (let k = sorted.length - 1; k >= 0; k--) doc.insertPage(sorted[k] + 1, copies[k]);
  return save(doc);
}

/** The given pages as a new file. Pass a loaded document to extract several parts without re-parsing. */
export async function extractPages(source: Uint8Array | PDFDocument, indices: number[]): Promise<Uint8Array> {
  const src = source instanceof Uint8Array ? await load(source) : source;
  const out = await PDFDocument.create();
  const pages = await copyPages(out, src, indices);
  pages.forEach((p) => out.addPage(p));
  return save(out);
}

export interface InsertBookmark {
  /** Title of the bookmark for the inserted file (its file name). */
  title: string;
  /** Title of a bookmark for the document's own pages, added if it had no bookmarks yet. */
  currentTitle?: string;
}

/**
 * Insert every page of `other` before position `at` (use page count to append). With
 * `bookmark`, the inserted pages get a bookmark with the file's own bookmarks under it.
 */
export async function insertDocument(bytes: Uint8Array, other: Uint8Array, at: number, bookmark?: InsertBookmark): Promise<{ bytes: Uint8Array; count: number }> {
  const doc = await load(bytes);
  const src = await load(other);
  const own = bookmark ? outlineOf(src) : [];
  const pages = await copyPages(doc, src, src.getPageIndices());
  pages.forEach((p, i) => doc.insertPage(at + i, p));
  if (bookmark && pages.length) addInsertedFileBookmark(doc, { ...bookmark, at, count: pages.length, children: copiedOutline(own, at) });
  return { bytes: await save(doc), count: pages.length };
}

export async function splitEvery(bytes: Uint8Array, n: number): Promise<Uint8Array[]> {
  const src = await load(bytes);
  const count = src.getPageCount();
  const parts: Uint8Array[] = [];
  for (let start = 0; start < count; start += n) {
    const idx = Array.from({ length: Math.min(n, count - start) }, (_, k) => start + k);
    parts.push(await extractPages(src, idx));
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

export { getFormFields, type FieldInfo } from './forms';
import type { FieldValue } from './forms';
import { saveDoc } from './pdfSave';
import { addInsertedFileBookmark, copiedOutline, outlineOf } from './outline';
import { loadForEdit } from './pageTree';
export type { FieldValue };

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
      doc.registerFontkit(await loadFontkit());
      // Not subset while the fields stay fillable: the font must contain every glyph a
      // later edit may need. A flattened form keeps only the glyphs it shows.
      let sansBytes = fontBytes;
      if (opts.flatten) {
        const shown = form.getFields().flatMap((f) => (f instanceof PDFTextField ? [f.getText() ?? ''] : f instanceof PDFDropdown || f instanceof PDFOptionList ? f.getSelected() : []));
        try {
          sansBytes = await subsetFont(fontBytes, new Set([...shown.join(''), ' ', '?'].map((c) => c.codePointAt(0)!)));
        } catch {
          /* the whole font */
        }
      }
      form.updateFieldAppearances(await doc.embedFont(sansBytes, { subset: false }));
      // Values Noto Sans cannot show (✓, Chinese, Japanese, Korean…) get the first font
      // that has all their characters, cut down to the characters of the values using it.
      const byFont = new Map<FontKey, { bytes: Uint8Array; fields: PDFField[]; text: string }>();
      for (const [name, value] of Object.entries(values)) {
        const text = [value].flat().filter((x): x is string => typeof x === 'string').join('');
        const field = form.getFieldMaybe(name);
        if (!text || !(field instanceof PDFTextField || field instanceof PDFDropdown || field instanceof PDFOptionList)) continue;
        const pick = await fontCovering(text);
        if (!pick || pick.key === 'sans') continue;
        const e = byFont.get(pick.key) ?? byFont.set(pick.key, { bytes: pick.bytes, fields: [], text: '' }).get(pick.key)!;
        e.fields.push(field);
        e.text += text;
      }
      for (const { bytes, fields, text } of byFont.values()) {
        let sub = bytes;
        try {
          sub = await subsetFont(bytes, new Set([...text, ' ', '?'].map((c) => c.codePointAt(0)!)));
        } catch {
          /* the whole font */
        }
        const font = await doc.embedFont(sub, { subset: false });
        for (const f of fields) (f as PDFTextField).updateAppearances(font);
      }
    }
  }
  if (opts.flatten) form.flatten();
  return save(doc);
}

/** Paint form fields into the page content (their current appearances), e.g. for N-up printing. */
export async function flattenFormFields(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await load(bytes);
  const form = doc.getForm();
  if (!form.getFields().length) return bytes;
  form.flatten({ updateFieldAppearances: false });
  return save(doc);
}

// ---------------------------------------------------------------- export annotations

export interface ExportOptions {
  /** Paint annotations into the page content instead of writing editable PDF annotations. */
  flatten?: boolean;
  /** Burn redaction marks in as solid black (only used when applying redactions). */
  burnRedactions?: boolean;
  /** The acting user, written as the /T of the review status annotations (see annotIO). */
  author?: string;
  /** false: annotations get only standard keys, no private model (after Sanitize). */
  privateData?: boolean;
}

/** Text drawn by an annotation, used to decide which fonts to embed. */
function annotationTexts(list: Annotation[]): { regular: string[]; bold: string[] } {
  return {
    regular: list.flatMap((a) => (a.type === 'text' ? [a.text] : 'measure' in a && a.measure ? ['0123456789.,  mmcmkminftydmi²'] : [])),
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
        await writeNativeAnnotation(ctx, page, g, a, { author: opts.author, privateData: opts.privateData });
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
let importSeq = 0;
export async function importForEditing(
  bytes: Uint8Array,
  // Without one (in the worker), ids are numbered; the caller gives them its own.
  newId: () => string = () => `imported-${++importSeq}`,
): Promise<{ bytes: Uint8Array; annotations: Annotation[][]; count: number }> {
  const doc = await load(bytes);
  const geoms = doc.getPages().map(geomOf);
  const res = await importAnnotations(doc, geoms, newId);
  if (!res.count) return { bytes, annotations: res.annotations, count: 0 };
  return { bytes: await save(doc), annotations: res.annotations, count: res.count };
}

/** Replace pages with full-page images (used for secure redaction). Images are PNG bytes in view orientation. */
export async function replacePagesWithImages(
  bytes: Uint8Array,
  images: { index: number; png: Uint8Array }[],
): Promise<{ bytes: Uint8Array; removedFields: string[] }> {
  const doc = await load(bytes);
  const redacted = new Set(images.map(({ index }) => doc.getPage(index).ref.toString()));
  const onRedactedPage = (w: { P(): PDFRef | undefined; dict: PDFDict }) => {
    const p = w.P();
    if (p && redacted.has(p.toString())) return true;
    // Widgets without /P: look them up in the pages' annotation arrays.
    const ref = doc.context.getObjectRef(w.dict);
    return images.some(({ index }) => !!doc.getPage(index).node.Annots()?.asArray().some((a) => a === ref));
  };
  // A field whose every widget is on a redacted page goes entirely: its value would survive
  // in the form data although the page is now an image. A field that also shows on other
  // pages keeps its value (it is visible there anyway) and loses only those widgets.
  const removedFields: string[] = [];
  const form = doc.getForm();
  for (const field of form.getFields()) {
    const widgets = field.acroField.getWidgets();
    const hit = widgets.map(onRedactedPage);
    if (!hit.some(Boolean)) continue;
    if (hit.every(Boolean)) {
      removedFields.push(field.getName());
      form.removeField(field);
    } else {
      for (let k = widgets.length - 1; k >= 0; k--) if (hit[k]) field.acroField.removeWidget(k);
    }
  }
  for (const { index, png } of images) {
    const page = doc.getPage(index);
    const vs = viewSize(geomOf(page));
    // The same page object with new content, so bookmarks, links and named destinations
    // that point at the page keep working. Every other entry goes: thumbnails, actions,
    // piece info and the annotations (links, widgets) could all leak what was on it.
    const node = page.node;
    for (const [key] of node.entries()) if (key !== PDFName.of('Type') && key !== PDFName.of('Parent')) node.delete(key);
    node.set(PDFName.of('MediaBox'), doc.context.obj([0, 0, vs.width, vs.height]));
    // Its own resources: inherited ones are shared with other pages.
    node.set(PDFName.of('Resources'), doc.context.obj({}));
    // pdf-lib remembers the old content stream and normalisation per page: start afresh.
    (node as unknown as { normalized: boolean }).normalized = false;
    Object.assign(page as unknown as Record<string, unknown>, { contentStream: undefined, contentStreamRef: undefined });
    const img = await doc.embedPng(png);
    page.drawImage(img, { x: 0, y: 0, width: vs.width, height: vs.height });
  }
  return { bytes: await save(doc), removedFields };
}
