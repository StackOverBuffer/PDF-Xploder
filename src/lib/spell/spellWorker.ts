/**
 * Background thread for spell checking: a dictionary takes up to a second to read
 * and tens of megabytes, so neither happens on the main thread or before the first
 * check. Each dictionary is a separate download, fetched only when it is needed.
 */
import { createChecker, type Checker, type SpellLang } from './checker';
import type { SpellReply, SpellRequest } from './protocol';

const FILES: Record<SpellLang, () => Promise<{ aff: string; dic: string }>> = {
  'en-US': () => import('./dict/dict-en-US'),
  'en-GB': () => import('./dict/dict-en-GB'),
  de: () => import('./dict/dict-de'),
};

const checkers = new Map<SpellLang, Promise<Checker>>();
let personal: string[] = [];

function checker(lang: SpellLang): Promise<Checker> {
  let c = checkers.get(lang);
  if (!c) {
    c = FILES[lang]().then(({ aff, dic }) => createChecker(lang, aff, dic, personal));
    checkers.set(lang, c);
    c.catch(() => checkers.get(lang) === c && checkers.delete(lang));
  }
  return c;
}

async function handle(r: SpellRequest): Promise<unknown> {
  if (r.personal) personal = r.personal;
  switch (r.type) {
    case 'check': {
      const c = await checker(r.lang);
      return r.words.map(([w, next]) => c.correct(w, next));
    }
    case 'suggest':
      return (await checker(r.lang)).suggest(r.word);
    case 'add':
      for (const c of checkers.values()) (await c).add(r.word);
      return null;
  }
}

self.onmessage = async (e: MessageEvent<SpellRequest>) => {
  const post = (m: SpellReply) => (self as unknown as Worker).postMessage(m);
  try {
    post({ id: e.data.id, ok: true, result: await handle(e.data) });
  } catch (err) {
    post({ id: e.data.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
