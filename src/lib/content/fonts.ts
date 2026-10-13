/**
 * Just enough font knowledge to edit text in page content: how codes split,
 * glyph widths (for bounding boxes), code → Unicode (to show the text), and
 * Unicode → code (to write edited text back in the original font).
 */
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import { Encodings, Font as StdFont } from '@cantoo/pdf-lib/standard-fonts';

export interface FontInfo {
  /** Resource name of the font on the page. */
  key: string;
  subtype: string;
  baseFont: string;
  /** Split a shown string into character codes. */
  codes(bytes: Uint8Array): { code: number; len: number }[];
  /** Advance width in text space per unit of font size. */
  width(code: number): number;
  unicode(code: number): string;
  /** Codes for `text` in this font, or null if some character cannot be drawn with it. */
  encode(text: string): Uint8Array | null;
  ascent: number;
  descent: number;
  /** Codes seen on the page (an embedded subset may contain only these glyphs). */
  used: Set<number>;
}

const n = (o: unknown): number | undefined => (o instanceof PDFNumber ? o.asNumber() : undefined);

function streamBytes(s: unknown): Uint8Array | undefined {
  if (s instanceof PDFRawStream) {
    try {
      return decodePDFRawStream(s).decode();
    } catch {
      return undefined;
    }
  }
  if (s instanceof PDFStream) return s.getContents();
  return undefined;
}

// ---------------------------------------------------------------- glyph names

const STANDARD_UPPER: Record<number, string> = {
  39: 'quoteright', 96: 'quoteleft', 161: 'exclamdown', 162: 'cent', 163: 'sterling', 164: 'fraction', 165: 'yen', 166: 'florin',
  167: 'section', 168: 'currency', 169: 'quotesingle', 170: 'quotedblleft', 171: 'guillemotleft', 172: 'guilsinglleft',
  173: 'guilsinglright', 174: 'fi', 175: 'fl', 177: 'endash', 178: 'dagger', 179: 'daggerdbl', 180: 'periodcentered',
  182: 'paragraph', 183: 'bullet', 184: 'quotesinglbase', 185: 'quotedblbase', 186: 'quotedblright', 187: 'guillemotright',
  188: 'ellipsis', 189: 'perthousand', 191: 'questiondown', 193: 'grave', 194: 'acute', 195: 'circumflex', 196: 'tilde',
  197: 'macron', 198: 'breve', 199: 'dotaccent', 200: 'dieresis', 202: 'ring', 203: 'cedilla', 205: 'hungarumlaut',
  206: 'ogonek', 207: 'caron', 208: 'emdash', 225: 'AE', 227: 'ordfeminine', 232: 'Lslash', 233: 'Oslash', 234: 'OE',
  235: 'ordmasculine', 241: 'ae', 245: 'dotlessi', 248: 'lslash', 249: 'oslash', 250: 'oe', 251: 'germandbls',
};

const EXTRA_NAMES: Record<string, number> = {
  fi: 0xfb01, fl: 0xfb02, ff: 0xfb00, ffi: 0xfb03, ffl: 0xfb04, fraction: 0x2044, dotlessi: 0x131, Lslash: 0x141, lslash: 0x142,
  hungarumlaut: 0x2dd, ogonek: 0x2db, caron: 0x2c7, dotaccent: 0x2d9, breve: 0x2d8, ring: 0x2da, minus: 0x2212, space: 0x20,
  nbspace: 0xa0, sfthyphen: 0xad, quoteright: 0x2019, quoteleft: 0x2018,
};

type Table = { code2name: string[]; name2uni: Map<string, number> };
let tables: { winAnsi: Table; symbol: Table; zapf: Table; standard: string[] } | null = null;

function buildTables() {
  if (tables) return tables;
  const build = (e: (typeof Encodings)['WinAnsi']): Table => {
    const code2name: string[] = [];
    const name2uni = new Map<string, number>();
    for (const cp of e.supportedCodePoints) {
      const { code, name } = e.encodeUnicodeCodePoint(cp);
      code2name[code] ??= name;
      if (!name2uni.has(name)) name2uni.set(name, cp);
    }
    return { code2name, name2uni };
  };
  const winAnsi = build(Encodings.WinAnsi);
  const standard: string[] = [];
  for (let c = 32; c < 127; c++) standard[c] = winAnsi.code2name[c];
  for (const [c, nm] of Object.entries(STANDARD_UPPER)) standard[Number(c)] = nm;
  tables = { winAnsi, symbol: build(Encodings.Symbol), zapf: build(Encodings.ZapfDingbats), standard };
  return tables;
}

export function glyphNameToUnicode(name: string): string {
  const t = buildTables();
  const cp = t.winAnsi.name2uni.get(name) ?? EXTRA_NAMES[name] ?? t.symbol.name2uni.get(name) ?? t.zapf.name2uni.get(name);
  if (cp !== undefined) return String.fromCodePoint(cp);
  let m = name.match(/^uni([0-9A-Fa-f]{4,})$/);
  if (m) return m[1].match(/.{4}/g)!.map((h) => String.fromCharCode(parseInt(h, 16))).join('');
  m = name.match(/^u([0-9A-Fa-f]{4,6})$/);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  if (/^[A-Za-z]$/.test(name)) return name;
  const base = name.split('.')[0];
  return base !== name ? glyphNameToUnicode(base) : '';
}

// ---------------------------------------------------------------- CMaps

interface CMapData {
  /** Code space ranges: byte length plus first-byte bounds. */
  spaces: { len: number; lo: number; hi: number }[];
  map: Map<number, string>;
}

const hexToNum = (h: string) => parseInt(h, 16);
const utf16 = (h: string) => {
  let s = '';
  for (let i = 0; i + 3 < h.length + 1; i += 4) s += String.fromCharCode(parseInt(h.substr(i, 4).padEnd(4, '0'), 16));
  return s;
};

export function parseCMap(text: string): CMapData {
  const spaces: CMapData['spaces'] = [];
  const map = new Map<number, string>();
  for (const block of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      spaces.push({ len: m[1].length / 2, lo: hexToNum(m[1].slice(0, 2)), hi: hexToNum(m[2].slice(0, 2)) });
    }
  }
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) map.set(hexToNum(m[1]), utf16(m[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g)) {
      const lo = hexToNum(m[1]);
      const hi = hexToNum(m[2]);
      if (hi - lo > 65535) continue;
      if (m[3].startsWith('[')) {
        const items = [...m[3].matchAll(/<([0-9A-Fa-f]*)>/g)].map((x) => x[1]);
        items.forEach((h, k) => map.set(lo + k, utf16(h)));
      } else {
        const dst = m[3].slice(1, -1);
        const base = utf16(dst);
        for (let c = lo; c <= hi; c++) {
          const off = c - lo;
          map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + off));
        }
      }
    }
  }
  return { spaces, map };
}

function splitter(spaces: CMapData['spaces'], fallbackLen: number) {
  return (bytes: Uint8Array) => {
    const out: { code: number; len: number }[] = [];
    let i = 0;
    while (i < bytes.length) {
      const b0 = bytes[i];
      const sp = spaces.find((s) => b0 >= s.lo && b0 <= s.hi && i + s.len <= bytes.length);
      const len = sp ? sp.len : Math.min(fallbackLen, bytes.length - i);
      let code = 0;
      for (let k = 0; k < len; k++) code = code * 256 + bytes[i + k];
      out.push({ code, len });
      i += len;
    }
    return out;
  };
}

// ---------------------------------------------------------------- fonts

const STD14: Record<string, string> = {
  Helvetica: 'Helvetica', 'Helvetica-Bold': 'Helvetica-Bold', 'Helvetica-Oblique': 'Helvetica-Oblique', 'Helvetica-BoldOblique': 'Helvetica-BoldOblique',
  Arial: 'Helvetica', 'Arial,Bold': 'Helvetica-Bold', 'Arial-BoldMT': 'Helvetica-Bold', ArialMT: 'Helvetica', 'Arial,Italic': 'Helvetica-Oblique',
  'Times-Roman': 'Times-Roman', 'Times-Bold': 'Times-Bold', 'Times-Italic': 'Times-Italic', 'Times-BoldItalic': 'Times-BoldItalic',
  TimesNewRoman: 'Times-Roman', TimesNewRomanPSMT: 'Times-Roman', 'TimesNewRoman,Bold': 'Times-Bold',
  Courier: 'Courier', 'Courier-Bold': 'Courier-Bold', 'Courier-Oblique': 'Courier-Oblique', 'Courier-BoldOblique': 'Courier-BoldOblique', CourierNew: 'Courier',
  Symbol: 'Symbol', ZapfDingbats: 'ZapfDingbats',
};

const stdCache = new Map<string, StdFont>();
function stdFont(name: string): StdFont | undefined {
  const std = STD14[name];
  if (!std) return undefined;
  if (!stdCache.has(std)) stdCache.set(std, StdFont.load(std as never));
  return stdCache.get(std);
}

function descriptorMetrics(fd: unknown): { ascent: number; descent: number; missing?: number } {
  if (!(fd instanceof PDFDict)) return { ascent: 0.75, descent: -0.25 };
  const a = n(fd.lookup(PDFName.of('Ascent')));
  const d = n(fd.lookup(PDFName.of('Descent')));
  return {
    ascent: a && a > 0 ? a / 1000 : 0.75,
    descent: d && d < 0 ? d / 1000 : -0.25,
    missing: n(fd.lookup(PDFName.of('MissingWidth'))),
  };
}

/** Build font information from a font dictionary. */
export function readFont(key: string, dict: PDFDict): FontInfo {
  const subtype = dict.lookup(PDFName.of('Subtype'))?.toString().slice(1) ?? 'Type1';
  const baseFont = (dict.lookup(PDFName.of('BaseFont'))?.toString().slice(1) ?? key).replace(/^[A-Z]{6}\+/, '');
  const toUni = streamBytes(dict.lookup(PDFName.of('ToUnicode')));
  const cmap = toUni ? parseCMap(new TextDecoder('latin1').decode(toUni)) : undefined;
  const used = new Set<number>();
  const subset = /^[A-Z]{6}\+/.test(dict.lookup(PDFName.of('BaseFont'))?.toString().slice(1) ?? '');

  if (subtype === 'Type0') {
    const desc = (dict.lookup(PDFName.of('DescendantFonts')) as PDFArray | undefined)?.lookup(0);
    const dd = desc instanceof PDFDict ? desc : undefined;
    const enc = dict.lookup(PDFName.of('Encoding'));
    let spaces: CMapData['spaces'] = [];
    const encBytes = streamBytes(enc);
    if (encBytes) spaces = parseCMap(new TextDecoder('latin1').decode(encBytes)).spaces;
    if (!spaces.length && cmap?.spaces.length && !enc?.toString().startsWith('/Identity')) spaces = cmap.spaces;
    const codes = splitter(spaces, 2);
    const dw = n(dd?.lookup(PDFName.of('DW'))) ?? 1000;
    const widths = new Map<number, number>();
    const w = dd?.lookup(PDFName.of('W'));
    if (w instanceof PDFArray) {
      const a = w.asArray().map((x) => dd!.context.lookup(x));
      for (let i = 0; i < a.length; ) {
        const first = n(a[i]);
        if (first === undefined) break;
        const next = a[i + 1];
        if (next instanceof PDFArray) {
          next.asArray().forEach((x, k) => widths.set(first + k, n(dd!.context.lookup(x)) ?? dw));
          i += 2;
        } else {
          const last = n(next) ?? first;
          const wv = n(a[i + 2]) ?? dw;
          for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, wv);
          i += 3;
        }
      }
    }
    const reverse = new Map<string, number>();
    cmap?.map.forEach((u, c) => !reverse.has(u) && reverse.set(u, c));
    const m = descriptorMetrics(dd?.lookup(PDFName.of('FontDescriptor')));
    return {
      key, subtype, baseFont, used, ...m,
      codes,
      width: (c) => (widths.get(c) ?? dw) / 1000,
      unicode: (c) => cmap?.map.get(c) ?? '',
      encode: (text) => {
        const out: number[] = [];
        for (const ch of text) {
          const c = reverse.get(ch);
          if (c === undefined) return null;
          out.push((c >> 8) & 255, c & 255);
        }
        return Uint8Array.from(out);
      },
    };
  }

  // Simple fonts (Type1, TrueType, Type3, MMType1).
  const t = buildTables();
  const std = stdFont(baseFont);
  const names: string[] = [];
  const isSymbolic = /Symbol|Dingbats/.test(baseFont);
  const baseNames = baseFont === 'Symbol' ? t.symbol.code2name : baseFont === 'ZapfDingbats' ? t.zapf.code2name : t.standard;
  const encEntry = dict.lookup(PDFName.of('Encoding'));
  const applyBase = (nm?: string) => {
    const src = nm === 'WinAnsiEncoding' ? t.winAnsi.code2name : nm === 'MacRomanEncoding' ? t.winAnsi.code2name.slice(0, 128) : baseNames;
    for (let c = 0; c < 256; c++) if (src[c]) names[c] = src[c];
  };
  if (encEntry instanceof PDFName) applyBase(encEntry.toString().slice(1));
  else if (encEntry instanceof PDFDict) {
    applyBase(encEntry.lookup(PDFName.of('BaseEncoding'))?.toString().slice(1));
    const diffs = encEntry.lookup(PDFName.of('Differences'));
    if (diffs instanceof PDFArray) {
      let code = 0;
      for (const item of diffs.asArray()) {
        const v = encEntry.context.lookup(item);
        if (v instanceof PDFNumber) code = v.asNumber();
        else if (v instanceof PDFName) names[code++] = v.toString().slice(1);
      }
    }
  } else applyBase(undefined);

  const firstChar = n(dict.lookup(PDFName.of('FirstChar'))) ?? 0;
  const wArr = dict.lookup(PDFName.of('Widths'));
  const widths = wArr instanceof PDFArray ? wArr.asArray().map((x) => n(dict.context.lookup(x)) ?? 0) : undefined;
  const fm = dict.lookup(PDFName.of('FontMatrix'));
  const fmScale = subtype === 'Type3' && fm instanceof PDFArray ? n(fm.lookup(0)) ?? 0.001 : 0.001;
  const m = descriptorMetrics(dict.lookup(PDFName.of('FontDescriptor')));
  const embedded = (() => {
    const fd = dict.lookup(PDFName.of('FontDescriptor'));
    return fd instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => fd.has(PDFName.of(k)));
  })();
  const uni = (c: number) => cmap?.map.get(c) ?? (names[c] ? glyphNameToUnicode(names[c]) : isSymbolic ? '' : c >= 32 && c < 127 ? String.fromCharCode(c) : '');
  const reverse = new Map<string, number>();
  for (let c = 0; c < 256; c++) {
    const u = uni(c);
    if (u && !reverse.has(u)) reverse.set(u, c);
  }
  return {
    key, subtype, baseFont, used, ascent: m.ascent, descent: m.descent,
    codes: (bytes) => Array.from(bytes, (code) => ({ code, len: 1 })),
    width: (c) => {
      const w = widths && c >= firstChar && c - firstChar < widths.length ? widths[c - firstChar] : undefined;
      if (w !== undefined) return w * fmScale;
      const g = names[c] && std?.getWidthOfGlyph(names[c]);
      if (typeof g === 'number') return g / 1000;
      return (m.missing ?? 500) / 1000;
    },
    unicode: uni,
    encode: (text) => {
      const out: number[] = [];
      for (const ch of text) {
        const c = reverse.get(ch);
        if (c === undefined) return null;
        // An embedded subset may lack glyphs that were never used on the page.
        if (embedded && subset && !used.has(c)) return null;
        out.push(c);
      }
      return Uint8Array.from(out);
    },
  };
}
