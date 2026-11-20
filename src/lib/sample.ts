import { PDFDocument, PDFFont, PDFName, PDFPage, PDFString, StandardFonts, rgb, type Color } from '@cantoo/pdf-lib';
import { singleFontEngine, wrapLines } from './appearance';
import { writeNativeAnnotation } from './annotIO';
import type { Lang } from './i18n';
import { paperScale } from './measure';
import { setOutline, type OutlineNode } from './outline';
import { drawContext, geomOf } from './pdfOps';
import { SOURCE_URL } from './project';
import { SAMPLE_TEXT, type SampleText } from './sampleText';
import type { Annotation, Rect } from './types';

/** Reads a file of the sample (the scanned receipts in public/sample/). */
export type SampleAssetLoader = (name: string) => Promise<Uint8Array>;

const fetchAsset: SampleAssetLoader = async (name) => {
  const res = await fetch(`${import.meta.env.BASE_URL}sample/${name}`);
  if (!res.ok) throw new Error(`Could not load ${name} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
};

const A4: [number, number] = [595.28, 841.89];
const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
const MARGIN = 56;

// A workshop's palette: dark green ink, one rust accent, warm greys. No gradients.
const C = {
  ink: rgb(0.13, 0.16, 0.14),
  text: rgb(0.2, 0.22, 0.21),
  green: rgb(0.17, 0.35, 0.26),
  rust: rgb(0.74, 0.33, 0.14),
  grey: rgb(0.45, 0.46, 0.44),
  rule: rgb(0.8, 0.79, 0.75),
  tint: rgb(0.95, 0.94, 0.91),
  white: rgb(1, 1, 1),
};

interface Fonts {
  sans: PDFFont;
  sansBold: PDFFont;
  serif: PDFFont;
  serifBold: PDFFont;
  serifItalic: PDFFont;
  mono: PDFFont;
}

interface Line {
  text: string;
  x: number;
  y: number;
}

interface TextStyle {
  font: PDFFont;
  size: number;
  color?: Color;
}

function text(page: PDFPage, s: string, x: number, y: number, st: TextStyle) {
  page.drawText(s, { x, y, size: st.size, font: st.font, color: st.color ?? C.text });
}

function rightText(page: PDFPage, s: string, right: number, y: number, st: TextStyle) {
  text(page, s, right - st.font.widthOfTextAtSize(s, st.size), y, st);
}

/** Wrapped text from (x, y) down; returns the lines drawn and the baseline below the last one. */
function para(page: PDFPage, s: string, x: number, y: number, width: number, st: TextStyle & { leading: number }): { lines: Line[]; y: number } {
  const lines = wrapLines(singleFontEngine(st.font), s, st.size, width).map((t, i) => ({ text: t.trimEnd(), x, y: y - i * st.leading }));
  for (const l of lines) text(page, l.text, l.x, l.y, st);
  return { lines, y: y - lines.length * st.leading };
}

/** Where `phrase` sits in wrapped lines, one rectangle per line it covers (for text markup). */
function phraseRects(lines: Line[], phrase: string, st: TextStyle): Rect[] {
  const joined = lines.map((l) => l.text).join(' ');
  const start = joined.indexOf(phrase);
  if (start < 0) return [];
  const end = start + phrase.length;
  const rects: Rect[] = [];
  let offset = 0;
  for (const l of lines) {
    const a = Math.max(start, offset) - offset;
    const b = Math.min(end, offset + l.text.length) - offset;
    if (b > a) {
      const x = l.x + st.font.widthOfTextAtSize(l.text.slice(0, a), st.size);
      const w = st.font.widthOfTextAtSize(l.text.slice(a, b), st.size);
      rects.push({ x, y: l.y - st.size * 0.24, w, h: st.size * 1.18 });
    }
    offset += l.text.length + 1;
  }
  return rects;
}

function rule(page: PDFPage, x1: number, x2: number, y: number, color = C.rule, thickness = 0.75) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
}

function footer(page: PDFPage, f: Fonts, t: SampleText, n: number, total: number) {
  const { width } = page.getSize();
  rightText(page, t.pageOf(n, total), width - MARGIN, 32, { font: f.sans, size: 8.5, color: C.grey });
}

/** The workshop's mark: a bicycle in two circles and a few strokes, drawn as vector art. */
function logo(page: PDFPage, x: number, y: number, color: Color) {
  const r = 8.5;
  page.drawCircle({ x, y, size: r, borderColor: color, borderWidth: 1.6 });
  page.drawCircle({ x: x + 30, y, size: r, borderColor: color, borderWidth: 1.6 });
  // SVG paths run y-down, so "up" is negative here.
  const path = 'M 0 0 L 10 -14 L 24 -14 L 30 0 M 10 -14 L 15 0 L 24 -14 M 8 -18 L 13 -18 M 24 -14 L 22 -19 L 27 -19';
  page.drawSvgPath(path, { x, y, borderColor: color, borderWidth: 1.6, scale: 1 });
}

function letterhead(page: PDFPage, f: Fonts, t: SampleText) {
  const { width, height } = page.getSize();
  logo(page, MARGIN + 9, height - 60, C.green);
  text(page, t.workshop, MARGIN + 54, height - 64, { font: f.serifBold, size: 17, color: C.green });
  text(page, t.addressLine, MARGIN, height - 86, { font: f.sans, size: 8.5, color: C.grey });
  rule(page, MARGIN, width - MARGIN, height - 98, C.green, 1.2);
}

const at = (iso: string) => Date.parse(iso);

/** Creates the sample document: a made-up repair order from a bike workshop, one feature to try per page. */
export async function createSampleDocument(lang: Lang = 'en', loadAsset: SampleAssetLoader = fetchAsset): Promise<Uint8Array> {
  const t = SAMPLE_TEXT[lang];
  const doc = await PDFDocument.create();
  const f: Fonts = {
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansBold: await doc.embedFont(StandardFonts.HelveticaBold),
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifBold: await doc.embedFont(StandardFonts.TimesRomanBold),
    serifItalic: await doc.embedFont(StandardFonts.TimesRomanItalic),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  const created = new Date(at('2026-11-13T09:30:00Z'));
  doc.setTitle(t.docTitle, { showInWindowTitleBar: true });
  doc.setAuthor(t.workshop);
  doc.setSubject(t.docSubject);
  doc.setKeywords(t.keywords);
  doc.setCreator('PDF-Xploder');
  doc.setLanguage(lang === 'de' ? 'de-DE' : 'en-GB');
  doc.setCreationDate(created);
  doc.setModificationDate(created);

  const TOTAL = 7;
  const pages = [A4, A4, A4, A4, A4_LANDSCAPE, A4, A4].map((size) => doc.addPage(size));
  const [start, letter, estimate, booking, plan, scan, record] = pages;
  const annots: { page: PDFPage; a: Annotation }[] = [];

  // ── Page 1: start here ────────────────────────────────────────────────────
  {
    const page = start;
    const { width, height } = page.getSize();
    page.drawRectangle({ x: 0, y: height - 10, width, height: 10, color: C.green });
    text(page, t.kicker.toUpperCase(), MARGIN, height - 66, { font: f.sansBold, size: 9, color: C.rust });
    let y = para(page, t.title, MARGIN, height - 100, width - 2 * MARGIN, { font: f.serifBold, size: 28, color: C.ink, leading: 32 }).y;
    y = para(page, t.intro, MARGIN, y - 8, width - 2 * MARGIN - 40, { font: f.sans, size: 11.5, leading: 17 }).y;

    y -= 22;
    text(page, t.tourHeading, MARGIN, y, { font: f.serifBold, size: 15, color: C.ink });
    y -= 14;
    rule(page, MARGIN, width - MARGIN, y);
    t.tour.forEach((row, i) => {
      const top = y;
      const pageNo = String(i + 2);
      text(page, pageNo, MARGIN + 2, top - 26, { font: f.serifBold, size: 22, color: C.green });
      text(page, row.title, MARGIN + 40, top - 20, { font: f.sansBold, size: 11.5, color: C.ink });
      const body = para(page, row.text, MARGIN + 40, top - 37, width - 2 * MARGIN - 40, { font: f.sans, size: 10, leading: 14.5 });
      y = body.y - 8;
      rule(page, MARGIN, width - MARGIN, y);
      // The whole row jumps to its page.
      page.node.addAnnot(
        doc.context.register(
          doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [MARGIN, y, width - MARGIN, top], Border: [0, 0, 0], Dest: [pages[i + 1].ref, 'XYZ', null, pages[i + 1].getHeight(), null] } as never),
        ),
      );
    });

    y -= 30;
    text(page, t.alsoHeading, MARGIN, y, { font: f.serifBold, size: 13, color: C.ink });
    y = para(page, t.also, MARGIN, y - 18, width - 2 * MARGIN - 40, { font: f.sans, size: 10, leading: 14.5 }).y;

    // Source link at the bottom.
    const label = SOURCE_URL.replace(/^https:\/\//, '');
    const st = { font: f.sans, size: 9 };
    text(page, t.footer, MARGIN, 52, { ...st, color: C.grey });
    const lx = MARGIN + f.sans.widthOfTextAtSize(`${t.footer} `, 9);
    text(page, label, lx, 52, { ...st, color: C.green });
    const lw = f.sans.widthOfTextAtSize(label, 9);
    rule(page, lx, lx + lw, 50, C.green, 0.5);
    page.node.addAnnot(
      doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [lx, 47, lx + lw, 61], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(SOURCE_URL) } } as never)),
    );
    footer(page, f, t, 1, TOTAL);
  }

  // ── Page 2: letter ────────────────────────────────────────────────────────
  {
    const page = letter;
    const { width, height } = page.getSize();
    letterhead(page, f, t);
    text(page, t.senderLine, MARGIN, height - 150, { font: f.sans, size: 7.5, color: C.grey });
    rule(page, MARGIN, MARGIN + f.sans.widthOfTextAtSize(t.senderLine, 7.5), height - 153, C.rule, 0.5);
    t.recipient.forEach((l, i) => text(page, l, MARGIN, height - 172 - i * 15, { font: f.serif, size: 12, color: C.ink }));
    rightText(page, t.date, width - MARGIN, height - 250, { font: f.serif, size: 12 });
    text(page, t.subject, MARGIN, height - 290, { font: f.serifBold, size: 13, color: C.ink });

    const body = { font: f.serif, size: 12, leading: 17, color: C.text };
    let y = height - 325;
    for (const [i, p] of t.letter.entries()) {
      const out = para(page, p, MARGIN, y, width - 2 * MARGIN, body);
      if (i === 1) {
        annots.push({
          page,
          a: {
            id: 'sample-highlight',
            type: 'highlight',
            rects: phraseRects(out.lines, t.highlight, body),
            text: t.highlight,
            color: '#ffeb3b',
            opacity: 0.45,
            author: 'Mara Kowalski',
            createdAt: at('2026-11-13T10:05:00Z'),
            comment: t.comments.highlight,
          },
        });
      }
      y = out.y - 9;
    }
    y -= 10;
    text(page, t.closing, MARGIN, y, body);
    // A handwritten-looking initial, then the typed name.
    page.drawSvgPath('M 0 0 C 6 -16 10 -24 14 -12 C 18 -2 20 4 26 -8 C 30 -18 34 -4 40 -2 C 48 0 56 -12 74 -6', {
      x: MARGIN + 2,
      y: y - 26,
      borderColor: rgb(0.12, 0.2, 0.45),
      borderWidth: 1.3,
    });
    text(page, t.signer[0], MARGIN, y - 58, { font: f.serif, size: 12, color: C.ink });
    text(page, t.signer[1], MARGIN, y - 73, { font: f.serifItalic, size: 11, color: C.grey });

    annots.push({
      page,
      a: { id: 'sample-note', type: 'note', at: { x: width - MARGIN - 4, y: height - 222 }, text: t.comments.note, color: '#fbc02d', opacity: 1, author: 'Theo Brandner', createdAt: at('2026-11-13T09:50:00Z') },
    });
    footer(page, f, t, 2, TOTAL);
  }

  // ── Page 3: estimate ──────────────────────────────────────────────────────
  {
    const page = estimate;
    const { width, height } = page.getSize();
    letterhead(page, f, t);
    text(page, t.estimateTitle, MARGIN, height - 150, { font: f.serifBold, size: 22, color: C.ink });
    t.estimateFor.forEach((l, i) => text(page, l, MARGIN, height - 176 - i * 15, { font: f.sans, size: 10, color: i === 2 ? C.grey : C.text }));

    const right = width - MARGIN;
    const col = { no: MARGIN + 4, what: MARGIN + 38, qty: right - 190, unit: right - 92, amount: right - 4 };
    let y = height - 250;
    page.drawRectangle({ x: MARGIN, y: y - 7, width: right - MARGIN, height: 22, color: C.tint });
    const head = { font: f.sansBold, size: 9, color: C.ink };
    text(page, t.columns[0], col.no, y, head);
    text(page, t.columns[1], col.what, y, head);
    rightText(page, t.columns[2], col.qty, y, head);
    rightText(page, t.columns[3], col.unit, y, head);
    rightText(page, t.columns[4], col.amount, y, head);
    y -= 30;
    const cell = { font: f.sans, size: 10, color: C.text };
    let cloudRow = 0;
    t.items.forEach((it, i) => {
      text(page, String(i + 1), col.no, y, cell);
      text(page, it.what, col.what, y, cell);
      rightText(page, it.qty, col.qty, y, cell);
      rightText(page, t.money(it.unit), col.unit, y, cell);
      rightText(page, t.money(it.amount), col.amount, y, cell);
      if (i === t.items.length - 1) cloudRow = y;
      rule(page, MARGIN, right, y - 9);
      y -= 26;
    });
    const total = t.items.reduce((s, it) => s + it.amount, 0);
    y -= 4;
    text(page, t.total, col.what, y, { font: f.sansBold, size: 11, color: C.ink });
    rightText(page, t.money(total), col.amount, y, { font: f.sansBold, size: 11, color: C.ink });
    rule(page, col.qty - 40, right, y - 6, C.ink, 1);
    rightText(page, t.vat(Math.round((total / 1.19) * 0.19 * 100) / 100), col.amount, y - 22, { font: f.sans, size: 9, color: C.grey });

    para(page, t.estimateNote, MARGIN, y - 64, 330, { font: f.sans, size: 10, leading: 14 });

    // Signature line, with room above it for a stamp.
    const sy = 170;
    rule(page, MARGIN, MARGIN + 230, sy, C.ink, 0.75);
    text(page, t.signHere, MARGIN, sy - 14, { font: f.sans, size: 8.5, color: C.grey });

    // Mara's doubt about the last line, as a cloud with a thread.
    const cy = cloudRow;
    const x0 = col.what - 8;
    const x1 = col.amount + 6;
    annots.push({
      page,
      a: {
        id: 'sample-cloud',
        type: 'cloud',
        vertices: [
          { x: x0, y: cy - 8 },
          { x: x1, y: cy - 8 },
          { x: x1, y: cy + 15 },
          { x: x0, y: cy + 15 },
        ],
        width: 1.5,
        fill: null,
        color: '#c62828',
        opacity: 1,
        author: 'Mara Kowalski',
        createdAt: at('2026-11-13T11:20:00Z'),
        comment: t.comments.cloud,
        replies: [{ id: 'sample-cloud-reply', author: 'Theo Brandner', text: t.comments.cloudReply, createdAt: at('2026-11-13T11:32:00Z') }],
      },
    });
    footer(page, f, t, 3, TOTAL);
  }

  // ── Page 4: booking form ──────────────────────────────────────────────────
  {
    const page = booking;
    const { width, height } = page.getSize();
    letterhead(page, f, t);
    text(page, t.formTitle, MARGIN, height - 150, { font: f.serifBold, size: 22, color: C.ink });
    para(page, t.formIntro, MARGIN, height - 175, width - 2 * MARGIN - 60, { font: f.sans, size: 10.5, leading: 15 });

    const form = doc.getForm();
    const label = { font: f.sans, size: 10.5, color: C.ink };
    const fx = MARGIN + 130;
    const fw = width - MARGIN - fx;
    const border = { borderColor: C.rule, borderWidth: 1, backgroundColor: rgb(0.99, 0.985, 0.97) };
    let y = height - 245;
    const fieldRow = (name: string, value?: string) => {
      text(page, name, MARGIN, y + 6, label);
      const field = form.createTextField(name);
      if (value) field.setText(value);
      field.addToPage(page, { x: fx, y: y - 1, width: fw, height: 21, font: f.sans, ...border });
      field.setFontSize(10.5);
      y -= 36;
    };
    const F = t.fields;
    fieldRow(F.name, 'Ines Albrecht');
    fieldRow(F.email);
    fieldRow(F.phone);

    text(page, F.bike, MARGIN, y + 6, label);
    const bike = form.createDropdown(F.bike);
    bike.addOptions(F.bikes);
    bike.select(F.bikes[1]);
    bike.addToPage(page, { x: fx, y: y - 1, width: 170, height: 21, font: f.sans, ...border });
    bike.setFontSize(10.5);
    y -= 36;
    fieldRow(F.frame, 'GZ 5521 0784');

    text(page, F.work, MARGIN, y + 6, label);
    F.jobs.forEach((job, i) => {
      const x = fx + (i % 2) * 175;
      const yy = y - Math.floor(i / 2) * 24;
      form.createCheckBox(job).addToPage(page, { x, y: yy + 2, width: 13, height: 13, ...border });
      text(page, job, x + 20, yy + 4, { font: f.sans, size: 10, color: C.text });
    });
    y -= 58;

    text(page, F.collect, MARGIN, y + 6, label);
    const collect = form.createRadioGroup(F.collect);
    F.collectOptions.forEach((opt, i) => {
      const yy = y - i * 22;
      collect.addOptionToPage(opt, page, { x: fx, y: yy + 2, width: 13, height: 13, ...border });
      text(page, opt, fx + 20, yy + 4, { font: f.sans, size: 10, color: C.text });
    });
    collect.select(F.collectOptions[0]);
    y -= 56;

    fieldRow(F.date);

    text(page, F.notes, MARGIN, y + 6, label);
    const notes = form.createTextField(F.notes);
    notes.enableMultiline();
    notes.addToPage(page, { x: fx, y: y - 52, width: fw, height: 72, font: f.sans, ...border });
    notes.setFontSize(10.5);
    y -= 92;

    form.createCheckBox(F.acceptName).addToPage(page, { x: MARGIN, y: y + 2, width: 13, height: 13, ...border });
    text(page, F.accept, MARGIN + 20, y + 4, { font: f.sans, size: 10, color: C.ink });

    const sy = 130;
    rule(page, MARGIN, MARGIN + 230, sy, C.ink, 0.75);
    text(page, t.formSign, MARGIN, sy - 14, { font: f.sans, size: 8.5, color: C.grey });
    para(page, t.formHint, MARGIN + 260, sy + 10, width - MARGIN - (MARGIN + 260), { font: f.sans, size: 8.5, color: C.grey, leading: 12 });
    form.updateFieldAppearances(f.sans);
    footer(page, f, t, 4, TOTAL);
  }

  // ── Page 5: floor plan at 1:50 (landscape) ───────────────────────────────
  {
    const page = plan;
    const { width } = page.getSize();
    const M = (72 / 25.4) * (1000 / 50); // one metre at 1:50, in points
    const ox = 70;
    const oy = 112;
    const P = (x: number, y: number) => ({ x: ox + x * M, y: oy + y * M });
    const box = (x: number, y: number, w: number, h: number, o: { fill?: Color; border?: Color; bw?: number; dash?: number[] } = {}) =>
      page.drawRectangle({ ...P(x, y), width: w * M, height: h * M, color: o.fill, borderColor: o.border, borderWidth: o.bw ?? 0, borderDashArray: o.dash });
    const lbl = (s: string, x: number, y: number, size = 8.5) => {
      const p = P(x, y);
      text(page, s, p.x - f.sans.widthOfTextAtSize(s, size) / 2, p.y - size / 3, { font: f.sans, size, color: C.ink });
    };
    const RW = 9;
    const RH = 6;

    // Outer walls, with a gap for the entrance.
    const wall = 0.24;
    box(-wall, -wall, RW + 2 * wall, RH + 2 * wall, { fill: C.ink });
    box(0, 0, RW, RH, { fill: C.white });
    box(1.0, -wall - 0.01, 1.1, wall + 0.02, { fill: C.white });
    // Door swing.
    const d = P(1.0, 0);
    page.drawSvgPath(`M 0 0 L 0 ${-1.1 * M} A ${1.1 * M} ${1.1 * M} 0 0 1 ${1.1 * M} 0`, { x: d.x, y: d.y, borderColor: C.grey, borderWidth: 0.6 });
    lbl(t.planLabels.door, 1.55, -0.55);
    // Windows in the back wall.
    for (const wx of [2.2, 5.4]) {
      box(wx, RH - 0.01, 1.8, wall + 0.02, { fill: C.white });
      const a = P(wx, RH + wall / 2);
      page.drawLine({ start: a, end: { x: a.x + 1.8 * M, y: a.y }, thickness: 0.6, color: C.ink });
      page.drawLine({ start: P(wx, RH), end: P(wx + 1.8, RH), thickness: 0.6, color: C.ink });
      page.drawLine({ start: P(wx, RH + wall), end: P(wx + 1.8, RH + wall), thickness: 0.6, color: C.ink });
    }
    lbl(t.planLabels.window, 3.1, RH + 0.5);

    // Parts store: a room of its own in the right front corner, 3 m by 2.5 m.
    const sw = 0.12;
    box(6.0 - sw, 0, sw, 2.5, { fill: C.ink });
    box(6.0 - sw, 2.5, 3.0 + sw, sw, { fill: C.ink });
    box(6.0 - sw - 0.01, 0.4, sw + 0.02, 0.9, { fill: C.white });
    for (let i = 0; i < 4; i++) box(8.4, 0.15 + i * 0.58, 0.45, 0.5, { border: C.grey, bw: 0.5, fill: C.tint });
    lbl(t.planLabels.store, 7.3, 1.3, 9);

    // Counter, stands, bench, parked bikes.
    box(0.6, 1.8, 2.6, 0.6, { fill: C.tint, border: C.ink, bw: 0.75 });
    lbl(t.planLabels.counter, 1.9, 2.1);
    for (const [n, x] of [
      [1, 3.9],
      [2, 6.6],
    ] as const) {
      box(x - 1.0, 3.0, 2.0, 1.9, { border: C.grey, bw: 0.5, dash: [3, 2] });
      page.drawCircle({ ...P(x, 3.95), size: 0.22 * M, borderColor: C.ink, borderWidth: 0.9, color: C.white });
      lbl(t.planLabels.stand(n), x, 3.3);
    }
    box(3.4, RH - 0.7, 5.2, 0.7, { fill: C.tint, border: C.ink, bw: 0.75 });
    lbl(t.planLabels.bench, 6.0, RH - 0.35);
    for (let i = 0; i < 5; i++) box(0.15, 2.9 + i * 0.5, 0.9, 0.08, { fill: C.grey });
    const pk = P(0.15, 5.3);
    text(page, t.planLabels.parking, pk.x, pk.y, { font: f.sans, size: 8.5, color: C.ink });

    // Scale bar, 0 to 5 m.
    const sb = P(0, -1.05);
    for (let i = 0; i < 5; i++) page.drawRectangle({ x: sb.x + i * M, y: sb.y, width: M, height: 4, color: i % 2 ? C.white : C.ink, borderColor: C.ink, borderWidth: 0.5 });
    for (let i = 0; i <= 5; i++) text(page, String(i), sb.x + i * M - 2, sb.y - 10, { font: f.sans, size: 7, color: C.ink });
    text(page, 'm', sb.x + 5 * M + 8, sb.y - 10, { font: f.sans, size: 7, color: C.ink });

    // North arrow.
    const na = P(RW + 0.9, RH - 0.4);
    page.drawSvgPath('M 0 0 L 5 14 L 0 10 L -5 14 Z', { x: na.x, y: na.y + 4, color: C.ink });
    text(page, 'N', na.x - 3, na.y + 8, { font: f.sansBold, size: 8, color: C.ink });

    // Title block.
    const tbx = width - 196;
    const tby = 112;
    page.drawRectangle({ x: tbx, y: tby, width: 150, height: 100, borderColor: C.ink, borderWidth: 0.9 });
    t.titleBlock.forEach((l, i) => {
      if (i > 0) rule(page, tbx, tbx + 150, tby + 100 - i * 20, C.rule, 0.5);
      text(page, l, tbx + 8, tby + 100 - i * 20 - 14, { font: i === 0 ? f.sansBold : f.sans, size: 8.5, color: C.ink });
    });

    // The back wall, already measured at 1:50.
    annots.push({
      page,
      a: {
        id: 'sample-measure',
        type: 'line',
        p1: P(0, RH + 0.95),
        p2: P(RW, RH + 0.95),
        width: 1,
        color: '#1565c0',
        opacity: 1,
        author: 'Theo Brandner',
        createdAt: at('2026-09-03T14:00:00Z'),
        measure: { kind: 'distance', scale: paperScale(50, 'm') },
      },
    });
    footer(page, f, t, 5, TOTAL);
  }

  // ── Page 6: scanned receipt (an image, no text) ───────────────────────────
  {
    const jpg = await doc.embedJpg(await loadAsset(`receipt-${lang}.jpg`));
    const { width, height } = scan.getSize();
    scan.drawImage(jpg, { x: 0, y: 0, width, height });
  }

  // ── Page 7: customer record ───────────────────────────────────────────────
  {
    const page = record;
    const { width, height } = page.getSize();
    letterhead(page, f, t);
    text(page, t.recordTitle, MARGIN, height - 150, { font: f.serifBold, size: 22, color: C.ink });
    const tag = t.internal.toUpperCase();
    const tw = f.sansBold.widthOfTextAtSize(tag, 8.5);
    page.drawRectangle({ x: width - MARGIN - tw - 16, y: height - 154, width: tw + 16, height: 20, borderColor: C.rust, borderWidth: 1.2 });
    text(page, tag, width - MARGIN - tw - 8, height - 147, { font: f.sansBold, size: 8.5, color: C.rust });

    let y = height - 195;
    for (const [k, v] of t.record) {
      text(page, k, MARGIN, y, { font: f.sans, size: 9.5, color: C.grey });
      const out = para(page, v, MARGIN + 110, y, width - 2 * MARGIN - 110, { font: f.mono, size: 10, color: C.ink, leading: 14 });
      y = out.y - 8;
      rule(page, MARGIN, width - MARGIN, y + 10, C.tint, 0.75);
    }

    y -= 24;
    text(page, t.historyHeading, MARGIN, y, { font: f.serifBold, size: 13, color: C.ink });
    y -= 22;
    for (const [date, what, amount] of t.history) {
      text(page, date, MARGIN, y, { font: f.mono, size: 10, color: C.ink });
      text(page, what, MARGIN + 110, y, { font: f.sans, size: 10 });
      rightText(page, t.money(amount), width - MARGIN, y, { font: f.mono, size: 10, color: C.ink });
      y -= 18;
    }

    y -= 30;
    const noteW = width - 2 * MARGIN;
    const lines = wrapLines(singleFontEngine(f.sans), t.redactNote, 10, noteW - 30);
    const boxH = lines.length * 14.5 + 22;
    page.drawRectangle({ x: MARGIN, y: y - boxH + 14, width: noteW, height: boxH, color: C.tint });
    page.drawRectangle({ x: MARGIN, y: y - boxH + 14, width: 3, height: boxH, color: C.rust });
    para(page, t.redactNote, MARGIN + 16, y, noteW - 30, { font: f.sans, size: 10, color: C.ink, leading: 14.5 });
    footer(page, f, t, 7, TOTAL);
  }

  // Comments and the measurement, written the way the editor writes its own.
  const ctx = await drawContext(doc, { regular: ['0123456789.,  mmcmkminftydmi²'] });
  for (const { page, a } of annots) await writeNativeAnnotation(ctx, page, geomOf(page), a);

  // The parts order as an attachment.
  await doc.attach(new TextEncoder().encode(t.partsCsv), lang === 'de' ? 'teilebestellung-2026-117.csv' : 'parts-order-2026-117.csv', {
    mimeType: 'text/csv',
    description: t.attachmentDescription,
    creationDate: created,
    modificationDate: created,
  });

  // Bookmarks, with the three parts of the order grouped (and open).
  let seq = 0;
  const bm = (title: string, page: PDFPage, children: OutlineNode[] = []): OutlineNode => ({
    id: `new-sample-${seq++}`,
    title,
    page: pages.indexOf(page),
    y: page.getHeight(),
    open: children.length > 0,
    bold: children.length > 0,
    italic: false,
    children,
  });
  setOutline(doc, [
    bm(t.outline.start, start),
    bm(t.outline.order, letter, [bm(t.outline.letter, letter), bm(t.outline.estimate, estimate), bm(t.outline.form, booking)]),
    bm(t.outline.plan, plan),
    bm(t.outline.receipt, scan),
    bm(t.outline.record, record),
  ]);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));

  return doc.save();
}
