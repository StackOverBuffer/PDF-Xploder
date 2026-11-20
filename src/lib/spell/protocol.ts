import type { SpellLang } from './checker';

/** A word and the character after it (a full stop makes "Nr" an abbreviation). */
export type WordAt = [word: string, next: string];

export type SpellRequest = { id: number; personal?: string[] } & (
  | { type: 'check'; lang: SpellLang; words: WordAt[] }
  | { type: 'suggest'; lang: SpellLang; word: string }
  | { type: 'add'; word: string }
);

export type SpellReply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
