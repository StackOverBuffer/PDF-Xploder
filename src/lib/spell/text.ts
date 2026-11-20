/**
 * Words of a text and which dictionary fits it: small helpers the interface uses
 * without loading a dictionary (see checker.ts for the checking itself).
 */
export type SpellLang = 'en-US' | 'en-GB' | 'de';
export const SPELL_LANGS: SpellLang[] = ['en-US', 'en-GB', 'de'];

/** The dictionary for a language tag ("de-AT", "en", "en-GB"), or null if there is none. */
export function spellLangFor(tag: string | null | undefined): SpellLang | null {
  const t = (tag ?? '').trim().toLowerCase().replace('_', '-');
  if (/^de\b/.test(t)) return 'de';
  if (/^en-(gb|uk|ie|au|nz|za|in)\b/.test(t)) return 'en-GB';
  if (/^en\b/.test(t)) return 'en-US';
  return null;
}

/** A word of a text and where it starts. */
export interface WordToken {
  word: string;
  start: number;
}

const LETTER = /\p{L}/u;
export const DIGIT = /\p{N}/u;
/** Letters (with combining marks) and digits, joined by apostrophes or hyphens. */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;

/**
 * The words of a text worth checking: no numbers or words with digits, no single
 * letters, no words in capitals or with capitals inside (abbreviations and
 * names like "PDF", "GmbH" or "iPhone"), nothing in web or e-mail addresses.
 */
export function words(text: string): WordToken[] {
  const out: WordToken[] = [];
  for (const m of text.matchAll(WORD)) {
    const word = m[0];
    const start = m.index!;
    const before = text[start - 1] ?? '';
    const after = text[start + word.length] ?? '';
    if (DIGIT.test(word) || [...word].filter((c) => LETTER.test(c)).length < 2) continue;
    // Capitals inside a part: "GmbH", "iPhone", "PDFs" (but "Kfz-Werkstatt" is checked).
    if (word.split(/['’-]/).some((p) => /\p{Lu}/u.test(p.slice(1)))) continue;
    // Addresses: user@host.de, www.example.com, https://…, paths.
    if (/[@/\\_.:]/.test(before) && /[@/\\._]/.test(text.slice(Math.max(0, start - 2), start))) continue;
    if (text.startsWith('://', start + word.length) || after === '@' || after === '_' || after === '/' || (after === '.' && LETTER.test(text[start + word.length + 1] ?? ''))) continue;
    out.push({ word, start });
  }
  return out;
}

/** Short words that only occur in one of the languages, to guess a text's language. */
const COMMON: Record<'en' | 'de', Set<string>> = {
  en: new Set('the and of to is are you your with for this that be on it not have was from by we will can at or'.split(' ')),
  de: new Set('der die das und ist sind sie ihr mit für dies nicht ein eine einen wir wird kann auf oder zu den dem bitte sehr'.split(' ')),
};

/** The language a text is most likely in, or null if it cannot be told. */
export function guessLanguage(text: string): 'en' | 'de' | null {
  const score = { en: 0, de: 0 };
  for (const m of text.toLowerCase().matchAll(/\p{L}+/gu)) for (const l of ['en', 'de'] as const) if (COMMON[l].has(m[0])) score[l]++;
  if (score.en === score.de) return null;
  return score.en > score.de ? 'en' : 'de';
}
