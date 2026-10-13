/**
 * The recognition pipeline for one rendered page: orientation and skew,
 * ruling lines, OCR, text styles, tables and picture regions. Pure apart from
 * the injected recogniser, so it runs in node tests as well as in the browser.
 */
import { binarize, boxH, boxW, cloneRaster, crop, downscale, fillBox, grow, localBackground, pageBackground, rotateQuarter, rotateRaster, toGray, transpose, type Box, type Gray, type Raster, type RGB } from './raster';
import { detectSkew, uprightness } from './skew';
import { styleLines } from './style';
import { detectRulings, detectTables, rulingBox } from './tables';
import { detectPictures } from './pictures';
import { quarterMatrix, rotationMatrix, mul, type M } from './mapping';
import type { OcrPage, RulingLine, StyledLine, Table } from './types';

export interface AnalyseOptions {
  /** Resolution the page was rendered at. */
  dpi: number;
  detectSkew: boolean;
  detectRotation: boolean;
  styles: boolean;
  tables: boolean;
  pictures: boolean;
}

export type Recognise = (img: Raster, purpose: 'page' | 'probe') => Promise<OcrPage>;

export interface PageAnalysis {
  /** The image text was recognised in: upright and deskewed. */
  image: Raster;
  /** Clockwise quarter turns applied to the rendered page to make text upright. */
  quarterTurns: number;
  /** Detected clockwise skew of the content in degrees (the image is rotated by −skew). */
  skew: number;
  /** Rendered pixels → recognised-image pixels. */
  renderedToImage: M;
  lines: StyledLine[];
  rulings: RulingLine[];
  tables: Table[];
  pictures: Box[];
  background: RGB;
  confidence: number;
}

const inTable = (tables: Table[], l: RulingLine) =>
  tables.some((t) => l.x0 >= t.box.x0 - 4 && l.x1 <= t.box.x1 + 4 && l.y0 >= t.box.y0 - 4 && l.y1 <= t.box.y1 + 4);

/** Smallest skew worth correcting (degrees). */
export const MIN_SKEW = 0.15;

function smallBinary(img: Raster, dpi: number, target: number): Gray {
  return binarize(downscale(toGray(img), Math.max(1, Math.round(dpi / target))));
}

/** Text-like lines only: drop empty words and lone rule fragments OCR reads as | _ — etc. */
function cleanLines(page: OcrPage, rulings: RulingLine[]): OcrPage['lines'] {
  const boxes = rulings.map((l) => rulingBox(l, 2));
  const inside = (b: Box) => boxes.some((r) => b.x0 >= r.x0 && b.x1 <= r.x1 && b.y0 >= r.y0 && b.y1 <= r.y1);
  return page.lines
    .map((l) => ({
      ...l,
      words: l.words.filter((w) => w.text.trim() && !(w.conf < 60 && /^[|_\-—–=~.,:;'"`!Il1\\/]+$/.test(w.text.trim())) && w.conf >= 10 && !inside(w.box)),
    }))
    .filter((l) => l.words.length);
}

/** Probe a central crop in two orientations and keep the one OCR reads better. */
async function probeFlip(img: Raster, dpi: number, recognise: Recognise): Promise<boolean> {
  const f = Math.max(1, Math.round(dpi / 150));
  const w = Math.min(img.width, Math.round(7 * dpi));
  const h = Math.min(img.height, Math.round(3 * dpi));
  const c = crop(img, { x0: (img.width - w) / 2, y0: (img.height - h) / 2, x1: (img.width + w) / 2, y1: (img.height + h) / 2 });
  const small = f > 1 ? shrink(c, f) : c;
  const score = (p: OcrPage) => {
    const words = p.lines.flatMap((l) => l.words).filter((x) => x.text.trim().length > 1);
    return words.reduce((s, x) => s + x.conf, 0) / Math.sqrt(words.length + 1);
  };
  const up = score(await recognise(small, 'probe'));
  const down = score(await recognise(rotateQuarter(small, 2), 'probe'));
  return down > up * 1.15;
}

/** Downscale an RGBA image by an integer factor. */
export function shrink(r: Raster, f: number): Raster {
  const w = Math.max(1, Math.floor(r.width / f));
  const h = Math.max(1, Math.floor(r.height / f));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += r.data[((y * f + dy) * r.width + x * f + dx) * 4 + c];
        out[(y * w + x) * 4 + c] = s / (f * f);
      }
  return { width: w, height: h, data: out };
}

export async function analysePage(rendered: Raster, o: AnalyseOptions, recognise: Recognise): Promise<PageAnalysis> {
  const background = pageBackground(rendered);
  let q = 0;
  let img = rendered;

  // Line direction: text lines give a much sharper projection one way than the other.
  if (o.detectRotation) {
    const bin = smallBinary(rendered, o.dpi, 100);
    const h = detectSkew(bin);
    const v = detectSkew(transpose(bin));
    if (v.confidence > h.confidence * 1.3 && v.confidence > 0.05) {
      q = 1;
      img = rotateQuarter(rendered, 1);
    }
  }
  let skew = 0;
  if (o.detectSkew) {
    const s = detectSkew(smallBinary(img, o.dpi, 100));
    if (Math.abs(s.angle) >= MIN_SKEW && s.confidence > 0.05) skew = s.angle;
  }
  if (skew) img = rotateRaster(img, -skew, background);
  if (o.detectRotation) {
    const up = uprightness(smallBinary(img, o.dpi, 150));
    const flip = up.vote === -1 || (up.vote === 0 && (await probeFlip(img, o.dpi, recognise)));
    if (flip) {
      q += 2;
      img = rotateQuarter(img, 2);
    }
  }
  const qMat = quarterMatrix(q, rendered.width, rendered.height);
  const qw = q % 2 ? rendered.height : rendered.width;
  const qh = q % 2 ? rendered.width : rendered.height;
  // Rotation about the centre commutes with the half turn, so the order of the steps does not matter here.
  const renderedToImage = skew ? mul(qMat, rotationMatrix(-skew, qw, qh)) : qMat;

  // Ruling lines are found first and removed from the copy given to OCR. Styles are
  // measured with table rulings removed but other horizontal lines kept: those may be underlines.
  let rulings: RulingLine[] = [];
  let ocrImage = img;
  let styleImage = img;
  let tables: Table[] = [];
  if (o.tables) {
    rulings = detectRulings(binarize(toGray(img)), { dpi: o.dpi }, img);
    tables = detectTables(rulings, o.dpi);
    if (rulings.length) {
      ocrImage = cloneRaster(img);
      styleImage = cloneRaster(img);
      for (const l of rulings) {
        const b = rulingBox(l, 1);
        const c = localBackground(img, b, 3);
        fillBox(ocrImage, b, c);
        if (l.dir === 'v' || inTable(tables, l)) fillBox(styleImage, b, c);
      }
    }
  }
  const page = await recognise(ocrImage, 'page');
  let lines = styleLines(styleImage, cleanLines(page, rulings), { styles: o.styles });

  // A horizontal line that just underlines or strikes out words is a text decoration, not a ruling.
  rulings = rulings.filter((l) => {
    if (l.dir !== 'h' || inTable(tables, l)) return true;
    const decorated = lines.flatMap((ln) => ln.words).filter((w) => w.style.decorations.some((d) => l.y0 >= d.y0 - 2 && l.y0 <= d.y1 + 2));
    const covered = decorated.reduce((s, w) => s + Math.max(0, Math.min(w.box.x1, l.x1) - Math.max(w.box.x0, l.x0)), 0);
    if (decorated.length && covered >= (l.x1 - l.x0) * 0.6) return false;
    // Otherwise it stays a line, and words drawn over it do not get a decoration as well.
    for (const w of decorated) {
      w.style.decorations = w.style.decorations.filter((d) => !(l.y0 >= d.y0 - 2 && l.y0 <= d.y1 + 2));
      w.style.underline &&= w.style.decorations.some((d) => d.y0 > w.baselineY);
      w.style.strikeout &&= w.style.decorations.some((d) => d.y1 <= w.baselineY);
    }
    return true;
  });

  let pictures: Box[] = [];
  if (o.pictures) {
    const words = lines.flatMap((l) => l.words);
    const exclude = [...words.filter((w) => w.conf >= 50).flatMap((w) => [grow(w.box, 2), ...w.style.decorations]), ...rulings.map((l) => rulingBox(l, 2))];
    pictures = detectPictures(img, background, exclude, o.dpi);
    // Low-confidence "words" inside pictures are noise.
    const inPicture = (b: Box) => pictures.some((p) => b.x0 >= p.x0 && b.x1 <= p.x1 && b.y0 >= p.y0 && b.y1 <= p.y1);
    lines = lines.map((l) => ({ ...l, words: l.words.filter((w) => w.conf >= 70 || !inPicture(w.box)) })).filter((l) => l.words.length);
  }
  const words = lines.flatMap((l) => l.words);
  const confidence = words.length ? words.reduce((s, w) => s + w.conf, 0) / words.length : 0;
  return { image: img, quarterTurns: q % 4, skew, renderedToImage, lines, rulings, tables, pictures, background, confidence };
}

/** The recognised image with text, decorations and rulings painted over in their local background colour. */
export function eraseRecognised(a: PageAnalysis): Raster {
  const out = cloneRaster(a.image);
  const pad = Math.max(1, Math.round(boxH(a.lines[0]?.box ?? { x0: 0, y0: 0, x1: 0, y1: 20 }) / 20));
  const boxes = [
    ...a.lines.flatMap((l) => l.words.flatMap((w) => [grow(w.box, pad), ...w.style.decorations.map((d) => grow(d, pad))])),
    ...a.rulings.map((l) => rulingBox(l, pad + 1)),
  ].filter((b) => boxW(b) > 0 && boxH(b) > 0);
  // Measure all backgrounds on the original before painting, so boxes do not bleed into each other.
  const colours = boxes.map((b) => localBackground(a.image, b, 3));
  boxes.forEach((b, i) => fillBox(out, b, colours[i]));
  return out;
}
