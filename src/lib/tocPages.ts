/** "Build a table of contents from bookmarks": new pages at the start with leader dots, page numbers and links. */
import { PDFArray, PDFName, PDFNull, rgb, type PDFPage } from '@cantoo/pdf-lib';
import { load } from './pdfOps';
import { createTextEngine } from './fonts';
import type { OutlineNode } from './outline';
import type { TextEngine } from './appearance';

export interface TocOptions {
  title: string;
  /** Deepest bookmark level included (1 = top level only). */
  levels: number;
  fontSize: number;
  links: boolean;
}

interface Entry {
  title: string;
  level: number;
  page: number;
  bold: boolean;
}

const MARGIN = 56;

function entriesOf(nodes: OutlineNode[], levels: number, depth = 0, out: Entry[] = []): Entry[] {
  for (const n of nodes) {
    if (n.page !== undefined) out.push({ title: n.title, level: depth, page: n.page, bold: depth === 0 });
    if (depth + 1 < levels) entriesOf(n.children, levels, depth + 1, out);
  }
  return out;
}

/** Shorten `text` with an ellipsis to fit `width`. */
function fit(engine: TextEngine, text: string, size: number, width: number): string {
  if (engine.width(text, size) <= width) return text;
  let t = text;
  while (t.length > 1 && engine.width(t + '…', size) > width) t = t.slice(0, -1);
  return t + '…';
}

function draw(page: PDFPage, engine: TextEngine, text: string, x: number, y: number, size: number, grey = 0) {
  let dx = 0;
  for (const run of engine.runs(text)) {
    page.drawText(run.text, { x: x + dx, y, size, font: run.font, color: rgb(grey, grey, grey) });
    dx += run.font.widthOfTextAtSize(run.text, size);
  }
}

/** Insert the contents pages; returns the new bytes and how many pages were added. */
export async function insertTocPages(bytes: Uint8Array, nodes: OutlineNode[], o: TocOptions): Promise<{ bytes: Uint8Array; count: number }> {
  const doc = await load(bytes);
  const entries = entriesOf(nodes, Math.max(1, o.levels));
  if (!entries.length) throw new Error('There are no bookmarks with a destination to list.');
  const targets = doc.getPages();
  const first = targets[0];
  const size = first ? (() => { const b = first.getMediaBox(); return first.getRotation().angle % 180 ? [b.height, b.width] : [b.width, b.height]; })() : [595.28, 841.89];
  const [w, h] = size;
  const regular = await createTextEngine(doc, entries.filter((e) => !e.bold).map((e) => e.title).concat(['0123456789 .…']));
  const bold = await createTextEngine(doc, [o.title, ...entries.filter((e) => e.bold).map((e) => e.title), '0123456789 .…'], 'bold');
  const line = o.fontSize * 1.6;
  const titleSize = o.fontSize * 1.8;
  const firstTop = h - MARGIN - titleSize * 2;
  const perFirst = Math.max(1, Math.floor((firstTop - MARGIN) / line));
  const perPage = Math.max(1, Math.floor((h - 2 * MARGIN) / line));
  const count = entries.length <= perFirst ? 1 : 1 + Math.ceil((entries.length - perFirst) / perPage);

  const pages: PDFPage[] = [];
  for (let i = 0; i < count; i++) pages.push(doc.insertPage(i, [w, h]));
  draw(pages[0], bold, o.title, MARGIN, h - MARGIN - titleSize, titleSize);

  let k = 0;
  for (let pi = 0; pi < count; pi++) {
    const page = pages[pi];
    let y = pi === 0 ? firstTop : h - MARGIN - o.fontSize;
    const n = pi === 0 ? perFirst : perPage;
    for (let j = 0; j < n && k < entries.length; j++, k++) {
      const e = entries[k];
      const engine = e.bold ? bold : regular;
      const indent = MARGIN + e.level * o.fontSize * 1.5;
      // Printed numbers count the new contents pages too.
      const num = String(e.page + 1 + count);
      const numW = engine.width(num, o.fontSize);
      const right = w - MARGIN;
      const title = fit(engine, e.title, o.fontSize, right - indent - numW - o.fontSize * 2);
      const titleW = engine.width(title, o.fontSize);
      draw(page, engine, title, indent, y, o.fontSize);
      draw(page, engine, num, right - numW, y, o.fontSize);
      // Leader dots between title and number.
      const unit = regular.width(' .', o.fontSize);
      const dots = Math.floor((right - numW - o.fontSize * 0.4 - (indent + titleW + o.fontSize * 0.4)) / unit);
      if (dots > 2) draw(page, regular, ' .'.repeat(dots), right - numW - o.fontSize * 0.4 - dots * unit, y, o.fontSize, 0.55);
      if (o.links && targets[e.page]) {
        const annot = doc.context.obj({
          Type: 'Annot', Subtype: 'Link', Rect: [indent, y - o.fontSize * 0.3, right, y + o.fontSize], Border: [0, 0, 0], F: 4,
          Dest: [targets[e.page].ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull],
        });
        const ref = doc.context.register(annot);
        const annots = page.node.lookup(PDFName.of('Annots'));
        if (annots instanceof PDFArray) annots.push(ref);
        else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
      }
      y -= line;
    }
  }
  return { bytes: await doc.save({ useObjectStreams: true }), count };
}
