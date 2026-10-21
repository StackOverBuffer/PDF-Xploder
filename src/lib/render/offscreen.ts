/**
 * Drawing pages in a background thread (experimental). pdf.js parses in its own worker
 * but paints on the main thread, so a complex plan blocks scrolling for a quarter
 * second or more per piece. Documents whose pages are slow to draw get a second pdf.js
 * instance in renderWorker.ts, which paints into an OffscreenCanvas; the picture comes
 * back as an ImageBitmap and is shown without redrawing. Light documents stay on the
 * main thread (the second copy costs memory and a parse), and so does anything the
 * worker cannot draw correctly.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { RenderReply, RenderRequest, RenderResult } from './protocol';
import { usePrefs } from '../prefs';

/** A page that took longer than this to draw on the main thread moves its document to the worker. */
export const SLOW_RENDER_MS = 120;
/** Documents kept open in the worker (the current one and the one before, e.g. across an edit). */
const KEEP = 2;

const sources = new WeakMap<PDFDocumentProxy, { bytes: Uint8Array; password?: string }>();
/** Documents drawn in the worker, by their id there; and documents it cannot draw. */
const inWorker = new Map<PDFDocumentProxy, string>();
const mainOnly = new WeakSet<PDFDocumentProxy>();

let worker: Worker | null = null;
let failed = false;
let seq = 0;
let docSeq = 0;
const pending = new Map<number, (r: RenderResult) => void>();

const setting = () => usePrefs.getState().backgroundDrawing;

export function offscreenEnabled(): boolean {
  return setting() !== 'off';
}

// Turned off: documents in the worker are closed there (their pages are drawn here again).
usePrefs.subscribe((p, prev) => {
  if (p.backgroundDrawing === 'off' && prev.backgroundDrawing !== 'off') for (const pdf of [...inWorker.keys()]) drop(pdf);
});

const supported = () => typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined' && typeof createImageBitmap !== 'undefined';

function getWorker(): Worker | null {
  if (worker || failed) return worker;
  if (!supported()) {
    failed = true;
    return null;
  }
  try {
    worker = new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    failed = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<RenderReply>) => {
    if ('got' in e.data) {
      opening.delete(e.data.got);
      return;
    }
    if ('need' in e.data) {
      const data = opening.get(e.data.need);
      opening.delete(e.data.need);
      if (data) send(worker!, { type: 'data', doc: e.data.need, data });
      return;
    }
    const done = pending.get(e.data.id);
    pending.delete(e.data.id);
    done?.(e.data);
  };
  worker.onerror = (e) => {
    // Could not start (or crashed): everything is drawn on the main thread again.
    e.preventDefault?.();
    worker?.terminate();
    worker = null;
    failed = true;
    inWorker.clear();
    for (const done of pending.values()) done({ id: -1, ok: false, error: 'fallback' });
    pending.clear();
  };
  return worker;
}

const send = (w: Worker, m: RenderRequest, transfer: Transferable[] = []) => w.postMessage(m, transfer);

/** Hands a document the editing worker holds to a port (worker/index.ts); false if it holds none. */
let sharer: (bytes: Uint8Array, port: MessagePort) => boolean = () => false;
export function setDocumentSharer(f: typeof sharer) {
  sharer = f;
}
/** Bytes of the documents being opened in the worker, in case the editing worker no longer has them. */
const opening = new Map<string, Uint8Array>();

function drop(pdf: PDFDocumentProxy) {
  const id = inWorker.get(pdf);
  inWorker.delete(pdf);
  if (id) opening.delete(id);
  if (id && worker) send(worker, { type: 'close', doc: id });
}

/** The bytes a document was opened from (see openPdf), so the worker can open it too. */
export function rememberSource(pdf: PDFDocumentProxy, bytes: Uint8Array, password?: string) {
  sources.set(pdf, { bytes, password });
  // A closed document is closed in the worker too.
  const destroy = pdf.destroy.bind(pdf);
  pdf.destroy = () => {
    drop(pdf);
    return destroy();
  };
}

/** `next` replaces `prev` (an edit, undo): a document drawn in the worker stays there without a slow page first. */
export function inheritOffscreen(prev: PDFDocumentProxy | null | undefined, next: PDFDocumentProxy) {
  if (prev && prev !== next && drawsOffscreen(prev)) openInWorker(next);
}

/** A page of `pdf` took `ms` to draw on the main thread: slow documents move to the worker. */
export function noteMainRender(pdf: PDFDocumentProxy, ms: number) {
  if (ms >= SLOW_RENDER_MS || setting() === 'always') openInWorker(pdf);
}

function openInWorker(pdf: PDFDocumentProxy): string | null {
  const known = inWorker.get(pdf);
  if (known) return known;
  const src = sources.get(pdf);
  if (!offscreenEnabled() || mainOnly.has(pdf) || !src) return null;
  const w = getWorker();
  if (!w) return null;
  const doc = `d${++docSeq}`;
  inWorker.set(pdf, doc);
  const base = new URL(import.meta.env.BASE_URL, location.href).href;
  // Usually the editing worker holds the document too and sends it over: copying a big
  // file here would block this thread for a moment. Otherwise it is copied here (the
  // caller keeps its bytes: undo history, saving).
  const channel = new MessageChannel();
  if (sharer(src.bytes, channel.port1)) {
    opening.set(doc, src.bytes);
    send(w, { type: 'open', doc, port: channel.port2, password: src.password, base }, [channel.port2]);
  } else {
    send(w, { type: 'open', doc, data: src.bytes, password: src.password, base });
  }
  while (inWorker.size > KEEP) drop(inWorker.keys().next().value!);
  return doc;
}

/** Whether pages of `pdf` are drawn in the worker. */
export function drawsOffscreen(pdf: PDFDocumentProxy): boolean {
  return offscreenEnabled() && inWorker.has(pdf) && !mainOnly.has(pdf) && !!worker;
}

export interface OffscreenRequest {
  page: number;
  scale: number;
  rotation: number;
  offsetX?: number;
  offsetY?: number;
  width: number;
  height: number;
  /** Leave form fields off (the page view shows them as HTML controls). */
  noForms?: boolean;
}

/**
 * Renders sent to the worker at a time. More would only interleave there (and each
 * finishes later); queued here, a page in the view goes ahead of thumbnails, and
 * thumbnails (a first look at each page: slow) never take every place.
 */
const MAX_ACTIVE = 2;
const MAX_BACKGROUND = 1;
const active = [0, 0];
let queued: { priority: number; seq: number; start: () => void }[] = [];

function pump() {
  queued.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  for (const q of [...queued]) {
    const low = q.priority > 0 ? 1 : 0;
    if (active[0] + active[1] >= MAX_ACTIVE) break;
    if (low && active[1] >= MAX_BACKGROUND) continue;
    active[low]++;
    queued = queued.filter((x) => x !== q);
    q.start();
  }
}

/**
 * Draw a page (or a piece of it) in the worker; `priority` as in renderQueue.ts. Resolves
 * to the picture on a canvas, or null when the worker cannot draw this document (draw it
 * on the main thread then).
 */
export function drawOffscreen(pdf: PDFDocumentProxy, r: OffscreenRequest, priority = 0): { promise: Promise<HTMLCanvasElement | null>; cancel(): void } {
  if (!drawsOffscreen(pdf)) return { promise: Promise.resolve(null), cancel() {} };
  const id = ++seq;
  let state: 'queued' | 'sent' | 'done' = 'queued';
  let finish: (r: RenderResult) => void = () => {};
  const entry = { priority, seq: id, start: () => {} };
  const promise = new Promise<HTMLCanvasElement | null>((resolve, reject) => {
    finish = (reply) => {
      if (state === 'done') return;
      if (state === 'sent') {
        active[priority > 0 ? 1 : 0]--;
        pump();
      }
      state = 'done';
      if (reply.ok) {
        const canvas = document.createElement('canvas');
        canvas.width = reply.bitmap.width;
        canvas.height = reply.bitmap.height;
        // Shown as is: no copy, no redraw on this thread.
        canvas.getContext('bitmaprenderer')!.transferFromImageBitmap(reply.bitmap);
        resolve(canvas);
      } else if (reply.error === 'cancelled') {
        reject(Object.assign(new Error('Rendering cancelled'), { name: 'RenderingCancelledException' }));
      } else {
        // The worker cannot draw it correctly: this document stays on the main thread.
        if (inWorker.has(pdf)) {
          mainOnly.add(pdf);
          drop(pdf);
        }
        resolve(null);
      }
    };
  });
  entry.start = () => {
    const doc = inWorker.get(pdf);
    state = 'sent';
    if (!doc || !worker || !drawsOffscreen(pdf)) return finish({ id, ok: false, error: 'fallback' });
    pending.set(id, finish);
    send(worker, { type: 'render', id, doc, page: r.page, scale: r.scale, rotation: r.rotation, offsetX: r.offsetX ?? 0, offsetY: r.offsetY ?? 0, noForms: !!r.noForms, width: r.width, height: r.height });
  };
  queued.push(entry);
  pump();
  return {
    promise,
    cancel: () => {
      if (state === 'queued') {
        queued = queued.filter((q) => q !== entry);
        finish({ id, ok: false, error: 'cancelled' });
      } else if (state === 'sent' && worker) send(worker, { type: 'cancel', id });
    },
  };
}
