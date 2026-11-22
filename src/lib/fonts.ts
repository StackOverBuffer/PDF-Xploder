/**
 * Unicode text for added content. Text is shaped over a fallback stack of
 * Noto fonts, and only the fonts (and glyphs) actually used are embedded:
 *
 *   Noto Sans           Latin, Greek, Cyrillic, … (bundled)
 *   Noto Sans Symbols 2 arrows, check marks, dingbats, … (bundled)
 *   Noto Sans SC        Chinese ideographs, Japanese kana   } fetched on demand from
 *   Noto Sans KR        Korean hangul                       } jsDelivr, only when needed
 *
 * Characters no chain font covers fall back to the bundled handwriting fonts (the
 * typed-signature faces), and to '?' only when even those lack the character.
 */
import { PDFDocument, PDFFont, StandardFonts } from '@cantoo/pdf-lib';
import { singleFontEngine, type TextEngine } from './appearance';
import { subsetFont } from './subset';
// The handwriting fonts of typed signatures (signatureFonts.css): their bytes load on demand,
// the ?url imports only carry the build asset path.
import dancingLatinUrl from '@fontsource/dancing-script/files/dancing-script-latin-400-normal.woff?url';
import dancingLatinExtUrl from '@fontsource/dancing-script/files/dancing-script-latin-ext-400-normal.woff?url';
import greatVibesLatinUrl from '@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff?url';
import greatVibesLatinExtUrl from '@fontsource/great-vibes/files/great-vibes-latin-ext-400-normal.woff?url';
import caveatLatinUrl from '@fontsource/caveat/files/caveat-latin-400-normal.woff?url';
import caveatLatinExtUrl from '@fontsource/caveat/files/caveat-latin-ext-400-normal.woff?url';
import alluraLatinUrl from '@fontsource/allura/files/allura-latin-400-normal.woff?url';
import alluraLatinExtUrl from '@fontsource/allura/files/allura-latin-ext-400-normal.woff?url';

export type FontKey =
  | 'sans'
  | 'sansBold'
  | 'symbols'
  | 'cjk'
  | 'cjkBold'
  | 'kr'
  | 'krBold'
  // The handwriting fonts of typed signatures (signatureFonts.css), as last-resort glyph donors.
  | 'dancingLatin'
  | 'dancingLatinExt'
  | 'greatVibesLatin'
  | 'greatVibesLatinExt'
  | 'caveatLatin'
  | 'caveatLatinExt'
  | 'alluraLatin'
  | 'alluraLatinExt';

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
  dancingLatin: dancingLatinUrl,
  dancingLatinExt: dancingLatinExtUrl,
  greatVibesLatin: greatVibesLatinUrl,
  greatVibesLatinExt: greatVibesLatinExtUrl,
  caveatLatin: caveatLatinUrl,
  caveatLatinExt: caveatLatinExtUrl,
  alluraLatin: alluraLatinUrl,
  alluraLatinExt: alluraLatinExtUrl,
};

const fetchSource: FontSource = async (key) => {
  const file = FILES[key];
  // Bundled paths under public/ need the base URL; ?url assets and CDN addresses do not.
  const url = /^(https?:|\/)/.test(file) ? file : `${import.meta.env.BASE_URL ?? '/'}${file}`;
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
    p = Promise.all([b, loadFontkit()]).then(async ([bytes, fontkit]) => {
      if (!bytes) return null;
      // The handwriting fonts ship as WOFF; hb-subset and pdf-lib read plain sfnt. The
      // unpacker lives in sfnt.ts, loaded on demand to keep it out of the start-up bundle.
      const sfnt = await import('./sfnt');
      if (sfnt.isWoff(bytes)) bytes = await sfnt.sfntFromWoff(bytes);
      const f = (fontkit as unknown as { create(b: Uint8Array): { hasGlyphForCodePoint(cp: number): boolean } }).create(bytes);
      return { bytes, has: (cp: number) => f.hasGlyphForCodePoint(cp) };
    }).catch(() => null);
    parsedCache.set(key, p);
    // A font that could not be loaded (offline, network error) is tried again next time.
    const mine = p;
    p.then((r) => {
      if (r === null && parsedCache.get(key) === mine) {
        parsedCache.delete(key);
        bytesCache.delete(key);
      }
    });
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

/** The name a font carries in its name table, or undefined if it has none. */
const postscriptName = (fontkit: Parameters<PDFDocument['registerFontkit']>[0], bytes: Uint8Array): string | undefined =>
  (fontkit as unknown as { create(b: Uint8Array): { postscriptName?: string | null } }).create(bytes).postscriptName || undefined;

/** Fallback chain per weight; CJK is only consulted when the others miss a character. */
const CHAINS: Record<'regular' | 'bold', FontKey[]> = {
  regular: ['sans', 'symbols', 'cjk', 'kr'],
  bold: ['sansBold', 'symbols', 'cjkBold', 'cjk', 'krBold', 'kr'],
};

/** Last-resort glyph donors, in the order the signature feature lists them (Dialogs.tsx):
 * consulted only when no chain font covers a character, loading bytes as the search
 * reaches each entry. */
const LAST_RESORT: FontKey[] = [
  'dancingLatin', 'dancingLatinExt', 'greatVibesLatin', 'greatVibesLatinExt',
  'caveatLatin', 'caveatLatinExt', 'alluraLatin', 'alluraLatinExt',
];

/** The first font of the fallback chain that has every character of `text`. */
export async function fontCovering(text: string): Promise<{ key: FontKey; bytes: Uint8Array } | undefined> {
  const cps = [...text].map((c) => c.codePointAt(0)!).filter((cp) => !isSpace(cp));
  for (const key of CHAINS.regular) {
    const f = await parsed(key);
    if (f && cps.every(f.has)) return { key, bytes: f.bytes };
  }
  return undefined;
}

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

  // Characters no chain font covers (offline the CJK fonts cannot be fetched): the bundled
  // handwriting fonts are the last resort before a character degrades to '?'.
  for (const key of LAST_RESORT) {
    if (!missing.length) break;
    const f = await parsed(key);
    if (!f || !missing.some(f.has)) continue;
    chain.push({ key, ...f });
    missing = missing.filter((cp) => !f.has(cp));
  }

  // Decide each character's font up front.
  const pick = new Map<number, number>();
  for (const cp of chars) pick.set(cp, isSpace(cp) ? 0 : chain.findIndex((c) => c.has(cp)));
  const perFont = new Map<number, Set<number>>([[0, new Set([32, 63 /* '?' fallback */])]]);
  for (const [cp, i] of pick) if (i >= 0) (perFont.get(i) ?? perFont.set(i, new Set()).get(i)!).add(cp);

  const fontkit = await loadFontkit();
  doc.registerFontkit(fontkit);
  const fonts: PDFFont[] = [];
  for (const [i, cps] of perFont) {
    let bytes = chain[i].bytes;
    try {
      bytes = await subsetFont(bytes, cps);
    } catch (e) {
      console.warn('Subsetting failed; embedding the whole font', e);
    }
    // Subset fonts carry the ABCDEF+ tag in their name table (see subset.ts); embedding under
    // that exact name keeps BaseFont, FontDescriptor and the font program consistent for PDF/A.
    // No ligatures: pdf-lib draws them with the wrong spacing, and text copied or searched
    // from the page would miss their letters ("fi" in "file").
    fonts[i] = await doc.embedFont(bytes, { subset: false, customName: postscriptName(fontkit, bytes), features: { liga: false, clig: false } });
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
