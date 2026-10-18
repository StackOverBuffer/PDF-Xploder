/**
 * Page OCR (like PDF-XChange's Enhanced OCR plugin): render pages, recognise
 * them on several Tesseract workers in parallel and write the results back as
 * searchable, editable or "fine" page content.
 */
import { PDFDocument } from '@cantoo/pdf-lib';
import { useStore } from './store';
import { requirePermission } from './permissions';
import { pdfjs, type PDFPageProxy } from '../lib/pdfjs';
import { tr } from '../lib/i18n';
import type { Raster } from '../lib/ocr/raster';
import type { M } from '../lib/ocr/mapping';
import type { OutputMode, EncodedImage } from '../lib/ocr/writer';
import { saveDoc } from '../lib/pdfSave';

const S = () => useStore.getState();

export interface OcrOptions {
  /** 0-based page indices. */
  pages: number[];
  langs: string[];
  mode: OutputMode;
  dpi: number;
  detectSkew: boolean;
  correctSkew: boolean;
  detectRotation: boolean;
  correctRotation: boolean;
  styles: boolean;
  tables: boolean;
  threads: number;
  /** Also recognise pages that already contain text. */
  includeTextPages: boolean;
}

export type PageStatus = 'queued' | 'rendering' | 'analysing' | 'recognising' | 'writing' | 'done' | 'skipped' | 'failed';

export interface PageProgress {
  page: number;
  status: PageStatus;
  /** 0–1. */
  progress: number;
  detail?: string;
}

export interface OcrSummary {
  done: number;
  skipped: number;
  failed: number;
  words: number;
  tables: number;
  rotated: number;
  deskewed: number;
}

export type ProgressHandler = (pages: PageProgress[], engine?: { status: string; progress: number }) => void;

class Cancelled extends Error {}

/** Whether a page already has (visible or invisible) text. */
async function hasText(page: PDFPageProxy): Promise<boolean> {
  const tc = await page.getTextContent();
  return tc.items.some((i) => 'str' in i && i.str.trim().length > 0);
}

/** Render without annotations (they stay separate objects) on white. */
async function renderPage(page: PDFPageProxy, scale: number): Promise<{ raster: Raster; viewport: M }> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise;
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.height = 0;
  return { raster: { width: d.width, height: d.height, data: d.data }, viewport: viewport.transform as M };
}

function toCanvas(r: Raster): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = r.width;
  c.height = r.height;
  c.getContext('2d')!.putImageData(new ImageData(r.data as Uint8ClampedArray<ArrayBuffer>, r.width, r.height), 0, 0);
  return c;
}

async function encode(r: Raster, type: 'image/png' | 'image/jpeg'): Promise<Blob> {
  const c = toCanvas(r);
  try {
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), type, 0.85));
  } finally {
    c.width = c.height = 0;
  }
}

async function encodeJpeg(r: Raster): Promise<EncodedImage> {
  return { bytes: new Uint8Array(await (await encode(r, 'image/jpeg')).arrayBuffer()), format: 'jpg' };
}

/** Run OCR over the given pages and commit the result as one undoable change. */
export async function runOcr(o: OcrOptions, onProgress: ProgressHandler, signal: AbortSignal): Promise<OcrSummary | null> {
  if (!requirePermission('modify')) return null;
  const startBytes = S().bytes!;
  const pdf = S().pdf!;
  const progress: PageProgress[] = o.pages.map((page) => ({ page, status: 'queued', progress: 0 }));
  let engineState: { status: string; progress: number } | undefined;
  const report = () => onProgress(progress.map((p) => ({ ...p })), engineState);
  const set = (i: number, patch: Partial<PageProgress>) => {
    progress[i] = { ...progress[i], ...patch };
    report();
  };
  report();
  const summary: OcrSummary = { done: 0, skipped: 0, failed: 0, words: 0, tables: 0, rotated: 0, deskewed: 0 };
  let cancelled = false;

  const result = await S().run(tr('Recognising text…'), async () => {
    // Pages that need OCR at all.
    const todo: number[] = [];
    for (let i = 0; i < o.pages.length; i++) {
      if (!o.includeTextPages && (await hasText(await pdf.getPage(o.pages[i] + 1)))) {
        set(i, { status: 'skipped', progress: 1, detail: tr('Page already contains text') });
        summary.skipped++;
      } else todo.push(i);
    }
    if (!todo.length) return null;

    const [{ createEngine }, { analysePage }, { createWriter, removeUnreferenced }] = await Promise.all([
      import('../lib/ocr/engine'),
      import('../lib/ocr/analyse'),
      import('../lib/ocr/writer'),
    ]);
    const abort = new Promise<never>((_, rej) => {
      const fail = () => rej(new Cancelled());
      if (signal.aborted) fail();
      signal.addEventListener('abort', fail, { once: true });
    });
    abort.catch(() => undefined);
    const starting = createEngine({
      langs: o.langs,
      threads: o.threads,
      dpi: o.dpi,
      onLoad: (status, p) => {
        engineState = { status: tr(status), progress: p };
        report();
      },
    });
    let engine: Awaited<typeof starting>;
    try {
      engine = await Promise.race([starting, abort]);
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
      starting.then((en) => en.terminate()).catch(() => undefined);
      cancelled = true;
      return null;
    }
    try {
      engineState = undefined;
      const doc = await PDFDocument.load(startBytes, { updateMetadata: false });
      const writer = createWriter(doc);
      const scale = o.dpi / 72;
      let replaced = false;

      const queue = [...todo];
      const processPage = async (i: number) => {
        const index = o.pages[i];
        try {
          set(i, { status: 'rendering', progress: 0.05 });
          const page = await pdf.getPage(index + 1);
          const { raster, viewport } = await Promise.race([renderPage(page, scale), abort]);
          set(i, { status: 'analysing', progress: 0.1 });
          const analysis = await Promise.race([
            analysePage(raster, { dpi: o.dpi, detectSkew: o.detectSkew, detectRotation: o.detectRotation, styles: o.styles, tables: o.tables, pictures: o.mode === 'fine' }, async (img, purpose) => {
              // Encoded here rather than by tesseract.js, so a cancelled job fails inside its own promise.
              const png = await Promise.race([encode(img, 'image/png'), abort]);
              if (purpose === 'page') set(i, { status: 'recognising', progress: 0.15 });
              return Promise.race([engine.recognize(png, purpose === 'page' ? (p) => set(i, { progress: 0.15 + p * 0.75 }) : undefined), abort]);
            }),
            abort,
          ]);
          set(i, { status: 'writing', progress: 0.92 });
          const turnedViewport = page.getViewport({ scale, rotation: (page.rotate + analysis.quarterTurns * 90) % 360 }).transform as M;
          await writer.writePage(doc.getPage(index), analysis, {
            mode: o.mode,
            correctSkew: o.correctSkew,
            correctRotation: o.correctRotation,
            viewport,
            turnedViewport,
            encodeImage: encodeJpeg,
          });
          replaced ||= o.mode !== 'searchable' || (o.correctSkew && !!analysis.skew);
          const words = analysis.lines.reduce((s, l) => s + l.words.length, 0);
          summary.done++;
          summary.words += words;
          summary.tables += analysis.tables.length;
          if (analysis.quarterTurns && o.correctRotation) summary.rotated++;
          if (analysis.skew && (o.correctSkew || o.mode !== 'searchable')) summary.deskewed++;
          const notes = [`${words} ${tr('words')}`, `${Math.round(analysis.confidence)}%`];
          if (analysis.quarterTurns) notes.push(`${tr('rotated')} ${analysis.quarterTurns * 90}°`);
          if (analysis.skew) notes.push(`${tr('skew')} ${analysis.skew.toFixed(1)}°`);
          if (analysis.tables.length) notes.push(`${analysis.tables.length} ${tr('table(s)')}`);
          set(i, { status: 'done', progress: 1, detail: notes.join(' · ') });
        } catch (e) {
          if (e instanceof Cancelled) {
            queue.length = 0;
            throw e;
          }
          console.error(e);
          summary.failed++;
          set(i, { status: 'failed', progress: 1, detail: (e as Error).message || String(e) });
        }
      };

      // As many pages in flight as there are workers, so rendering overlaps recognition.
      await Promise.all(
        Array.from({ length: Math.min(queue.length, Math.max(1, o.threads)) }, async () => {
          while (queue.length) await processPage(queue.shift()!);
        }),
      );
      if (!summary.done) return null;
      if (replaced) removeUnreferenced(doc);
      const out = await saveDoc(doc);
      if (S().bytes !== startBytes) throw new Error(tr('The document changed during OCR; the result was discarded.'));
      await S().commitBytes(out);
      return summary;
    } catch (e) {
      if (e instanceof Cancelled) {
        cancelled = true;
        return null;
      }
      throw e;
    } finally {
      await engine.terminate().catch(() => undefined);
    }
  });

  if (cancelled) S().notify(tr('OCR cancelled.'));
  else if (result) {
    S().notify(`${tr('OCR finished')}: ${result.done} ${tr('page(s)')}, ${result.words} ${tr('words')}${result.skipped ? ` · ${result.skipped} ${tr('skipped')}` : ''}${result.failed ? ` · ${result.failed} ${tr('failed')}` : ''}`, result.failed ? 'error' : 'info');
  } else if (summary.skipped && !summary.done && !summary.failed) S().notify(tr('All selected pages already contain text.'));
  return result ?? null;
}
