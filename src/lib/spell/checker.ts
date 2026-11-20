/**
 * Spell checking with Hunspell dictionaries (nspell), plus what nspell lacks for
 * German: words joined into compounds ("Haustürschlüssel", "Reparaturauftrag").
 * Pure functions on the dictionary text, so it runs in the spell worker and in tests.
 */
import nspell from 'nspell';
import { DIGIT, type SpellLang } from './text';

export { guessLanguage, spellLangFor, words, SPELL_LANGS, type SpellLang, type WordToken } from './text';

/** Words the dictionaries lack that are common in documents about software. */
const EXTRA: Record<SpellLang, string[]> = {
  'en-US': ['Ctrl', 'Cmd', 'Esc', 'online', 'offline', 'email', 'emails', 'app', 'apps'],
  'en-GB': ['Ctrl', 'Cmd', 'Esc', 'greyscale', 'online', 'offline', 'email', 'emails', 'app', 'apps'],
  de: ['Strg', 'Ctrl', 'Cmd', 'Esc', 'Tab', 'Tabs', 'App', 'Apps', 'online', 'offline', 'E-Mail', 'E-Mails', 'Browser'],
};

/** Fugen elements between the parts of German compounds ("Arbeit-s-zeit", "Blume-n-topf"). */
const LINKS = ['s', 'es', 'n', 'en', 'er', 'e', 'ens'];
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const lower = (w: string) => w.charAt(0).toLowerCase() + w.slice(1);

/**
 * The dictionary without its entries for word parts that only occur inside compounds
 * (ONLYINCOMPOUND). nspell merges every entry of a word, so "ändern/SJozm" (a part)
 * would also make the verb "ändern" wrong.
 */
function withoutCompoundParts(aff: string, dic: string): string {
  const flag = /^ONLYINCOMPOUND\s+(\S)/m.exec(aff)?.[1];
  if (!flag) return dic;
  return dic
    .split('\n')
    .filter((line) => {
      const slash = line.indexOf('/');
      return slash < 0 || !line.slice(slash + 1).split(/\s/)[0].includes(flag);
    })
    .join('\n');
}

export interface Checker {
  readonly lang: SpellLang;
  /** Whether a word (a token from `words`) is spelt correctly. */
  correct(word: string, next?: string): boolean;
  /** Up to `max` corrections, best first. */
  suggest(word: string, max?: number): string[];
  /** Accept a word from now on (personal dictionary). */
  add(word: string): void;
}

export function createChecker(lang: SpellLang, aff: string, dic: string, personal: string[] = []): Checker {
  const sp = nspell(aff, withoutCompoundParts(aff, dic));
  for (const w of [...EXTRA[lang], ...personal]) sp.add(w);
  const memo = new Map<string, boolean>();
  const known = (w: string) => sp.correct(w);

  /** A German compound of known words, e.g. "Werkstatt" + "rechnung". */
  const compound = (w: string, depth = 0): boolean => {
    if (lang !== 'de' || w.length < 6 || w.length > 60 || depth > 4) return false;
    for (let i = w.length - 3; i >= 3; i--) {
      const tail = w.slice(i);
      const tailOk = known(tail) || known(cap(tail)) || compound(cap(tail), depth + 1);
      if (!tailOk) continue;
      const head = w.slice(0, i);
      if (part(head)) return true;
      for (const l of LINKS) if (head.length - l.length >= 3 && head.endsWith(l) && part(head.slice(0, -l.length))) return true;
    }
    return false;
  };
  /** A first or middle part: a word, or a compound itself. Verbs give their stem ("Wasch-maschine"). */
  const part = (h: string) => known(h) || known(cap(h)) || known(lower(h)) || known(lower(h) + 'en') || known(lower(h) + 'n') || compound(cap(h), 1);

  const correct = (word: string, next = ''): boolean => {
    const w = word.replace(/’/g, "'");
    const key = next === '.' ? w + '.' : w;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let ok = known(w) || (next === '.' && known(w + '.')) || compound(w);
    // Separable verbs with "zu" inside: "abzunutzen" (abnutzen), "anzurufen".
    if (!ok && lang === 'de') {
      for (let i = w.indexOf('zu', 2); i > 0 && !ok; i = w.indexOf('zu', i + 1)) ok = w.length - i > 4 && known(w.slice(0, i) + w.slice(i + 2));
    }
    // Compounds with an abbreviation at the end: "Kundennr." (Kunden + Nr.).
    if (!ok && lang === 'de' && next === '.') {
      for (let i = w.length - 2; i >= 3 && !ok; i--) ok = known(cap(w.slice(i)) + '.') && part(w.slice(0, i));
    }
    // English possessives the dictionary has no form for ("workshop's").
    if (!ok && lang !== 'de' && /'s$/i.test(w)) ok = correct(w.slice(0, -2));
    // Hyphenated words: every part on its own ("Kfz-Werkstatt", "well-known").
    if (!ok && w.includes('-')) ok = w.split('-').every((p) => p.length < 2 || DIGIT.test(p) || p === p.toUpperCase() || correct(p));
    memo.set(key, ok);
    return ok;
  };

  const suggest = (word: string, max = 6): string[] => {
    const w = word.replace(/’/g, "'");
    const found = new Set<string>(w.length <= 30 ? sp.suggest(w) : []);
    // A misspelt last part of a compound: "Reparaturauftarg" → "Reparatur" + "auftrag".
    if (lang === 'de' && found.size < max && w.length >= 8) {
      for (let i = w.length - 4; i >= 3 && found.size < max; i--) {
        const head = w.slice(0, i);
        if (!(known(head) || known(cap(head)))) continue;
        for (const s of sp.suggest(cap(w.slice(i)))) if (s.length > 2) found.add(head + lower(s));
      }
    }
    // Keep the case of the word: a capitalised word gets capitalised suggestions.
    const fix = (s: string) => (w[0] === w[0].toUpperCase() ? cap(s) : s);
    return [...new Set([...found].map(fix))].filter((s) => s !== w).slice(0, max);
  };

  return {
    lang,
    correct,
    suggest,
    add: (w) => {
      sp.add(w);
      memo.clear();
    },
  };
}

