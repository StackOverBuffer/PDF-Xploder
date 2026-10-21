import { PDFDocument, PDFHexString, PDFName, PDFRef, PDFString, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { singleFontEngine, wrapLines } from './appearance';
import { SOURCE_URL } from './project';

/** A small multi-page document with text, a form and bookmarks, for trying the editor out. */
export async function createSampleDocument(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('PDF-Xploder sample');
  doc.setAuthor('PDF-Xploder');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sections = [
    {
      title: '1. Welcome',
      body: 'This sample document lets you try PDF-Xploder. Select text with the Highlight, Underline or Strikeout tools to mark it up. Draw with the Pencil, add shapes, arrows and text boxes, drop sticky notes and stamps, or place your signature. Everything you add can be moved, restyled and deleted until you save.',
    },
    {
      title: '2. Organising pages',
      body: 'Use the thumbnails on the left to reorder pages by dragging them. Rotate, duplicate, delete, extract, split or crop pages from the Organize tab, insert blank pages or pages from another PDF, and undo any step with Ctrl+Z. Annotations follow their page wherever it moves.',
    },
    {
      title: '3. Forms and protection',
      body: 'Fill in the form below from the Form fields pane, then apply or flatten it. Mark sensitive content with the Redact tool and apply redactions to permanently remove it: redacted pages are rasterised so no hidden text survives.',
    },
  ];
  const pageRefs: PDFRef[] = [];
  sections.forEach((s, i) => {
    const page = doc.addPage([595.28, 841.89]);
    pageRefs.push(page.ref);
    page.drawRectangle({ x: 0, y: 781.89, width: 595.28, height: 60, color: rgb(0.11, 0.3, 0.6) });
    page.drawText('PDF-Xploder', { x: 50, y: 805, size: 20, font: bold, color: rgb(1, 1, 1) });
    page.drawText(s.title, { x: 50, y: 720, size: 24, font: bold, color: rgb(0.1, 0.1, 0.1) });
    wrapLines(singleFontEngine(font), s.body, 13, 495).forEach((line, k) => page.drawText(line, { x: 50, y: 680 - k * 20, size: 13, font, color: rgb(0.2, 0.2, 0.2) }));
    const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. ';
    wrapLines(singleFontEngine(font), filler.repeat(3), 11, 495).forEach((line, k) => page.drawText(line, { x: 50, y: 520 - k * 16, size: 11, font, color: rgb(0.35, 0.35, 0.35) }));
    page.drawText(`Page ${i + 1} of ${sections.length}`, { x: 260, y: 30, size: 10, font, color: rgb(0.5, 0.5, 0.5) });
  });

  // A small form on the last page.
  const last = doc.getPage(2);
  const form = doc.getForm();
  last.drawText('Name', { x: 50, y: 345, size: 12, font });
  form.createTextField('Name').addToPage(last, { x: 130, y: 338, width: 250, height: 22 });
  last.drawText('Email', { x: 50, y: 305, size: 12, font });
  form.createTextField('Email').addToPage(last, { x: 130, y: 298, width: 250, height: 22 });
  last.drawText('Plan', { x: 50, y: 265, size: 12, font });
  const plan = form.createDropdown('Plan');
  plan.addOptions(['Free', 'Pro', 'Enterprise']);
  plan.addToPage(last, { x: 130, y: 258, width: 150, height: 22 });
  last.drawText('I agree to the terms', { x: 160, y: 225, size: 12, font });
  form.createCheckBox('Agree').addToPage(last, { x: 130, y: 222, width: 16, height: 16 });

  // Links: one to the form on page 3, one to a web page.
  const first = doc.getPage(0);
  const link = (x: number, y: number, label: string, target: Record<string, unknown>) => {
    const w = font.widthOfTextAtSize(label, 12);
    first.drawText(label, { x, y, size: 12, font, color: rgb(0.1, 0.37, 0.71) });
    first.drawLine({ start: { x, y: y - 2 }, end: { x: x + w, y: y - 2 }, thickness: 0.6, color: rgb(0.1, 0.37, 0.71) });
    first.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, y - 4, x + w, y + 12], Border: [0, 0, 0], ...target } as never)));
  };
  link(50, 570, 'Jump to the form on page 3', { Dest: [pageRefs[2], 'XYZ', null, 380, null] });
  link(260, 570, 'Project on GitHub', { A: { Type: 'Action', S: 'URI', URI: PDFString.of(SOURCE_URL) } });

  // Bookmarks (pdf-lib has no high-level outline API, so build the dictionaries directly).
  const ctx = doc.context;
  const outlineRef = ctx.nextRef();
  const itemRefs = sections.map(() => ctx.nextRef());
  sections.forEach((s, i) => {
    const item = ctx.obj({
      Title: PDFHexString.fromText(s.title),
      Parent: outlineRef,
      Dest: [pageRefs[i], 'XYZ', null, 760, null],
    });
    if (i > 0) item.set(PDFName.of('Prev'), itemRefs[i - 1]);
    if (i < sections.length - 1) item.set(PDFName.of('Next'), itemRefs[i + 1]);
    ctx.assign(itemRefs[i], item);
  });
  ctx.assign(outlineRef, ctx.obj({ Type: 'Outlines', First: itemRefs[0], Last: itemRefs[itemRefs.length - 1], Count: sections.length }));
  doc.catalog.set(PDFName.of('Outlines'), outlineRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));

  return doc.save();
}
