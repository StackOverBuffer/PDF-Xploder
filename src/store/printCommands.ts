/** Printing with options (page range, paper, scaling, pages per sheet), via the browser's print dialog. */
import * as ops from '../lib/pdfOps';
import { buildPrintPdf, isPlain, planSheets, type PrintOptions, type Sheet } from '../lib/printLayout';
import { useStore } from './store';
import { buildOutput, currentBytes } from './commands';
import { viewSize } from '../lib/geometry';
import type { PDFDocument } from '@cantoo/pdf-lib';

const S = () => useStore.getState();

interface Prepared {
  bytes: Uint8Array;
  /** The same, loaded once for building every sheet. */
  doc: PDFDocument;
  sizes: { width: number; height: number }[];
}

/** The last preparation (shared while it is still being built, so quick option changes do not repeat it). */
let cache: { key: unknown[]; result: Promise<Prepared> } | null = null;

/** The document as it prints: comments (optional) and form fields painted into the pages. */
function prepared(comments: boolean): Promise<Prepared> {
  const s = S();
  const key = [s.bytes, s.annotations, s.formValues, comments];
  if (cache && cache.key.every((k, i) => k === key[i])) return cache.result;
  const result = (async () => {
    let bytes = comments ? await buildOutput(true) : await currentBytes();
    try {
      bytes = await ops.flattenFormFields(bytes);
    } catch (e) {
      console.warn('Could not flatten form fields for printing', e);
    }
    const doc = await ops.load(bytes);
    const sizes = doc.getPages().map((p) => viewSize(ops.geomOf(p)));
    return { bytes, doc, sizes };
  })();
  cache = { key, result };
  result.catch(() => cache?.result === result && (cache = null));
  return result;
}

/** Sheets for the options (for the preview's sheet count). */
export async function printSheets(o: PrintOptions): Promise<Sheet[]> {
  return planSheets(o, (await prepared(o.comments)).sizes);
}

/** One sheet as a PDF, for the preview. */
export async function printPreviewSheet(o: PrintOptions, index: number): Promise<{ bytes: Uint8Array; count: number } | null> {
  const p = await prepared(o.comments);
  const sheets = planSheets(o, p.sizes);
  if (!sheets.length) return null;
  const i = Math.min(Math.max(0, index), sheets.length - 1);
  return { bytes: await buildPrintPdf(p.doc, [sheets[i]]), count: sheets.length };
}

/** Hand a PDF to the browser's print dialog. */
function printBytes(out: Uint8Array) {
  const url = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.src = url;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  document.body.appendChild(frame);
  // If the frame never loads, still clean up.
  setTimeout(() => {
    if (!frame.isConnected) return;
    frame.remove();
    URL.revokeObjectURL(url);
  }, 10 * 60_000);
}

export async function printWithOptions(o: PrintOptions) {
  await S().run('Preparing to print…', async () => {
    if (isPlain(o, S().pageIds.length)) return printBytes(o.comments ? await buildOutput() : await currentBytes());
    const p = await prepared(o.comments);
    const sheets = planSheets(o, p.sizes);
    if (!sheets.length) throw new Error('There are no pages to print.');
    printBytes(await buildPrintPdf(p.doc, sheets));
  });
}

/** Forget the prepared document (e.g. when the dialog closes). */
export function releasePrintCache() {
  cache = null;
}
