/**
 * Draw a page, or a piece of it, into a new canvas: in the background thread when the
 * document is drawn there (offscreen.ts), otherwise here, one turn at a time
 * (renderQueue.ts). Pages slow to draw here move their document to the background.
 */
import { AnnotationMode, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import { renderSlot } from '../renderQueue';
import { drawOffscreen, drawsOffscreen, noteMainRender } from './offscreen';

export interface DrawAt {
  scale: number;
  rotation: number;
  offsetX?: number;
  offsetY?: number;
}

export interface DrawOptions {
  priority: number;
  /** Leave form fields off (the page view shows them as HTML controls). */
  noForms?: boolean;
}

/** Resolves to the drawn canvas, or null when cancelled. */
export function drawPage(
  pdf: PDFDocumentProxy,
  page: PDFPageProxy,
  at: DrawAt,
  size: { width: number; height: number },
  o: DrawOptions,
): { promise: Promise<HTMLCanvasElement | null>; cancel(): void } {
  let cancelled = false;
  let task: { cancel(): void } | null = null;
  let slot: ReturnType<typeof renderSlot> | null = null;
  const cancel = () => {
    cancelled = true;
    task?.cancel();
    slot?.done();
  };
  const run = async (): Promise<HTMLCanvasElement | null> => {
    for (;;) {
      const off = drawOffscreen(pdf, { page: page.pageNumber - 1, ...at, ...size, noForms: o.noForms }, o.priority);
      task = off;
      const drawn = await off.promise;
      if (drawn || cancelled) return cancelled ? null : drawn;
      slot = renderSlot(o.priority);
      await slot.ready;
      if (cancelled) return null;
      // Moved to the background meanwhile (another page was slow): draw it there.
      if (!drawsOffscreen(pdf)) break;
      slot.done();
      slot = null;
    }
    const canvas = Object.assign(document.createElement('canvas'), size);
    try {
      const t = page.render({
        canvasContext: canvas.getContext('2d', { alpha: false })!,
        viewport: page.getViewport(at),
        annotationMode: o.noForms ? AnnotationMode.ENABLE_FORMS : AnnotationMode.ENABLE,
      });
      task = t;
      const t0 = performance.now();
      await t.promise;
      noteMainRender(pdf, performance.now() - t0);
    } catch (e) {
      canvas.width = canvas.height = 0;
      throw e;
    } finally {
      slot?.done();
    }
    if (cancelled) {
      canvas.width = canvas.height = 0;
      return null;
    }
    return canvas;
  };
  return { promise: run(), cancel };
}
