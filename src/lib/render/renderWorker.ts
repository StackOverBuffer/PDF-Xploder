/**
 * Background thread that draws pages (see offscreen.ts): pdf.js paints into an
 * OffscreenCanvas here, and the finished picture goes back as an ImageBitmap, so a
 * complex plan no longer blocks scrolling while it is drawn.
 *
 * pdf.js expects a document for three things, which a worker provides otherwise:
 * canvases (OffscreenCanvas), fonts (the worker's own FontFaceSet; glyphs drawn as
 * paths where there is none) and SVG filters (transfer functions and luminosity soft
 * masks). A page that needs such a filter is reported back and drawn on the main
 * thread, as it cannot be drawn correctly here.
 */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { RenderReply, RenderRequest } from './protocol';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
/**
 * pdf.js's own worker (parsing), started here: pdf.js would start it itself but reads
 * window.location for that, and falls back to parsing on this thread without a window.
 */
let parser: InstanceType<typeof pdfjs.PDFWorker> | null = null;
function parserWorker() {
  if (!parser || parser.destroyed) {
    try {
      parser = new pdfjs.PDFWorker({ port: new Worker(workerUrl, { type: 'module' }) as unknown as null });
    } catch {
      parser = null;
    }
  }
  return parser ?? undefined;
}

class OffscreenCanvasFactory {
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true })! };
  }
  reset(cc: { canvas: OffscreenCanvas }, width: number, height: number) {
    cc.canvas.width = width;
    cc.canvas.height = height;
  }
  destroy(cc: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (cc.canvas) cc.canvas.width = cc.canvas.height = 0;
    cc.canvas = null;
    cc.context = null;
  }
}

interface Doc {
  pdf: Promise<PDFDocumentProxy>;
  /** Set once the document asked for an SVG filter: its pages are drawn on the main thread. */
  needsDom: boolean;
}
const docs = new Map<string, Doc>();

/** Filters only a DOM can provide: note the need and draw without it (the result is discarded). */
function filterFactory(doc: () => Doc | undefined) {
  const need = () => {
    const d = doc();
    if (d) d.needsDom = true;
    return 'none';
  };
  return class {
    addFilter(maps: unknown) {
      return maps ? need() : 'none';
    }
    addHCMFilter() {
      return 'none';
    }
    addAlphaFilter(map: unknown) {
      return map ? need() : 'none';
    }
    addLuminosityFilter() {
      // Every luminosity soft mask goes through a filter, with or without a transfer function.
      return need();
    }
    addHighlightHCMFilter() {
      return 'none';
    }
    destroy() {}
  };
}

/** The document's bytes: sent along, or from the editing worker over a port (asking the main thread if it had none). */
const awaitingData = new Map<string, (data: Uint8Array) => void>();
function bytesFor(m: Extract<RenderRequest, { type: 'open' }>): Promise<Uint8Array> {
  if (m.data || !m.port) return Promise.resolve(m.data!);
  const port = m.port;
  return new Promise((resolve) => {
    port.onmessage = (e: MessageEvent<Uint8Array | null>) => {
      port.close();
      if (e.data) {
        post({ id: -1, got: m.doc });
        resolve(e.data);
      } else {
        awaitingData.set(m.doc, resolve);
        post({ id: -1, need: m.doc });
      }
    };
  });
}

function open(m: Extract<RenderRequest, { type: 'open' }>, data: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({
    // Ours alone (a copy): handed to pdf.js's worker without another copy.
    data,
    password: m.password,
    isEvalSupported: false,
    worker: parserWorker(),
    cMapUrl: `${m.base}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${m.base}pdfjs/standard_fonts/`,
    // pdf.js's own worker fetches them (its check for that reads document.baseURI).
    useWorkerFetch: true,
    // Fonts are loaded into the worker's FontFaceSet; without one, glyphs are drawn as paths.
    ownerDocument: (fonts ? { fonts } : undefined) as unknown as Document,
    disableFontFace: !fonts,
    CanvasFactory: OffscreenCanvasFactory,
    FilterFactory: filterFactory(() => docs.get(m.doc)),
  } as Parameters<typeof pdfjs.getDocument>[0]).promise;
}

const fonts = (self as unknown as { fonts?: FontFaceSet }).fonts;
const running = new Map<number, { cancel(): void }>();
/** Renders cancelled before they started (the request was still waiting for its document). */
const cancelledEarly = new Set<number>();
const post = (r: RenderReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(r, transfer);

self.onmessage = async (e: MessageEvent<RenderRequest>) => {
  const m = e.data;
  if (m.type === 'data') {
    awaitingData.get(m.doc)?.(m.data);
    awaitingData.delete(m.doc);
    return;
  }
  if (m.type === 'open') {
    const doc: Doc = { pdf: bytesFor(m).then((data) => open(m, data)), needsDom: false };
    docs.set(m.doc, doc);
    doc.pdf.catch(() => docs.get(m.doc) === doc && docs.delete(m.doc));
    return;
  }
  if (m.type === 'close') {
    const d = docs.get(m.doc);
    docs.delete(m.doc);
    void d?.pdf.then((p) => p.destroy()).catch(() => {});
    return;
  }
  if (m.type === 'cancel') {
    const r = running.get(m.id);
    if (r) r.cancel();
    else cancelledEarly.add(m.id);
    return;
  }
  const d = docs.get(m.doc);
  try {
    if (!d) throw new Error('fallback');
    const pdf = await d.pdf;
    if (d.needsDom) throw new Error('fallback');
    const page = await pdf.getPage(m.page + 1);
    if (cancelledEarly.delete(m.id)) throw new Error('cancelled');
    const viewport = page.getViewport({ scale: m.scale, rotation: m.rotation, offsetX: m.offsetX, offsetY: m.offsetY });
    const canvas = new OffscreenCanvas(m.width, m.height);
    const ctx = canvas.getContext('2d', { alpha: false })!;
    let cancelled = false;
    const task = page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, annotationMode: m.noForms ? pdfjs.AnnotationMode.ENABLE_FORMS : pdfjs.AnnotationMode.ENABLE });
    running.set(m.id, { cancel: () => ((cancelled = true), task.cancel()) });
    try {
      await task.promise;
    } finally {
      running.delete(m.id);
    }
    if (cancelled) throw new Error('cancelled');
    if (d.needsDom) throw new Error('fallback');
    const bitmap = canvas.transferToImageBitmap();
    post({ id: m.id, ok: true, bitmap }, [bitmap]);
  } catch (err) {
    cancelledEarly.delete(m.id);
    // A document closed meanwhile (an edit replaced it): nothing to report.
    const closed = docs.get(m.doc) !== d;
    const msg = (err as Error)?.name === 'RenderingCancelledException' || closed ? 'cancelled' : (err as Error)?.message ?? String(err);
    // Anything unexpected: the main thread draws the page as before.
    if (msg !== 'cancelled' && msg !== 'fallback') console.warn('Background drawing failed:', err);
    post({ id: m.id, ok: false, error: msg === 'cancelled' ? 'cancelled' : 'fallback' });
  }
};
