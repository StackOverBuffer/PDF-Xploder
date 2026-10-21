/**
 * Drop-in replacements for the pdfOps, organize and security modules: the heavy,
 * whole-document functions run in a background worker (the interface stays
 * responsive), everything else runs here as before. Without workers (tests) all
 * functions run directly.
 */
import * as realOps from '../pdfOps';
import * as realOrg from '../organize';
import * as realSec from '../security';
import * as realContent from '../content/ops';
import * as realDb from '../sessionDb';
import { useLang } from '../i18n';
import { MISSING_REF, REF, type Reply, type ShareRequest, type WorkerModule } from './protocol';
import { setDocumentSharer } from '../render/offscreen';

/** Functions that take and return plain data (bytes, numbers, plain objects) and do real work. */
const IN_WORKER: Record<WorkerModule, Set<string>> = {
  ops: new Set([
    'exportWithAnnotations', 'extractPages', 'deletePages', 'setFormValues', 'insertDocument', 'splitEvery', 'rotatePages', 'reorderPages',
    'cropPages', 'setMetadata', 'getMetadata', 'replacePagesWithImages', 'insertBlankPage', 'flattenFormFields', 'duplicatePages', 'addWatermark',
    'addHeaderFooter', 'getFormFields', 'importForEditing',
  ]),
  org: new Set([
    'assemblePages', 'splitBySize', 'splitByRanges', 'splitByBookmarks', 'setPageLabels', 'getPageLabels', 'resizePages', 'removePageMarks',
    'overlayPages', 'normalizePages', 'insertImagePages', 'insertBlankPages', 'findDuplicatePages', 'findBlankPages', 'addWatermarkMark',
    'addMargins', 'addHeadersFooters', 'addBates', 'addBackground',
  ]),
  sec: new Set(['encrypt', 'reencryptLike', 'decrypt', 'inspectEncryption']),
  content: new Set(['objectsOnPage', 'findMatches', 'rewriteForCheck', 'editPageContent', 'replaceInPages']),
  // The session backup: the worker usually holds the document already, so writing it there copies nothing here.
  db: new Set(['putBlob']),
};

let worker: Worker | null = null;
let failed = false;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker || failed || typeof Worker === 'undefined' || typeof document === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./pdfWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    failed = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const { has, resultKeys, result } = e.data;
    workerHas = new Set(has);
    // Documents produced by the worker: it keeps a copy, known by these keys.
    for (const [path, k] of Object.entries(resultKeys ?? {})) {
      const bytes = path ? (result as Record<string, unknown>)[path] : result;
      if (bytes instanceof Uint8Array) keyOf.set(bytes, k);
    }
    const p = pending.get(e.data.id);
    pending.delete(e.data.id);
    if (!p) return;
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    // A worker that cannot start (or crashed): finish what is pending here, and stop using it.
    e.preventDefault?.();
    worker?.terminate();
    worker = null;
    failed = true;
    for (const p of pending.values()) p.reject(new Error('retry-local'));
    pending.clear();
  };
  return worker;
}

/**
 * Documents the worker already holds: copying a big file into the worker takes the main
 * thread a second or more, so a document it has (one it was sent, or one it produced)
 * goes by reference. Keys follow the byte arrays; the worker reports what it keeps.
 */
const keyOf = new WeakMap<Uint8Array, string>();
let keySeq = 0;
let workerHas = new Set<string>();

function send(w: Worker, mod: WorkerModule, fn: string, args: unknown[], byRef: boolean): Promise<unknown> {
  const id = ++seq;
  const keys: Record<number, string> = {};
  const sent = args.map((a, i) => {
    if (!(a instanceof Uint8Array)) return a;
    let k = keyOf.get(a);
    if (k && byRef && workerHas.has(k)) return { [REF]: k };
    if (!k) keyOf.set(a, (k = `m${++keySeq}`));
    keys[i] = k;
    return a;
  });
  return new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Arguments are copied: the caller keeps its bytes (undo history, the open document).
    w.postMessage({ id, mod, fn, args: sent, keys, lang: useLang.getState().lang });
  });
}

function call(mod: WorkerModule, fn: string, args: unknown[], local: (...a: unknown[]) => unknown): Promise<unknown> {
  const w = getWorker();
  if (!w) return Promise.resolve(local(...args));
  return send(w, mod, fn, args, true)
    // The worker let go of a document meanwhile: send it in full.
    .catch((e: Error) => (e.message === MISSING_REF ? send(w, mod, fn, args, false) : Promise.reject(e)))
    .catch((e: Error) => (e.message === 'retry-local' ? local(...args) : Promise.reject(e)));
}

/**
 * A plain copy of the module with the worker functions swapped in. (Not a Proxy over
 * the module: bundled module namespaces are frozen, and a Proxy may not return
 * anything but a frozen property's own value.) Exported for tests.
 */
export function routed<T extends object>(mod: WorkerModule, real: T): T {
  const out: Record<string, unknown> = { ...(real as Record<string, unknown>) };
  for (const name of IN_WORKER[mod]) {
    const f = out[name];
    if (typeof f !== 'function') throw new Error(`${mod}.${name} is not a function`);
    out[name] = (...args: unknown[]) => call(mod, name, args, f as (...a: unknown[]) => unknown);
  }
  return out as unknown as T;
}

export const ops = routed('ops', realOps);
export const org = routed('org', realOrg);
export const sec = routed('sec', realSec);
export const content = routed('content', realContent);
export const db = routed('db', realDb);

/**
 * Send a document the worker holds to `port` (another thread), copied there instead of
 * here. False when the worker does not hold it.
 */
function shareDocument(bytes: Uint8Array, port: MessagePort): boolean {
  const k = keyOf.get(bytes);
  if (!worker || !k || !workerHas.has(k)) return false;
  const req: ShareRequest = { share: k };
  worker.postMessage(req, [port]);
  return true;
}
setDocumentSharer(shareDocument);

/**
 * A copy of a big document the worker holds, made there: pdf.js takes the bytes it is
 * given (see openPdf), and copying a big file here blocks this thread for a moment.
 * Null when the worker does not hold it, or for small files (not worth the hop).
 */
export function copyFromWorker(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (bytes.byteLength < 8_000_000) return Promise.resolve(null);
  const channel = new MessageChannel();
  if (!shareDocument(bytes, channel.port1)) return Promise.resolve(null);
  return new Promise((resolve) => {
    channel.port2.onmessage = (e: MessageEvent<Uint8Array | null>) => {
      channel.port2.close();
      resolve(e.data);
    };
  });
}

/** Start the worker ahead of time (when the browser is idle), so the first operation does not wait for it to load. */
export function warmUpWorker() {
  getWorker();
}
