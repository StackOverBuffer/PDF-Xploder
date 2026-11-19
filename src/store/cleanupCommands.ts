/** Whole-document clean-ups: greyscale, sanitize, extract all images. */
import { useStore, reportProgress } from './store';
import { requirePermission } from './permissions';
import { load } from '../lib/pdfOps';
import { saveDoc } from '../lib/pdfSave';
import { convertToGreyscale, greyHex } from '../lib/greyscale';
import { sanitize, type SanitizeOptions, type SanitizeReport } from '../lib/sanitize';
import { findImages } from '../lib/extractImages';
import { zip, type ZipEntry } from '../lib/zip';
import { baseName, downloadBlob } from '../lib/download';
import { tr, tf } from '../lib/i18n';
import { ask } from '../lib/ask';
import { canvasCodec, hasSignature } from './optimizeCommands';
import type { Annotation } from '../lib/types';

const S = () => useStore.getState();

/** Rewriting the file breaks digital signatures: ask first. */
async function okToRewrite(): Promise<boolean> {
  if (!hasSignature(S().bytes!)) return true;
  return ask({ message: tr('This document is digitally signed. Changing it this way invalidates the signatures.'), ok: 'Continue', danger: true });
}

/** A comment with its colours in grey (pictures in comments keep theirs). */
function greyAnnotation(a: Annotation): Annotation {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(a)) if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) out[k] = greyHex(v);
  return out as unknown as Annotation;
}

/** Convert pages, images and comments to greyscale. */
export async function greyscale() {
  if (!requirePermission('modify') || !(await okToRewrite())) return;
  await S().run('Converting to greyscale…', async () => {
    const doc = await load(S().bytes!);
    const report = await convertToGreyscale(doc, canvasCodec, reportProgress);
    const annotations = Object.fromEntries(Object.entries(S().annotations).map(([page, list]) => [page, list.map(greyAnnotation)]));
    await S().commitBytes(await saveDoc(doc), undefined, annotations);
    S().notify(
      report.imagesKept
        ? tf('Converted to greyscale. {n} image(s) in formats that could not be read keep their colours.', { n: report.imagesKept })
        : tr('Converted to greyscale.'),
      'info',
      { undo: true },
    );
  });
}

export function describeSanitize(r: SanitizeReport): string {
  const parts: string[] = [];
  if (r.scripts) parts.push(tf('{n} script(s)', { n: r.scripts }));
  if (r.externalActions) parts.push(tf('{n} form submit or remote action(s)', { n: r.externalActions }));
  if (r.attachments) parts.push(tf('{n} attachment(s)', { n: r.attachments }));
  if (r.metadataRemoved) parts.push(tr('metadata'));
  if (r.hiddenData) parts.push(tf('{n} hidden item(s)', { n: r.hiddenData }));
  return parts.join(', ');
}

/** Remove scripts, actions, attachments, metadata and hidden data, as chosen. */
export async function sanitizeDocument(o: SanitizeOptions) {
  if (!requirePermission('modify') || !(await okToRewrite())) return;
  await S().run('Sanitizing…', async () => {
    const { bytes, report } = await sanitize(await load(S().bytes!), o);
    const removed = describeSanitize(report);
    const pdfA = report.keptForPdfA ? ` ${tr('The metadata was kept, because the file is PDF/A, which requires it.')}` : '';
    if (!removed) return S().notify(`${tr('Nothing to remove: the document has none of the chosen items.')}${pdfA}`);
    await S().commitBytes(bytes);
    S().notify(`${tr('Removed')}: ${removed}.${pdfA}`, 'info', { undo: true });
  });
}

async function pngOf(rgbOrPdf: Parameters<NonNullable<typeof canvasCodec.decodeRgb>>[0], width: number, height: number): Promise<Uint8Array | null> {
  const rgb = 'rgb' in rgbOrPdf ? rgbOrPdf.rgb : await canvasCodec.decodeRgb!(rgbOrPdf, width, height);
  if (!rgb) return null;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const data = new ImageData(width, height);
  for (let i = 0, j = 0; i < data.data.length; i += 4, j += 3) {
    data.data[i] = rgb[j];
    data.data[i + 1] = rgb[j + 1];
    data.data[i + 2] = rgb[j + 2];
    data.data[i + 3] = 255;
  }
  c.getContext('2d')!.putImageData(data, 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** Save every image of the document, as stored (JPEG) or as PNG, in a ZIP file. */
export async function extractAllImages() {
  if (!requirePermission('copy')) return;
  await S().run('Extracting images…', async () => {
    const images = await findImages(await load(S().bytes!));
    if (!images.length) return S().notify(tr('The document contains no images.'));
    const entries: ZipEntry[] = [];
    const counter = new Map<number, number>();
    let skipped = 0;
    for (let i = 0; i < images.length; i++) {
      reportProgress(i, images.length);
      const img = images[i];
      const n = (counter.get(img.page) ?? 0) + 1;
      counter.set(img.page, n);
      const stem = `page${String(img.page + 1).padStart(3, '0')}-image${n}`;
      const data = img.jpeg ?? (img.source ? await pngOf(img.source, img.width, img.height).catch(() => null) : null);
      if (!data) {
        skipped++;
        continue;
      }
      entries.push({ name: `${stem}.${img.jpeg ? 'jpg' : 'png'}`, data });
    }
    const name = baseName(S().fileName || 'document');
    downloadBlob(zip(entries), `${name}-images.zip`, 'application/zip');
    S().notify(
      skipped
        ? tf('{n} image(s) saved; {skipped} could not be read.', { n: entries.length, skipped })
        : tf('{n} image(s) saved.', { n: entries.length }),
    );
  });
}
