import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { PageGeom, Rect } from './types';
import { normRot } from './geometry';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
/**
 * One worker for every document: otherwise each getDocument (every edit reloads the
 * document) starts a fresh worker and re-fetches character maps and fonts. Handed to
 * getDocument explicitly, pdf.js never destroys it along with a document.
 */
let sharedWorker: InstanceType<typeof pdfjs.PDFWorker> | null = null;
function worker() {
  if (typeof document === 'undefined') return undefined;
  if (!sharedWorker || sharedWorker.destroyed) sharedWorker = new pdfjs.PDFWorker();
  return sharedWorker;
}

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy };

export class PasswordCancelled extends Error {}

/** Character maps and standard font data, served by the pdfjs-assets plugin (see vite.config.ts). */
const ASSETS =
  typeof document === 'undefined'
    ? {}
    : {
        cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
      };

/**
 * Open a document with pdf.js. pdf.js transfers the buffer it is given to its
 * worker, so always hand it a copy and keep the original for pdf-lib.
 */
export async function openPdf(
  bytes: Uint8Array,
  askPassword: (retry: boolean) => string | null | Promise<string | null>,
  /** The caller no longer needs `bytes` (a throwaway document): hand them over without copying. */
  opts: { handOver?: boolean } = {},
): Promise<{ pdf: PDFDocumentProxy; password?: string }> {
  let password: string | undefined;
  const task = pdfjs.getDocument({ data: opts.handOver ? bytes : bytes.slice(), isEvalSupported: false, worker: worker(), ...ASSETS });
  task.onPassword = async (update: (pw: string) => void, reason: number) => {
    const pw = await askPassword(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    if (pw === null) {
      task.destroy();
      return;
    }
    password = pw;
    update(pw);
  };
  try {
    const pdf = await task.promise;
    return { pdf, password };
  } catch (e) {
    if (password === undefined && (e as Error)?.name === 'PasswordException') throw new PasswordCancelled();
    throw e;
  }
}

export async function pageGeoms(pdf: PDFDocumentProxy): Promise<PageGeom[]> {
  // All requests at once: the worker answers them in one go instead of one round trip per page.
  const pages = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)));
  return pages.map((p) => ({ view: p.view.slice(0, 4) as PageGeom['view'], rotation: normRot(p.rotate) }));
}

export interface TextRun {
  str: string;
  /** Bounding box in user space. */
  rect: Rect;
}

/** Text runs of a page with approximate user-space boxes, for searching. */
export async function pageTextRuns(page: PDFPageProxy): Promise<TextRun[]> {
  const tc = await page.getTextContent();
  const runs: TextRun[] = [];
  for (const item of tc.items) {
    if (!('str' in item) || !item.str) continue;
    const [a, b, , , e, f] = item.transform as number[];
    const fontHeight = Math.hypot(a, b) || item.height;
    runs.push({ str: item.str, rect: { x: e, y: f - fontHeight * 0.2, w: item.width, h: fontHeight * 1.15 } });
  }
  return runs;
}

/** Render a page to a canvas at the given scale (rotation as the page specifies). */
export async function renderToCanvas(page: PDFPageProxy, scale: number, opts: { transparent?: boolean } = {}): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d')!;
  if (!opts.transparent) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  await page.render({ canvasContext: ctx, viewport, ...(opts.transparent ? { background: 'rgba(0,0,0,0)' } : {}) }).promise;
  return canvas;
}

/** Resolve a named or explicit destination to a 0-based page index and optional user-space y. */
export async function resolveDest(pdf: PDFDocumentProxy, dest: unknown): Promise<{ page: number; y?: number } | null> {
  const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : (dest as unknown[] | null);
  if (!Array.isArray(explicit) || !explicit.length) return null;
  const [ref, kind, ...args] = explicit as [unknown, { name?: string } | undefined, ...unknown[]];
  const page = typeof ref === 'number' ? ref : await pdf.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
  let y: number | undefined;
  if (kind?.name === 'XYZ' && typeof args[1] === 'number') y = args[1];
  else if ((kind?.name === 'FitH' || kind?.name === 'FitBH') && typeof args[0] === 'number') y = args[0];
  return { page, y };
}
