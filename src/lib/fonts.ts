/**
 * Unicode text for added content. Text is shaped over a fallback stack of
 * Noto fonts, and only the fonts (and glyphs) actually used are embedded:
 *
 *   Noto Sans           Latin, Greek, Cyrillic, … (bundled)
 *   Noto Sans Symbols 2 arrows, check marks, dingbats, … (bundled)
 *   Noto Sans SC        Chinese ideographs, Japanese kana   } fetched on demand from
 *   Noto Sans KR        Korean hangul                       } jsDelivr, only when needed
 */
import { PDFDocument, PDFFont, StandardFonts } from '@cantoo/pdf-lib';
import { singleFontEngine, type TextEngine } from './appearance';
import { subsetFont } from './subset';

export type FontKey = 'sans' | 'sansBold' | 'symbols' | 'cjk' | 'cjkBold' | 'kr' | 'krBold';

/** Returns font file bytes, or null when the font is unavailable (e.g. offline). */
export type FontSource = (key: FontKey) => Promise<Uint8Array | null>;

const CDN = 'https://cdn.jsdelivr.net/npm/@expo-google-fonts';
const FILES: Record<FontKey, string> = {
  sans: 'fonts/NotoSans-Regular.ttf',
  sansBold: 'fonts/NotoSans-Bold.ttf',
  symbols: 'fonts/NotoSansSymbols2-Regular.ttf',
  cjk: `${CDN}/noto-sans-sc@0.4.3/400Regular/NotoSansSC_400Regular.ttf`,
  cjkBold: `${CDN}/noto-sans-sc@0.4.3/700Bold/NotoSansSC_700Bold.ttf`,
  kr: `${CDN}/noto-sans-kr@0.4.3/400Regular/NotoSansKR_400Regular.ttf`,
  krBold: `${CDN}/noto-sans-kr@0.4.3/700Bold/NotoSansKR_700Bold.ttf`,
};

const fetchSource: FontSource = async (key) => {
  const file = FILES[key];
  const url = /^https?:/.test(file) ? file : `${import.meta.env.BASE_URL ?? '/'}${file}`;
  try {
    const res = await fetch(url);
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
};

let source: FontSource = fetchSource;
const bytesCache = new Map<FontKey, Promise<Uint8Array | null>>();
const parsedCache = new Map<FontKey, Promise<{ bytes: Uint8Array; has: (cp: number) => boolean } | null>>();

/** Replace where fonts come from (tests read them from disk). */
export function setFontSource(s: FontSource) {
  source = s;
  bytesCache.clear();
  parsedCache.clear();
}

function parsed(key: FontKey) {
  let p = parsedCache.get(key);
  if (!p) {
    let b = bytesCache.get(key);
    if (!b) bytesCache.set(key, (b = source(key)));
    p = Promise.all([b, loadFontkit()]).then(([bytes, fontkit]) => {
      if (!bytes) return null;
      const f = (fontkit as unknown as { create(b: Uint8Array): { hasGlyphForCodePoint(cp: number): boolean } }).create(bytes);
      return { bytes, has: (cp: number) => f.hasGlyphForCodePoint(cp) };
    }).catch(() => null);
    parsedCache.set(key, p);
  }
  return p;
}

/** Raw bytes of one of the fonts, or null if unavailable. */
export async function loadFontBytes(key: FontKey): Promise<Uint8Array | null> {
  return (await parsed(key))?.bytes ?? null;
}

/** Nothing to draw was announced: embed Helvetica only if the engine is used after all. */
function lazyStandardEngine(doc: PDFDocument, weight: 'regular' | 'bold'): TextEngine {
  let inner: TextEngine | null = null;
  const get = () => (inner ??= singleFontEngine(doc.embedStandardFont(weight === 'bold' ? StandardFonts.HelveticaBold : StandardFonts.Helvetica)));
  return { runs: (t) => get().runs(t), width: (t, s) => get().width(t, s) };
}

// fontkit is only needed once custom fonts are embedded, so load it on demand.
let fontkitPromise: Promise<unknown> | null = null;
export const loadFontkit = () => (fontkitPromise ??= import('@pdf-lib/fontkit').then((m) => m.default ?? m)) as Promise<Parameters<PDFDocument['registerFontkit']>[0]>;

const isSpace = (cp: number) => cp === 10 || cp === 13 || cp === 9 || cp === 32;

/** Fallback chain per weight; CJK is only consulted when the others miss a character. */
const CHAINS: Record<'regular' | 'bold', FontKey[]> = {
  regular: ['sans', 'symbols', 'cjk', 'kr'],
  bold: ['sansBold', 'symbols', 'cjkBold', 'cjk', 'krBold', 'kr'],
};

/**
 * Build a text engine able to draw all of `texts`, embedding the fonts needed.
 * Falls back to Helvetica if the bundled fonts cannot be loaded at all.
 */
export async function createTextEngine(doc: PDFDocument, texts: string[], weight: 'regular' | 'bold' = 'regular'): Promise<TextEngine> {
  const chars = new Set<number>();
  for (const t of texts) for (const ch of t) chars.add(ch.codePointAt(0)!);
  if (!chars.size) return lazyStandardEngine(doc, weight);

  const chain: { key: FontKey; has: (cp: number) => boolean; bytes: Uint8Array }[] = [];
  let missing = [...chars].filter((cp) => !isSpace(cp));
  for (const key of CHAINS[weight]) {
    // Always load the primary font; load fallbacks only for characters still missing.
    if (chain.length && !missing.length) break;
    const f = await parsed(key);
    if (!f) continue;
    if (chain.length && !missing.some(f.has)) continue;
    chain.push({ key, ...f });
    missing = missing.filter((cp) => !f.has(cp));
  }
  if (!chain.length) {
    return singleFontEngine(await doc.embedFont(weight === 'bold' ? StandardFonts.HelveticaBold : StandardFonts.Helvetica));
  }

  // Decide each character's font up front.
  const pick = new Map<number, number>();
  for (const cp of chars) pick.set(cp, isSpace(cp) ? 0 : chain.findIndex((c) => c.has(cp)));
  const perFont = new Map<number, Set<number>>([[0, new Set([32, 63 /* '?' fallback */])]]);
  for (const [cp, i] of pick) if (i >= 0) (perFont.get(i) ?? perFont.set(i, new Set()).get(i)!).add(cp);

  doc.registerFontkit(await loadFontkit());
  const fonts: PDFFont[] = [];
  for (const [i, cps] of perFont) {
    let bytes = chain[i].bytes;
    try {
      bytes = await subsetFont(bytes, cps);
    } catch (e) {
      console.warn('Subsetting failed; embedding the whole font', e);
    }
    fonts[i] = await doc.embedFont(bytes, { subset: false });
  }

  const runs = (text: string) => {
    const out: { font: PDFFont; text: string }[] = [];
    for (const ch of text) {
      const i = pick.get(ch.codePointAt(0)!) ?? -1;
      // Characters no font covers (or that were not announced) become '?'.
      const font = i >= 0 ? fonts[i] : fonts[0];
      const glyph = i >= 0 ? ch : '?';
      const last = out[out.length - 1];
      if (last && last.font === font) last.text += glyph;
      else out.push({ font, text: glyph });
    }
    return out;
  };
  return {
    runs,
    width: (text, size) => runs(text).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0),
  };
}
