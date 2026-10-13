/**
 * Commands behind the PDF-XChange style ribbon that are not page or form
 * operations: snapshots and the clipboard, sharing, attachments, reading
 * aloud and the accessibility check.
 */
import { create } from 'zustand';
import { annotationsByPage, useStore } from './store';
import { requirePermission } from './permissions';
import { tf, tr } from '../lib/i18n';
import * as ops from '../lib/pdfOps';
import { buildFileForSave, currentBytes, normaliseImage, placeImage } from './commands';
import { baseName, downloadBlob, fileBytes, pickFile, readAsDataUrl } from '../lib/download';
import { pageGeom, pdfRectToView, viewSize } from '../lib/geometry';
import { openPdf, renderToCanvas, type PDFDocumentProxy } from '../lib/pdfjs';
import * as att from '../lib/attachments';
import { applyAccessibilityFix, checkAccessibility, type CheckResult, type FixId } from '../lib/accessibility';
import type { Rect } from '../lib/types';

const S = () => useStore.getState();

/** UI state of these extras that other components react to. */
export const useExtras = create<{ reading: boolean; invert: boolean; attachmentsVersion: number }>()(() => ({
  reading: false,
  invert: false,
  attachmentsVersion: 0,
}));

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), 'image/png'));

/** Render a page as the user sees it: with comments and form values. */
async function withPageRendered<T>(page: number, scale: number, fn: (canvas: HTMLCanvasElement) => T | Promise<T>): Promise<T> {
  const s = S();
  const hasComments = Object.values(annotationsByPage(s)).some((l) => l.length) || Object.keys(s.formValues).length > 0;
  let doc: PDFDocumentProxy = s.pdf!;
  let own = false;
  if (hasComments) {
    doc = (await openPdf(await ops.exportWithAnnotations(await currentBytes(), annotationsByPage(s)), () => null)).pdf;
    own = true;
  }
  try {
    return await fn(await renderToCanvas(await doc.getPage(page + 1), scale));
  } finally {
    if (own) doc.destroy();
  }
}

/**
 * Copy a PNG to the clipboard. The blob is passed as a promise so the copy
 * still counts as part of the click that started it. Falls back to a download.
 */
async function copyImage(make: () => Promise<Blob>, fileName: string): Promise<void> {
  const blob = make();
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('no clipboard');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    S().notify('Image copied to the clipboard.');
  } catch {
    downloadBlob(await blob, fileName, 'image/png');
    S().notify('The browser does not allow copying images here, so the image was downloaded instead.');
  }
}

/** Snapshot tool: copy a region of a page (user-space rect) as a 150 dpi image. */
export function snapshotRegion(page: number, rect: Rect) {
  if (!requirePermission('copy')) return;
  const s = S();
  const g = pageGeom(s.geoms[page]);
  const name = `${baseName(s.fileName || 'document')}-p${page + 1}-snapshot.png`;
  return copyImage(
    () =>
      withPageRendered(page, 150 / 72, (canvas) => {
        const v = pdfRectToView(g, rect);
        const k = canvas.width / viewSize(g).width;
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(v.width * k));
        out.height = Math.max(1, Math.round(v.height * k));
        out.getContext('2d')!.drawImage(canvas, v.left * k, v.top * k, out.width, out.height, 0, 0, out.width, out.height);
        return toBlob(out);
      }),
    name,
  );
}

export function copyPageImage(page = S().currentPage) {
  if (!requirePermission('copy')) return;
  return copyImage(() => withPageRendered(page, 150 / 72, toBlob), `${baseName(S().fileName || 'document')}-p${page + 1}.png`);
}

export async function copySelectedText() {
  if (!requirePermission('copy')) return;
  const text = window.getSelection()?.toString() ?? '';
  if (!text.trim()) return S().notify('Select some text with the Select Text tool first.');
  try {
    await navigator.clipboard.writeText(text);
    S().notify('Text copied to the clipboard.');
  } catch {
    S().notify('The browser blocked clipboard access; use Ctrl+C instead.', 'error');
  }
}

/** Paste an image from the clipboard onto the current page as an image comment. */
export async function pasteImage() {
  if (!requirePermission('annotate')) return;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const img = await normaliseImage(await readAsDataUrl(blob));
      placeImage(img.src, img.width * 0.75, img.height * 0.75);
      return;
    }
    S().notify('The clipboard does not contain an image.');
  } catch {
    S().notify('The browser blocked clipboard access. Paste images with Ctrl+V into a dialog or insert them from a file instead.', 'error');
  }
}

// ---------------------------------------------------------------- sharing

/** Hand the document to the system share sheet (mail, messengers…); download where unsupported. */
export async function shareFile() {
  const s = S();
  if (!s.pdf) return;
  await s.run('Preparing file…', async () => {
    const bytes = await buildFileForSave();
    const file = new File([bytes as BlobPart], s.fileName || 'document.pdf', { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: file.name });
      } catch (e) {
        if ((e as Error).name !== 'AbortError') throw e;
      }
    } else {
      downloadBlob(file, file.name, 'application/pdf');
      S().notify('This browser cannot share files directly, so the PDF was downloaded for you to send.');
    }
  });
}

// ---------------------------------------------------------------- attachments

export const listAttachments = () => att.listAttachments(S().bytes!);

export async function saveAttachment(a: att.AttachmentInfo) {
  if (!requirePermission('copy')) return;
  const data = await att.readAttachment(S().bytes!, a.key);
  downloadBlob(new Blob([data as BlobPart], { type: a.mimeType || 'application/octet-stream' }), a.fileName, a.mimeType || 'application/octet-stream');
}

export async function attachFiles() {
  if (!requirePermission('modify')) return;
  const files = await pickFile('*/*', true);
  if (!files.length) return;
  await S().run('Attaching…', async () => {
    let bytes = S().bytes!;
    for (const f of files) bytes = await att.addAttachment(bytes, { name: f.name, type: f.type, bytes: await fileBytes(f), lastModified: f.lastModified });
    await S().commitBytes(bytes);
    useExtras.setState((x) => ({ attachmentsVersion: x.attachmentsVersion + 1 }));
    S().setSidebar('attachments');
  });
}

export async function deleteAttachment(a: att.AttachmentInfo) {
  if (!requirePermission('modify') || !confirm(tf('Remove the attachment “{name}”?', { name: a.fileName }))) return;
  await S().run('Removing attachment…', async () => {
    await S().commitBytes(await att.removeAttachment(S().bytes!, a.key));
    useExtras.setState((x) => ({ attachmentsVersion: x.attachmentsVersion + 1 }));
  });
}

// ---------------------------------------------------------------- accessibility

async function pageText(pdf: PDFDocumentProxy, page: number): Promise<string> {
  const tc = await (await pdf.getPage(page + 1)).getTextContent();
  return tc.items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : ' ') : '')).join('');
}

/** Read the document aloud from the current page on; calling again stops. */
export async function toggleReadAloud() {
  const synth = window.speechSynthesis;
  if (!synth) return S().notify('This browser cannot read text aloud.', 'error');
  if (useExtras.getState().reading) {
    useExtras.setState({ reading: false });
    synth.cancel();
    return;
  }
  const perm = S().permissions;
  if (!perm.contentAccessibility && !perm.copying) return S().notify('This document’s security settings do not allow text extraction for accessibility.', 'error');
  const s = S();
  const pdf = s.pdf!;
  const lang = await documentLanguage();
  useExtras.setState({ reading: true });
  for (let p = s.currentPage; p < pdf.numPages && useExtras.getState().reading; p++) {
    const text = (await pageText(pdf, p)).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (S().currentPage !== p) S().goToPage(p);
    // Long utterances get cut off in some browsers: speak sentence-sized chunks.
    for (const chunk of text.match(/[^.!?]{1,220}[.!?]*/g) ?? [text]) {
      if (!useExtras.getState().reading) break;
      await new Promise<void>((res) => {
        const u = new SpeechSynthesisUtterance(chunk);
        if (lang) u.lang = lang;
        u.onend = u.onerror = () => res();
        synth.speak(u);
      });
    }
  }
  useExtras.setState({ reading: false });
}

async function documentLanguage(): Promise<string> {
  try {
    const doc = await ops.load(S().bytes!);
    const l = doc.catalog.lookup((await import('@cantoo/pdf-lib')).PDFName.of('Lang'));
    return l && 'decodeText' in l ? (l as { decodeText(): string }).decodeText() : '';
  } catch {
    return '';
  }
}

export function toggleInvert() {
  const invert = !useExtras.getState().invert;
  useExtras.setState({ invert });
  document.body.classList.toggle('invert-pages', invert);
}

export async function runAccessibilityCheck(): Promise<CheckResult[]> {
  const s = S();
  const counts: number[] = [];
  for (let p = 0; p < s.pdf!.numPages; p++) counts.push((await pageText(s.pdf!, p)).trim().length);
  const noTip = s.fields.filter((f) => !f.props.tooltip?.trim()).map((f) => f.name);
  return checkAccessibility(s.bytes!, counts, noTip, s.permissions.contentAccessibility);
}

export async function fixAccessibility(fix: FixId): Promise<boolean> {
  if (!requirePermission('modify')) return false;
  let value = '';
  if (fix === 'lang') {
    value = prompt(tr('Document language (e.g. de-DE, en-US):'), navigator.language || 'en-US')?.trim() ?? '';
    if (!value) return false;
  }
  if (fix === 'title') {
    value = prompt(tr('Document title:'), baseName(S().fileName || ''))?.trim() ?? '';
    if (!value) return false;
  }
  await S().run('Updating document…', async () => S().commitBytes(await applyAccessibilityFix(S().bytes!, fix, value)));
  return true;
}
