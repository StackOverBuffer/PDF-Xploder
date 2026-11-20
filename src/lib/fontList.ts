/**
 * The fonts a document uses, for Document Properties: name, type, whether the font
 * program is embedded (and only a subset of it), and the pages that use it.
 */
import { PDFArray, PDFDict, PDFName, PDFRef, PDFStream, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib';
import { load } from './pdfOps';

export interface FontInfo {
  /** The font's name without a subset prefix ("ABCDEF+"). */
  name: string;
  /** Font type as in the file: Type1, TrueType, Type0, Type3, … ("Type0 / CIDFontType2" for composite fonts). */
  type: string;
  embedded: boolean;
  /** Only the characters the document uses are embedded (the name has a subset prefix). */
  subset: boolean;
  /** Encoding name, if the font names one (WinAnsiEncoding, Identity-H, …). */
  encoding?: string;
  /** Pages (0-based) whose content, form XObjects or comments use the font. */
  pages: number[];
}

const N = (k: string) => PDFName.of(k);
const nameOf = (o: PDFObject | undefined) => (o instanceof PDFName ? o.decodeText() : undefined);

/** The 14 fonts every PDF viewer provides, which are often not embedded. */
const STANDARD = /^(Times-(Roman|Bold|Italic|BoldItalic)|Helvetica(-Bold|-Oblique|-BoldOblique)?|Courier(-Bold|-Oblique|-BoldOblique)?|Symbol|ZapfDingbats)$/;

/** Is this one of the standard 14 fonts (which viewers supply when it is not embedded)? */
export const isStandardFont = (name: string) => STANDARD.test(name);

function describe(font: PDFDict): Omit<FontInfo, 'pages'> {
  const ctx = font.context;
  const subtype = nameOf(font.lookup(N('Subtype'))) ?? '?';
  let descriptorHolder = font;
  let type = subtype;
  if (subtype === 'Type0') {
    const desc = font.lookup(N('DescendantFonts'));
    const first = desc instanceof PDFArray ? ctx.lookup(desc.get(0)) : undefined;
    if (first instanceof PDFDict) {
      descriptorHolder = first;
      type = `Type0 / ${nameOf(first.lookup(N('Subtype'))) ?? '?'}`;
    }
  }
  const base = nameOf(font.lookup(N('BaseFont'))) ?? nameOf(font.lookup(N('Name'))) ?? '';
  const subset = /^[A-Z]{6}\+/.test(base);
  const fd = descriptorHolder.lookup(N('FontDescriptor'));
  // Type 3 fonts are drawn by procedures in the file: always "embedded".
  const embedded = subtype === 'Type3' || (fd instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => fd.lookup(N(k)) instanceof PDFStream));
  const enc = font.lookup(N('Encoding'));
  const encoding = nameOf(enc) ?? (enc instanceof PDFDict ? nameOf(enc.lookup(N('BaseEncoding'))) ?? 'custom' : undefined);
  return { name: (subset ? base.slice(7) : base) || '(unnamed)', type, embedded, subset, encoding };
}

/** Every font used by the document's pages, sorted by name. */
export function fontsOf(doc: PDFDocument): FontInfo[] {
  const ctx = doc.context;
  const found = new Map<string | PDFDict, FontInfo>();
  // Pages are walked in order: resources shared by many pages are visited once per page.
  const visitedOn = new Map<PDFDict, number>();
  const walkResources = (res: PDFObject | undefined, page: number, depth: number) => {
    const r = res instanceof PDFRef ? ctx.lookup(res) : res;
    if (!(r instanceof PDFDict) || depth > 12) return;
    if (visitedOn.get(r) === page) return;
    visitedOn.set(r, page);
    const fonts = r.lookup(N('Font'));
    if (fonts instanceof PDFDict) {
      for (const [, ref] of fonts.entries()) {
        const f = ctx.lookup(ref);
        if (!(f instanceof PDFDict)) continue;
        const id = ref instanceof PDFRef ? ref.toString() : f;
        let info = found.get(id);
        if (!info) found.set(id, (info = { ...describe(f), pages: [] }));
        if (!info.pages.includes(page)) info.pages.push(page);
        // Type 3 glyph procedures have resources of their own.
        if (nameOf(f.lookup(N('Subtype'))) === 'Type3') walkResources(f.get(N('Resources')), page, depth + 1);
      }
    }
    const xobjs = r.lookup(N('XObject'));
    if (xobjs instanceof PDFDict) {
      for (const [, ref] of xobjs.entries()) {
        const x = ctx.lookup(ref);
        if (x instanceof PDFStream && x.dict.lookup(N('Subtype')) === N('Form')) walkResources(x.dict.get(N('Resources')), page, depth + 1);
      }
    }
    const patterns = r.lookup(N('Pattern'));
    if (patterns instanceof PDFDict) {
      for (const [, ref] of patterns.entries()) {
        const p = ctx.lookup(ref);
        if (p instanceof PDFStream) walkResources(p.dict.get(N('Resources')), page, depth + 1);
      }
    }
  };
  doc.getPages().forEach((page, i) => {
    walkResources(page.node.Resources() ?? page.node.getInheritableAttribute(N('Resources')), i, 0);
    // Comment and form field appearances.
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      const a = ctx.lookup(ref);
      const ap = a instanceof PDFDict ? a.lookup(N('AP')) : undefined;
      if (!(ap instanceof PDFDict)) continue;
      for (const k of ['N', 'R', 'D']) {
        const v = ap.lookup(N(k));
        const streams = v instanceof PDFStream ? [v] : v instanceof PDFDict ? v.values().map((s) => ctx.lookup(s)) : [];
        for (const s of streams) if (s instanceof PDFStream) walkResources(s.dict.get(N('Resources')), i, 1);
      }
    }
  });
  // Programs often write the same font several times (once per page or form): show it once.
  const merged = new Map<string, FontInfo>();
  for (const f of found.values()) {
    const key = [f.name, f.type, f.embedded, f.subset, f.encoding].join('|');
    const m = merged.get(key);
    if (m) m.pages = [...new Set([...m.pages, ...f.pages])].sort((x, y) => x - y);
    else merged.set(key, { ...f, pages: [...f.pages] });
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}

export async function listFonts(bytes: Uint8Array): Promise<FontInfo[]> {
  return fontsOf(await load(bytes));
}
