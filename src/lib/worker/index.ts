/**
 * Drop-in replacements for the pdfOps, organize and security modules: the heavy,
 * whole-document functions run in a background worker (the interface stays
 * responsive), everything else runs here as before. Without workers (tests) all
 * functions run directly.
 */
import * as realOps from '../pdfOps';
import * as realOrg from '../organize';
import * as realSec from '../security';
import { useLang } from '../i18n';
import type { WorkerModule } from './protocol';

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
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
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

function call(mod: WorkerModule, fn: string, args: unknown[], local: (...a: unknown[]) => unknown): Promise<unknown> {
  const w = getWorker();
  if (!w) return Promise.resolve(local(...args));
  const id = ++seq;
  return new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Arguments are copied: the caller keeps its bytes (undo history, the open document).
    w.postMessage({ id, mod, fn, args, lang: useLang.getState().lang });
  }).catch((e: Error) => (e.message === 'retry-local' ? local(...args) : Promise.reject(e)));
}

function proxy<T extends object>(mod: WorkerModule, real: T): T {
  return new Proxy(real, {
    get(target, name: string) {
      const f = (target as Record<string, unknown>)[name];
      if (typeof f !== 'function' || !IN_WORKER[mod].has(name)) return f;
      return (...args: unknown[]) => call(mod, name, args, f as (...a: unknown[]) => unknown);
    },
  });
}

export const ops = proxy('ops', realOps);
export const org = proxy('org', realOrg);
export const sec = proxy('sec', realSec);

/** Start the worker ahead of time (when the browser is idle), so the first operation does not wait for it to load. */
export function warmUpWorker() {
  getWorker();
}
