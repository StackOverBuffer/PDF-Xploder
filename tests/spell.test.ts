import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createChecker, guessLanguage, spellLangFor, words, type SpellLang } from '../src/lib/spell/checker';
import { SAMPLE_TEXT } from '../src/lib/sampleText';
import { pageWords } from '../src/lib/spell/pageWords';

const PKG: Record<SpellLang, string> = { 'en-US': 'dictionary-en', 'en-GB': 'dictionary-en-gb', de: 'dictionary-de' };
const dict = (l: SpellLang) => [readFileSync(`node_modules/${PKG[l]}/index.aff`, 'utf8'), readFileSync(`node_modules/${PKG[l]}/index.dic`, 'utf8')] as const;
const checkers = { 'en-US': createChecker('en-US', ...dict('en-US')), 'en-GB': createChecker('en-GB', ...dict('en-GB')), de: createChecker('de', ...dict('de')) };

/** Every string in an object, deeply. */
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : typeof v === 'function' ? [] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
const wrong = (l: SpellLang, text: string) => [...new Set(words(text).filter((t) => !checkers[l].correct(t.word, text[t.start + t.word.length])).map((t) => t.word))];

describe('words', () => {
  it('skips numbers, capitals, addresses and single letters', () => {
    const text = 'Order 4711 from ACME GmbH, see https://example.com/page or mail info@shop.de, a x2 iPhone Kfz-Werkstatt don’t.';
    expect(words(text).map((t) => t.word)).toEqual(['Order', 'from', 'see', 'or', 'mail', 'Kfz-Werkstatt', 'don’t']);
  });
  it('gives each word’s position', () => {
    expect(words('Hello  world')).toEqual([{ word: 'Hello', start: 0 }, { word: 'world', start: 7 }]);
  });
});

describe('spell checker', () => {
  it('finds the planted mistake in the sample and nothing else but names', () => {
    expect(wrong('en-GB', strings(SAMPLE_TEXT.en).join('\n'))).toContain('recieve');
    expect(wrong('de', strings(SAMPLE_TEXT.de).join('\n'))).toContain('könen');
    // Names of people, streets and products are not in the dictionaries; every other word is.
    const names = /^(Theo|Kranich|Mühlenweg|Elsterfeld|Albrecht|Lindenstraße|Brandner|Medeo|Shimano|Presta|Mara|Ines|Gazelle-Trekkingrad|Trekkingrad|E-Bike|Arrow|gelängt)$/;
    expect(wrong('en-GB', strings(SAMPLE_TEXT.en).join('\n')).filter((w) => !names.test(w))).toEqual(['recieve']);
    expect(wrong('de', strings(SAMPLE_TEXT.de).join('\n')).filter((w) => !names.test(w))).toEqual(['könen']);
  });

  it('suggests the right word first', () => {
    expect(checkers['en-GB'].suggest('recieve')[0]).toBe('receive');
    expect(checkers.de.suggest('könen')[0]).toBe('können');
    expect(checkers.de.suggest('Reparaturauftarg')).toContain('Reparaturauftrag');
  });

  it('knows German verbs, compounds and abbreviations', () => {
    const de = checkers.de;
    for (const w of ['ändern', 'löschen', 'macht', 'geben', 'Haustürschlüssel', 'Reparaturauftrag', 'Werkstattrechnung', 'Arbeitszeit', 'abzunutzen', 'Kfz-Werkstatt']) expect(de.correct(w), w).toBe(true);
    expect(de.correct('Kundennr', '.')).toBe(true);
    for (const w of ['könen', 'Rechnug', 'Reperatur', 'gehn']) expect(de.correct(w), w).toBe(false);
  });

  it('tells US and UK spelling apart', () => {
    expect(checkers['en-US'].correct('color')).toBe(true);
    expect(checkers['en-GB'].correct('colour')).toBe(true);
    expect(checkers['en-US'].correct('colour')).toBe(false);
    expect(checkers['en-GB'].correct("workshop's")).toBe(true);
  });

  it('accepts added words', () => {
    const c = createChecker('en-US', ...dict('en-US'), ['Xploder']);
    expect(c.correct('Xploder')).toBe(true);
    expect(c.correct('Kranich')).toBe(false);
    c.add('Kranich');
    expect(c.correct('Kranich')).toBe(true);
  });
});

describe('languages', () => {
  it('maps language tags to dictionaries', () => {
    expect(spellLangFor('de-AT')).toBe('de');
    expect(spellLangFor('en-GB')).toBe('en-GB');
    expect(spellLangFor('EN')).toBe('en-US');
    expect(spellLangFor('fr-FR')).toBeNull();
  });
  it('guesses a text’s language', () => {
    expect(guessLanguage('Bitte bringen Sie das Rad mit und den Schlüssel')).toBe('de');
    expect(guessLanguage('Please bring the bike and the key with you')).toBe('en');
    expect(guessLanguage('1234')).toBeNull();
  });
});

describe('page words', () => {
  const measure = (s: string) => s.length;
  const run = (str: string, x: number, y: number, h = 10) => ({ str, rect: { x, y, w: str.length * 5, h } });
  it('joins runs that touch and gives each word its box', () => {
    const ws = pageWords([run('Repa', 0, 100), run('ratur und', 20, 100)], measure);
    expect(ws.map((w) => w.word)).toEqual(['Reparatur', 'und']);
    expect(ws[0].rect).toEqual({ x: 0, y: 100, w: 45, h: 10 });
    expect(ws[1].rect.x).toBe(50);
  });
  it('checks words hyphenated at the end of a line whole', () => {
    const ws = pageWords([run('the work-', 0, 100), run('shop is open', 0, 85)], measure);
    expect(ws.map((w) => [w.word, !!w.split])).toEqual([['the', false], ['workshop', true], ['is', false], ['open', false]]);
  });
  it('keeps runs apart that do not touch', () => {
    expect(pageWords([run('Hallo', 0, 100), run('Welt', 40, 100)], measure).map((w) => w.word)).toEqual(['Hallo', 'Welt']);
  });
});
