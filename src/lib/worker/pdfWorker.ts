/**
 * Background thread for whole-document operations (pdf-lib parses and saves the
 * entire file: seconds for a big plan, which would freeze the interface).
 */
import * as ops from '../pdfOps';
import * as org from '../organize';
import * as sec from '../security';
import * as content from '../content/ops';
import * as db from '../sessionDb';
import { useLang, type Lang } from '../i18n';
import { MISSING_REF, REF, transferables, type Reply, type ShareRequest, type WorkerModule } from './protocol';

const modules: Record<WorkerModule, Record<string, unknown>> = { ops, org, sec, content, db };

/**
 * The last documents sent here or produced here, by key, so the next operation on
 * them needs no copy from the main thread (see index.ts). Two: the current version
 * and the one before it (an operation reads one and makes the next).
 */
const KEEP = 2;
const held = new Map<string, Uint8Array>();
let produced = 0;

function hold(key: string, bytes: Uint8Array) {
  held.delete(key);
  held.set(key, bytes);
  while (held.size > KEEP) held.delete(held.keys().next().value!);
}

const post = (r: Reply, transfer: ArrayBuffer[] = []) => (self as unknown as Worker).postMessage(r, transfer);

self.onmessage = async (e: MessageEvent<{ id: number; mod: WorkerModule; fn: string; args: unknown[]; keys: Record<number, string>; lang: Lang } | ShareRequest>) => {
  if ('share' in e.data) {
    // Another thread wants a copy of a document held here: made on this thread and handed
    // over (a plain postMessage would copy it again where it arrives).
    const [port] = e.ports;
    const copy = held.get(e.data.share)?.slice() ?? null;
    port.postMessage(copy, copy ? [copy.buffer] : []);
    port.close();
    return;
  }
  const { id, mod, fn, keys, lang } = e.data;
  try {
    const args = e.data.args.map((a, i) => {
      const ref = a && typeof a === 'object' && REF in a ? (a as Record<string, string>)[REF] : undefined;
      if (ref !== undefined) {
        const bytes = held.get(ref);
        if (!bytes) throw new Error(MISSING_REF);
        hold(ref, bytes);
        return bytes;
      }
      if (keys?.[i] && a instanceof Uint8Array) hold(keys[i], a);
      return a;
    });
    // Labels drawn into the file (measurements) follow the interface language.
    if (useLang.getState().lang !== lang) useLang.setState({ lang });
    const f = modules[mod][fn] as (...a: unknown[]) => unknown;
    const result = await f(...args);
    // Keep a copy of each document in the result (made here, off the main thread); the
    // original goes to the main thread without copying. A result that is a held
    // document itself is replaced by a copy in the cache before it is handed over.
    const resultKeys: Record<string, string> = {};
    const keep = (bytes: unknown, path: string) => {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1024) return;
      for (const [k, v] of held) if (v === bytes) held.set(k, bytes.slice());
      const k = `w${++produced}`;
      hold(k, bytes.slice());
      resultKeys[path] = k;
    };
    keep(result, '');
    if (result && typeof result === 'object' && !(result instanceof Uint8Array)) for (const [p, v] of Object.entries(result)) keep(v, p);
    post({ id, ok: true, result, has: [...held.keys()], resultKeys }, transferables(result));
  } catch (err) {
    post({ id, ok: false, error: (err as Error)?.message ?? String(err), has: [...held.keys()] });
  }
};
