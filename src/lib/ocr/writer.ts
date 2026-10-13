/**
 * Writing recognition results into a page, in one of PDF-XChange's three
 * output types:
 *
 *   searchable  the page stays as it is; invisible text (render mode 3) is laid
 *               over every word, scaled to the word's width
 *   editable    the page becomes its own image with the recognised words and
 *               ruling lines painted out in the local background colour, with
 *               visible text and vector lines on top
 *   fine        only the recognised text, the ruling lines and images of the
 *               picture regions, on a white page
 */
import { PDFArray, PDFDict, PDFDocument, PDFFont, PDFName, PDFRef, PDFStream, StandardFonts, degrees, type PDFPage } from '@cantoo/pdf-lib';
import { createTextEngine } from '../fonts';
import type { TextEngine } from '../appearance';
import { eraseRecognised, type PageAnalysis } from './analyse';
import { crop, type Box, type Raster, type RGB } from './raster';
import { apply, inv, mul, placement, pxScale, quarterMatrix, rotationMatrix, textMatrix, type M } from './mapping';
import type { StyledWord } from './types';

export type OutputMode = 'searchable' | 'editable' | 'fine';

export interface EncodedImage {
  bytes: Uint8Array;
  format: 'jpg' | 'png';
}

export interface WriteOptions {
  mode: OutputMode;
  /** Replace the page by the deskewed image (implied by editable and fine). */
  correctSkew: boolean;
  /** Fix the page's /Rotate so text reads upright. */
  correctRotation: boolean;
  /** pdf.js viewport transform the page was rendered with. */
  viewport: M;
  /** Viewport transform at the same scale with /Rotate turned by the detected quarter turns. */
  turnedViewport: M;
  encodeImage(r: Raster): Promise<EncodedImage>;
}

const n = (v: number) => (Math.abs(v) < 1e-6 ? '0' : String(+v.toFixed(4)));
const mat = (m: M) => m.map(n).join(' ');
const rgb = (c: RGB) => c.map((v) => n(v / 255)).join(' ');

type FontKey = `${'Helvetica' | 'Times' | 'Courier'}-${'' | 'B'}${'' | 'I'}`;
const STANDARD: Record<FontKey, StandardFonts> = {
  'Helvetica-': StandardFonts.Helvetica,
  'Helvetica-B': StandardFonts.HelveticaBold,
  'Helvetica-I': StandardFonts.HelveticaOblique,
  'Helvetica-BI': StandardFonts.HelveticaBoldOblique,
  'Times-': StandardFonts.TimesRoman,
  'Times-B': StandardFonts.TimesRomanBold,
  'Times-I': StandardFonts.TimesRomanItalic,
  'Times-BI': StandardFonts.TimesRomanBoldItalic,
  'Courier-': StandardFonts.Courier,
  'Courier-B': StandardFonts.CourierBold,
  'Courier-I': StandardFonts.CourierOblique,
  'Courier-BI': StandardFonts.CourierBoldOblique,
};

/** Standard font matching a word's recognised style. */
export function fontKeyFor(w: StyledWord, plain: boolean): FontKey {
  if (plain) return 'Helvetica-';
  const fam = w.style.family === 'serif' ? 'Times' : w.style.family === 'mono' ? 'Courier' : 'Helvetica';
  return `${fam}-${w.style.bold ? 'B' : ''}${w.style.italic ? 'I' : ''}` as FontKey;
}

/** Per-document writer state: fonts are embedded once and shared by all pages. */
export function createWriter(doc: PDFDocument) {
  const standard = new Map<FontKey, PDFFont>();
  const winAnsi = new Set<number>();
  const std = (k: FontKey) => {
    let f = standard.get(k);
    if (!f) {
      f = doc.embedStandardFont(STANDARD[k]);
      standard.set(k, f);
      if (!winAnsi.size) for (const cp of f.getCharacterSet()) winAnsi.add(cp);
    }
    return f;
  };
  std('Helvetica-');
  const encodable = (t: string) => [...t].every((ch) => winAnsi.has(ch.codePointAt(0)!));

  async function writePage(page: PDFPage, a: PageAnalysis, o: WriteOptions) {
    const ctx = doc.context;
    const turned = o.correctRotation && a.quarterTurns !== 0;
    const deskew = o.mode !== 'searchable' || o.correctSkew;
    const { width: W, height: H } = a.image;
    // Recognised pixels → (unless deskewed) back to the skewed image → (unless turned) back to the rendered page.
    let toFrame: M = deskew || !a.skew ? [1, 0, 0, 1, 0, 0] : rotationMatrix(a.skew, W, H);
    const odd = a.quarterTurns % 2 === 1;
    if (!turned) toFrame = mul(toFrame, inv(quarterMatrix(a.quarterTurns, odd ? H : W, odd ? W : H))!);
    const { pxToUser, imageToUser } = placement(turned ? o.turnedViewport : o.viewport, toFrame, W, H);
    const s = pxScale(pxToUser);

    const replace = o.mode !== 'searchable' || (o.correctSkew && !!a.skew);
    if (replace) {
      page.node.set(PDFName.of('Contents'), ctx.obj([]));
      page.node.set(PDFName.of('Resources'), ctx.obj({}));
    } else {
      // Isolate the existing content's graphics state from what is added.
      page.node.normalize();
      page.node.wrapContentStreams(ctx.register(ctx.stream('q')), ctx.register(ctx.stream('Q')));
    }
    if (turned) page.setRotation(degrees((page.getRotation().angle + a.quarterTurns * 90) % 360));

    const ops: string[] = [];
    const image = async (r: Raster, cm: M) => {
      const enc = await o.encodeImage(r);
      const img = enc.format === 'jpg' ? await doc.embedJpg(enc.bytes) : await doc.embedPng(enc.bytes);
      const name = page.node.newXObject('OcrIm', img.ref);
      ops.push(`q ${mat(cm)} cm ${name.asString()} Do Q`);
    };
    if (o.mode === 'searchable' && replace) await image(a.image, imageToUser);
    if (o.mode === 'editable') await image(eraseRecognised(a), imageToUser);
    if (o.mode === 'fine')
      for (const p of a.pictures) await image(crop(a.image, p), mul([p.x1 - p.x0, 0, 0, -(p.y1 - p.y0), p.x0, p.y1], pxToUser));

    const visible = o.mode !== 'searchable';
    const line = (x0: number, y0: number, x1: number, y1: number, width: number, c: RGB) => {
      const p = apply(pxToUser, x0, y0);
      const q = apply(pxToUser, x1, y1);
      ops.push(`q ${rgb(c)} RG ${n(Math.max(0.1, width * s))} w 0 J ${n(p.x)} ${n(p.y)} m ${n(q.x)} ${n(q.y)} l S Q`);
    };
    if (visible) for (const l of a.rulings) line(l.x0, l.y0, l.x1, l.y1, l.thickness, l.color);

    // Words outside WinAnsi are drawn with Noto Sans (regular and bold engines for this page).
    const words = a.lines.flatMap((l) => l.words);
    const special = words.filter((w) => !encodable(w.text));
    const engines: Partial<Record<'regular' | 'bold', TextEngine>> = {};
    for (const weight of ['regular', 'bold'] as const) {
      const texts = special.filter((w) => visible && w.style.bold === (weight === 'bold')).map((w) => w.text);
      if (weight === 'regular' && !visible) texts.push(...special.map((w) => w.text));
      if (texts.length) engines[weight] = await createTextEngine(doc, [...texts, ' '], weight);
    }
    const fontNames = new Map<PDFFont, string>();
    const fontName = (f: PDFFont) => {
      let nm = fontNames.get(f);
      if (!nm) fontNames.set(f, (nm = page.node.newFontDictionary('OcrF', f.ref).asString()));
      return nm;
    };

    for (const l of a.lines) {
      const text: string[] = [visible ? 'BT' : 'BT 3 Tr'];
      l.words.forEach((w, i) => {
        const size = w.style.size * s;
        if (size <= 0) return;
        const last = i === l.words.length - 1;
        let runs: { font: PDFFont; text: string }[];
        let width: number;
        let slant = 0;
        if (encodable(w.text)) {
          const f = std(fontKeyFor(w, !visible));
          runs = [{ font: f, text: w.text + (last ? '' : ' ') }];
          width = f.widthOfTextAtSize(w.text, size);
        } else {
          const e = engines[visible && w.style.bold ? 'bold' : 'regular']!;
          runs = e.runs(w.text + (last ? '' : ' '));
          width = e.width(w.text, size);
          if (visible && w.style.italic) slant = 0.21;
        }
        if (!width) return;
        const target = (w.box.x1 - w.box.x0) * s;
        const tz = Math.max(20, Math.min(400, (100 * target) / width));
        text.push(`${mat(textMatrix(pxToUser, w.box.x0, w.baselineY, slant))} Tm ${n(tz)} Tz`);
        if (visible) text.push(`${rgb(w.style.color)} rg`);
        for (const r of runs) text.push(`${fontName(r.font)} ${n(size)} Tf ${r.font.encodeText(r.text).toString()} Tj`);
      });
      text.push('ET');
      if (text.length > 2) ops.push(text.join('\n'));
      if (visible)
        for (const w of l.words)
          for (const d of w.style.decorations) {
            const y = (d.y0 + d.y1) / 2;
            line(w.box.x0, y, w.box.x1, y, d.y1 - d.y0, w.style.color);
          }
    }
    if (ops.length) page.node.addContentStream(ctx.register(ctx.flateStream(ops.join('\n'))));
  }

  return { writePage };
}

/** Drop objects nothing refers to any more (replaced page content, old images and fonts). */
export function removeUnreferenced(doc: PDFDocument) {
  const ctx = doc.context;
  const seen = new Set<string>();
  const visit = (o: unknown) => {
    if (o instanceof PDFRef) {
      const key = o.toString();
      if (seen.has(key)) return;
      seen.add(key);
      visit(ctx.lookup(o));
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) visit(v);
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) visit(o.get(i));
    } else if (o instanceof PDFStream) {
      visit(o.dict);
    }
  };
  const t = ctx.trailerInfo;
  for (const v of [t.Root, t.Info, t.Encrypt, t.ID]) if (v) visit(v);
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.toString())) ctx.delete(ref);
}

export type { Box };
