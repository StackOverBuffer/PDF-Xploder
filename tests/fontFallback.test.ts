import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFDict } from '@cantoo/pdf-lib';
import { createTextEngine, setFontSource, type FontSource } from '../src/lib/fonts';

// The chain fonts come from disk like tests/setup.ts does, the handwriting fonts as the woff
// files @fontsource ships; the CJK/KR fonts stay unavailable, i.e. offline.
const FILES: Record<string, string> = {
  sans: 'public/fonts/NotoSans-Regular.ttf',
  sansBold: 'public/fonts/NotoSans-Bold.ttf',
  symbols: 'public/fonts/NotoSansSymbols2-Regular.ttf',
  dancingLatin: 'node_modules/@fontsource/dancing-script/files/dancing-script-latin-400-normal.woff',
  dancingLatinExt: 'node_modules/@fontsource/dancing-script/files/dancing-script-latin-ext-400-normal.woff',
  greatVibesLatin: 'node_modules/@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff',
  greatVibesLatinExt: 'node_modules/@fontsource/great-vibes/files/great-vibes-latin-ext-400-normal.woff',
  caveatLatin: 'node_modules/@fontsource/caveat/files/caveat-latin-400-normal.woff',
  caveatLatinExt: 'node_modules/@fontsource/caveat/files/caveat-latin-ext-400-normal.woff',
  alluraLatin: 'node_modules/@fontsource/allura/files/allura-latin-400-normal.woff',
  alluraLatinExt: 'node_modules/@fontsource/allura/files/allura-latin-ext-400-normal.woff',
};
const served: string[] = [];
const source: FontSource = async (key) => {
  served.push(key);
  const path = FILES[key];
  return path ? new Uint8Array(readFileSync(path)) : null;
};
/** Fresh caches per test, so every test sees exactly the fonts its engine asked for. */
const reset = () => {
  served.length = 0;
  setFontSource(source);
};

const baseFonts = (doc: PDFDocument) =>
  doc.context.enumerateIndirectObjects().flatMap(([, o]) =>
    o instanceof PDFDict && o.get(PDFName.of('Type'))?.toString() === '/Font' ? [(o.get(PDFName.of('BaseFont')) as PDFName).decodeText()] : [],
  );

describe('last-resort fonts for uncovered characters', () => {
  it('loads no last-resort font while the chain covers the text', async () => {
    reset();
    const doc = await PDFDocument.create();
    await createTextEngine(doc, ['Hello']);
    expect(served).toEqual(['sans']);
  });

  it('draws a character the chain lacks with the bundled font that has it', async () => {
    reset();
    const doc = await PDFDocument.create();
    // U+2215 DIVISION SLASH: no chain font has it, the handwriting fonts do.
    const engine = await createTextEngine(doc, ['a∕b']);
    // One run per font: the slash is drawn from Dancing Script, not degraded to '?'.
    expect(engine.runs('a∕b').map((r) => r.text)).toEqual(['a', '∕', 'b']);
    expect(engine.width('a∕b', 10)).toBeGreaterThan(0);
    const loaded = await PDFDocument.load(await doc.save());
    const fonts = baseFonts(loaded);
    expect(fonts.filter((n) => n.endsWith('NotoSans-Regular'))).toHaveLength(2); // Type0 + CID descendant
    expect(fonts.filter((n) => n.endsWith('DancingScript-Regular'))).toHaveLength(2);
    for (const n of fonts) expect(n).toMatch(/^[A-Z]{6}\+/);
  });

  it('stops the search as soon as a font covers the missing characters', async () => {
    reset();
    const doc = await PDFDocument.create();
    await createTextEngine(doc, ['∕']);
    // The chain is probed while characters are missing; the search ends at the first donor
    // that has the character — none of the later handwriting fonts are even loaded.
    expect(served).toEqual(['sans', 'symbols', 'cjk', 'kr', 'dancingLatin']);
  });

  it('keeps the ? fallback when no bundled font has the character', async () => {
    reset();
    const doc = await PDFDocument.create();
    const engine = await createTextEngine(doc, ['你好']);
    expect(engine.runs('你好').map((r) => r.text).join('')).toBe('??');
    // Every last-resort font was tried before giving up.
    expect(served.slice(-8)).toEqual([
      'dancingLatin', 'dancingLatinExt', 'greatVibesLatin', 'greatVibesLatinExt',
      'caveatLatin', 'caveatLatinExt', 'alluraLatin', 'alluraLatinExt',
    ]);
  });
});
