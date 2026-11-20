/**
 * Spell checking for the interface: the dictionaries live in a worker
 * (spellWorker.ts) that starts with the first check. The personal dictionary
 * (words added with "Add to dictionary") is kept in this browser.
 */
import type { SpellLang } from './checker';
import type { SpellReply, SpellRequest, WordAt } from './protocol';

export type { SpellLang } from './checker';
export type { WordAt } from './protocol';

const KEY = 'pdf-xploder.spell.words';

export function personalWords(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((w): w is string => typeof w === 'string') : [];
  } catch {
    return [];
  }
}

function savePersonal(words: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(words));
  } catch {
    /* storage unavailable: the word is known for this visit */
  }
}

let worker: Worker | null = null;
let seq = 0;
let sentPersonal = false;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

type Body = SpellRequest extends infer R ? (R extends SpellRequest ? Omit<R, 'id' | 'personal'> : never) : never;

function call<T>(body: Body): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./spellWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SpellReply>) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (e.data.ok) p?.resolve(e.data.result);
      else p?.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('The spell checker could not start.'));
      pending.clear();
      worker?.terminate();
      worker = null;
      sentPersonal = false;
    };
  }
  const id = ++seq;
  const msg = { ...body, id, ...(sentPersonal ? {} : { personal: personalWords() }) } as SpellRequest;
  sentPersonal = true;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker!.postMessage(msg);
  });
}

/** For each word, whether it is spelt correctly. */
export const checkWords = (lang: SpellLang, words: WordAt[]) => call<boolean[]>({ type: 'check', lang, words });

/** Corrections for a word, best first. */
export const suggestions = (lang: SpellLang, word: string) => call<string[]>({ type: 'suggest', lang, word });

/** Add a word to the personal dictionary (all languages). */
export async function addWord(word: string): Promise<void> {
  const words = personalWords();
  if (!words.includes(word)) savePersonal([...words, word]);
  await call<null>({ type: 'add', word });
}
