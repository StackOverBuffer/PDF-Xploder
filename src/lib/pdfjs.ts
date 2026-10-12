import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { PageGeom, Rect } from './types';
import { normRot } from './geometry';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy };

export class PasswordCancelled extends Error {}

/**
 * Open a document with pdf.js. pdf.js transfers the buffer it is given to its
 * worker, so always hand it a copy and keep the original for pdf-lib.
 */
export async function openPdf(
  bytes: Uint8Array,
  askPassword: (retry: boolean) => string | null,
): Promise<{ pdf: PDFDocumentProxy; password?: string }> {
  let password: string | undefined;
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false });
  task.onPassword = (update: (pw: string) => void, reason: number) => {
    const pw = askPassword(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
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
  const out: PageGeom[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    out.push({ view: p.view.slice(0, 4) as PageGeom['view'], rotation: normRot(p.rotate) });
  }
  return out;
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
export async function renderToCanvas(page: PDFPageProxy, scale: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}
