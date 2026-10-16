/** User-level commands: glue between UI, the store and pdf operations. */
import * as ops from '../lib/pdfOps';
import * as forms from '../lib/forms';
import { annotationsByPage, uid, useStore } from './store';
import { baseName, downloadBlob, fileBytes, pickFile, readAsDataUrl } from '../lib/download';
import { viewRectToPdf, viewSize } from '../lib/geometry';
import { encrypt, reencryptLike } from '../lib/security';
import { requirePermission } from './permissions';
import { tf, tr } from '../lib/i18n';
import { droppedHandles, ensureWritable, pickPdfHandles, pickSaveHandle, writeToHandle } from '../lib/fileAccess';
import { signPdf, type SignOptions } from '../lib/signature';
import { openPdf, renderToCanvas } from '../lib/pdfjs';
import type { Annotation, Rect } from '../lib/types';

const S = () => useStore.getState();

/** Indices that page commands act on: the thumbnail selection, else the current page. */
export function targetPages(): number[] {
  const s = S();
  return s.selectedPages.length ? [...s.selectedPages].sort((a, b) => a - b) : [s.currentPage];
}

/** Open PDF files, each in its own tab (like PDF-XChange). */
export async function openFiles(files: File[], handles: (FileSystemFileHandle | null)[] = []) {
  const pdfs = files.map((file, i) => ({ file, handle: handles[i] ?? null })).filter(({ file: f }) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!pdfs.length) return S().notify('Please choose a PDF file.', 'error');
  for (const { file: f, handle } of pdfs) {
    await S().run('Opening…', async () => S().openInNewTab(await fileBytes(f), f.name, { handle }));
  }
}

/** Open dropped files, keeping their file handles where the browser provides them. Call from the drop event itself. */
export function openDropped(dt: DataTransfer) {
  const files = Array.from(dt.files);
  void droppedHandles(dt).then((handles) => openFiles(files, handles.length === files.length ? handles : []));
}

export async function openFromDialog() {
  const picked = await pickPdfHandles();
  if (picked) {
    if (picked.length) await openFiles(picked.map((p) => p.file), picked.map((p) => p.handle));
    return;
  }
  const files = await pickFile('application/pdf,.pdf', true);
  if (files.length) await openFiles(files);
}

export async function newDocument() {
  await S().run('Creating…', async () => S().openInNewTab(await ops.createBlankDocument(), tr('Untitled') + '.pdf'));
}

/** The document bytes with pending form edits applied (annotations not included). */
export async function currentBytes(): Promise<Uint8Array> {
  const s = S();
  return Object.keys(s.formValues).length ? ops.setFormValues(s.bytes!, s.formValues) : s.bytes!;
}

/** The document with annotations and form values, unencrypted (for print, export, extract…). */
export async function buildOutput(flatten = false): Promise<Uint8Array> {
  return ops.exportWithAnnotations(await currentBytes(), annotationsByPage(S()), { flatten });
}

/**
 * The bytes to write when saving. An unchanged document is written back
 * byte-for-byte, so signatures and encryption survive; otherwise the
 * document is rebuilt and the security settings applied.
 */
export async function buildFileForSave(): Promise<Uint8Array> {
  const s = S();
  if (unchangedSinceOpen()) return s.originalBytes!;
  const out = await buildOutput();
  if (s.securityChanged) return s.security ? encrypt(out, s.security) : out;
  // Untouched security: encrypt exactly like the opened file (works without the owner password).
  if (s.keepEncryption && s.originalBytes) return reencryptLike(out, s.originalBytes, s.keepEncryption.password);
  return out;
}

/** Ask before a save that would invalidate digital signatures. */
function confirmBreakingSignatures(): boolean {
  const s = S();
  if (!s.dirty || !s.signatures.length) return true;
  return confirm(tr('This document is digitally signed. Saving your changes rewrites the file, which invalidates the existing signatures. Continue?'));
}

/** The opened bytes are still exactly the document (nothing edited or saved since). */
function unchangedSinceOpen(): boolean {
  const s = S();
  return !s.dirty && !s.savedOnce && !!s.originalBytes;
}

/** Build the file and write it to `handle`, or download it as `name` when there is none or writing fails. */
async function writeOut(handle: FileSystemFileHandle | null, name: string) {
  await S().run('Saving…', async () => {
    const out = await buildFileForSave();
    if (handle) {
      try {
        await writeToHandle(handle, out);
        useStore.setState({ fileHandle: handle, fileName: handle.name });
        S().markSaved();
        S().notify(tf('Saved to {name}', { name: handle.name }));
        return;
      } catch (e) {
        console.warn('Writing to the file failed', e);
        S().notify('Could not write to the file, so a copy was downloaded instead.', 'error');
      }
    }
    useStore.setState({ fileName: name });
    downloadBlob(out, name);
    S().markSaved();
  });
}

/** Save: write back to the opened file where the browser allows it (Chrome, Edge), else download. */
export async function save() {
  const s = S();
  if (!s.bytes || !confirmBreakingSignatures()) return;
  // Ask for write access first, while the key press or click still counts as a user gesture.
  const handle = s.fileHandle && (await ensureWritable(s.fileHandle)) ? s.fileHandle : null;
  await writeOut(handle, S().fileName || 'document.pdf');
}

/** Save a copy with all comments burnt into the pages (keeps the editing session as is). */
export async function saveFlattenedCopy() {
  if (!S().bytes) return;
  await S().run('Saving…', async () => {
    downloadBlob(await buildOutput(true), `${baseName(S().fileName || 'document')}-flattened.pdf`);
  });
}

/** Save As: a save dialog where available (later saves go to the new file), else ask for a name and download. */
export async function saveAs() {
  if (!S().bytes) return;
  const suggested = S().fileName || 'document.pdf';
  const handle = await pickSaveHandle(suggested);
  if (handle === undefined) return;
  if (handle) {
    if (!confirmBreakingSignatures()) return;
    return writeOut(handle, handle.name);
  }
  const name = prompt(tr('File name'), suggested);
  if (!name) return;
  if (!confirmBreakingSignatures()) return;
  // A downloaded copy: later saves must not overwrite the file opened before.
  useStore.setState({ fileHandle: null });
  await writeOut(null, /\.pdf$/i.test(name) ? name : `${name}.pdf`);
}

export async function print() {
  if (!requirePermission('print')) return;
  await S().run('Preparing to print…', async () => {
    const out = await buildOutput();
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
  });
}

// ---------------------------------------------------------------- pages

export async function rotate(delta: number, pages = targetPages()) {
  if (!requirePermission('assemble')) return;
  await S().run('Rotating…', async () => S().commitBytes(await ops.rotatePages(S().bytes!, pages, delta)));
}

export async function deletePages(pages = targetPages()) {
  if (!requirePermission('assemble')) return;
  if (pages.length >= S().pageIds.length) return S().notify('A document must keep at least one page.', 'error');
  if (!confirm(tf('Delete {n} page(s)?', { n: pages.length }))) return;
  await S().run('Deleting…', async () => {
    const ids = S().pageIds.filter((_, i) => !pages.includes(i));
    await S().commitBytes(await ops.deletePages(S().bytes!, pages), ids);
    S().setSelectedPages([]);
  });
}

export async function insertBlank(after = S().currentPage) {
  if (!requirePermission('assemble')) return;
  await S().run('Inserting…', async () => {
    const ids = [...S().pageIds];
    ids.splice(after + 1, 0, uid('page'));
    await S().commitBytes(await ops.insertBlankPage(S().bytes!, after + 1), ids);
    S().goToPage(after + 1);
  });
}

export async function duplicate(pages = targetPages()) {
  if (!requirePermission('assemble')) return;
  await S().run('Duplicating…', async () => {
    const s = S();
    const ids: string[] = [];
    const annotations = { ...s.annotations };
    s.pageIds.forEach((id, i) => {
      ids.push(id);
      if (pages.includes(i)) {
        const copy = uid('page');
        ids.push(copy);
        annotations[copy] = (s.annotations[id] ?? []).map((a) => ({ ...a, id: uid('annot') }));
      }
    });
    await S().commitBytes(await ops.duplicatePages(s.bytes!, pages), ids, annotations);
  });
}

/** Move the given pages so they sit before position `to` (in the original numbering). */
export async function movePages(pages: number[], to: number) {
  if (!requirePermission('assemble')) return;
  const n = S().pageIds.length;
  const moving = [...new Set(pages)].sort((a, b) => a - b);
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => !moving.includes(i));
  const insertAt = rest.filter((i) => i < to).length;
  const order = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
  if (order.every((v, i) => v === i)) return;
  await S().run('Moving pages…', async () => {
    const ids = order.map((i) => S().pageIds[i]);
    await S().commitBytes(await ops.reorderPages(S().bytes!, order), ids);
    S().setSelectedPages(moving.map((_, k) => insertAt + k));
  });
}

export async function reverseOrder() {
  const n = S().pageIds.length;
  if (!requirePermission('assemble') || n < 2) return;
  await S().run('Reversing…', async () => {
    const order = Array.from({ length: n }, (_, i) => n - 1 - i);
    await S().commitBytes(await ops.reorderPages(S().bytes!, order), order.map((i) => S().pageIds[i]));
  });
}

async function insertPdfBytes(other: Uint8Array, at: number) {
  const { bytes, count } = await ops.insertDocument(S().bytes!, other, at);
  const ids = [...S().pageIds];
  ids.splice(at, 0, ...Array.from({ length: count }, () => uid('page')));
  await S().commitBytes(bytes, ids);
}

export async function insertFromFile(at = S().currentPage + 1) {
  if (!requirePermission('assemble')) return;
  const files = await pickFile('application/pdf,.pdf', true);
  if (!files.length) return;
  await S().run('Inserting pages…', async () => {
    let pos = at;
    for (const f of files) {
      const before = S().pageIds.length;
      await insertPdfBytes(await fileBytes(f), pos);
      pos += S().pageIds.length - before;
    }
  });
}

export async function extract(pages = targetPages()) {
  if (!requirePermission('copy')) return;
  await S().run('Extracting…', async () => {
    const s = S();
    const output = await ops.exportWithAnnotations(await currentBytes(), annotationsByPage(s));
    const out = await ops.extractPages(output, pages);
    const label = pages.length === 1 ? `p${pages[0] + 1}` : `p${pages[0] + 1}-${pages[pages.length - 1] + 1}`;
    downloadBlob(out, `${baseName(s.fileName)}-${label}.pdf`);
  });
}

export async function split(every: number) {
  if (every < 1 || !requirePermission('copy')) return;
  await S().run('Splitting…', async () => {
    const s = S();
    const output = await ops.exportWithAnnotations(await currentBytes(), annotationsByPage(s));
    const parts = await ops.splitEvery(output, every);
    parts.forEach((p, i) => downloadBlob(p, `${baseName(s.fileName)}-part${i + 1}.pdf`));
  });
}

export async function crop(m: ops.Margins, pages: number[]) {
  if (!requirePermission('modify')) return;
  await S().run('Cropping…', async () => S().commitBytes(await ops.cropPages(S().bytes!, pages, m)));
}

export async function exportPageImage(page = S().currentPage, dpi = 150) {
  if (!requirePermission('copy')) return;
  await S().run('Rendering image…', async () => {
    const s = S();
    const output = await ops.exportWithAnnotations(await currentBytes(), annotationsByPage(s));
    const { pdf } = await openPdf(output, () => null);
    try {
      const canvas = await renderToCanvas(await pdf.getPage(page + 1), dpi / 72);
      const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
      downloadBlob(blob, `${baseName(s.fileName)}-p${page + 1}.png`, 'image/png');
    } finally {
      pdf.destroy();
    }
  });
}

// ---------------------------------------------------------------- document

export async function watermark(o: ops.WatermarkOptions) {
  if (!requirePermission('modify')) return;
  await S().run('Adding watermark…', async () => S().commitBytes(await ops.addWatermark(S().bytes!, o)));
}

export async function headerFooter(o: ops.HeaderFooterOptions) {
  if (!requirePermission('modify')) return;
  await S().run('Adding header/footer…', async () => S().commitBytes(await ops.addHeaderFooter(S().bytes!, o)));
}

export async function setMetadata(m: ops.Metadata) {
  if (!requirePermission('modify')) return;
  await S().run('Updating properties…', async () => S().commitBytes(await ops.setMetadata(S().bytes!, m)));
}

/** Write the pending form values into the document, optionally flattening the form. */
export async function fillForm(flatten = false) {
  if (!requirePermission(flatten ? 'modify' : 'fillForms')) return;
  await S().run(flatten ? 'Flattening form…' : 'Updating form…', async () =>
    S().commitBytes(await ops.setFormValues(S().bytes!, S().formValues, { flatten }), undefined, undefined, {}),
  );
}

export function resetFormEdits() {
  const s = S();
  if (!Object.keys(s.formValues).length) return;
  s.checkpoint();
  useStore.setState({ formValues: {} });
}

/** Flatten the current annotations into page content (cannot be edited afterwards, except via undo). */
export async function flattenAnnotations() {
  if (!requirePermission('modify')) return;
  const s = S();
  const byPage = annotationsByPage(s).map((l) => l.filter((a) => a.type !== 'redact'));
  if (byPage.every((l) => !l.length)) return s.notify('There are no annotations to flatten.');
  await s.run('Flattening…', async () => {
    const out = await ops.exportWithAnnotations(s.bytes!, byPage, { flatten: true });
    const remaining: Record<string, Annotation[]> = {};
    for (const [id, list] of Object.entries(s.annotations)) remaining[id] = list.filter((a) => a.type === 'redact');
    await S().commitBytes(out, undefined, remaining);
  });
}

/**
 * Secure redaction: each page carrying redaction marks is flattened (with its
 * other annotations) and rasterised, so the text and graphics underneath are
 * really removed from the file, not just covered up.
 */
export async function applyRedactions() {
  if (!requirePermission('modify')) return;
  const s = S();
  const byPage = annotationsByPage(s);
  const pages = byPage.flatMap((l, i) => (l.some((a) => a.type === 'redact') ? [i] : []));
  if (!pages.length) return s.notify('Mark areas with the Redact tool first.');
  if (!confirm(tf('Apply redactions on {n} page(s)? Those pages will be converted to images: their text will no longer be selectable or searchable.', { n: pages.length }))) return;
  await s.run('Applying redactions…', async () => {
    const flat = await ops.exportWithAnnotations(await currentBytes(), byPage.map((l, i) => (pages.includes(i) ? l : [])), { flatten: true, burnRedactions: true });
    const { pdf } = await openPdf(flat, () => null);
    const images: { index: number; png: Uint8Array }[] = [];
    try {
      for (const i of pages) {
        const canvas = await renderToCanvas(await pdf.getPage(i + 1), 200 / 72);
        const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
        images.push({ index: i, png: new Uint8Array(await blob.arrayBuffer()) });
      }
    } finally {
      pdf.destroy();
    }
    const out = await ops.replacePagesWithImages(s.bytes!, images);
    const annotations = { ...s.annotations };
    for (const i of pages) delete annotations[s.pageIds[i]];
    await S().commitBytes(out, undefined, annotations);
    s.notify(tf('Redacted {n} page(s).', { n: pages.length }));
  });
}

// ---------------------------------------------------------------- images & signatures

/** Load any browser-decodable image as a PNG/JPEG data URL plus its natural size. */
export async function normaliseImage(src: string): Promise<{ src: string; width: number; height: number }> {
  const img = new Image();
  img.src = src;
  await img.decode();
  if (/^data:image\/(png|jpe?g)/.test(src)) return { src, width: img.naturalWidth, height: img.naturalHeight };
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return { src: c.toDataURL('image/png'), width: c.width, height: c.height };
}

/** Place an image centred on the current page, fitted within `maxW` x `maxH` points. */
export function placeImage(src: string, natW: number, natH: number, opts: { signature?: boolean; maxW?: number; maxH?: number } = {}) {
  if (!requirePermission('annotate')) return;
  const s = S();
  const index = s.currentPage;
  const g = s.geoms[index];
  const vs = viewSizeOf(index);
  const maxW = Math.min(opts.maxW ?? vs.width * 0.6, vs.width * 0.9);
  const maxH = Math.min(opts.maxH ?? vs.height * 0.6, vs.height * 0.9);
  const k = Math.min(maxW / natW, maxH / natH, 1);
  const w = natW * k;
  const h = natH * k;
  const rect = viewRectToPdf(g, { left: (vs.width - w) / 2, top: (vs.height - h) / 2, width: w, height: h });
  s.addAnnotation(index, {
    id: uid('annot'), type: 'image', rect, rot: g.rotation, src, signature: opts.signature,
    color: '#000000', opacity: 1, author: s.author, createdAt: Date.now(),
  });
  s.setTool('select');
}

function viewSizeOf(index: number) {
  return viewSize(S().geoms[index]);
}

export async function insertImageFromFile() {
  if (!requirePermission('annotate')) return;
  const [f] = await pickFile('image/*');
  if (!f) return;
  await S().run('Loading image…', async () => {
    const img = await normaliseImage(await readAsDataUrl(f));
    placeImage(img.src, img.width * 0.75, img.height * 0.75);
  });
}

// ---------------------------------------------------------------- security

/** Apply a digital signature, download the signed file and reopen it. */
export async function signDocument(o: SignOptions) {
  const s = S();
  if (!s.bytes) return;
  const willEncrypt = s.securityChanged ? !!s.security : !!s.keepEncryption;
  if (willEncrypt) return s.notify('Remove password protection before signing (signing encrypted files is not supported yet).', 'error');
  if (!requirePermission('fillForms') || !confirmBreakingSignatures()) return;
  await s.run('Signing…', async () => {
    const base = unchangedSinceOpen() ? s.originalBytes! : await buildOutput();
    const signed = await signPdf(base, o);
    const name = /-signed\.pdf$/i.test(s.fileName) ? s.fileName : `${baseName(s.fileName || 'document')}-signed.pdf`;
    downloadBlob(signed, name);
    await S().openDocument(signed, name);
    S().setSidebar('signatures');
    S().notify('Signed and saved. Further changes will invalidate the signature unless you sign again.');
  });
}

// ---------------------------------------------------------------- form design

/** Pending (unsaved) form values follow renamed fields and are dropped for deleted ones. */
function moveFormValue(from: string, to: string | null): Record<string, ops.FieldValue> {
  const values = { ...S().formValues };
  if (from in values) {
    if (to) values[to] = values[from];
    delete values[from];
  }
  return values;
}

export async function addField(kind: forms.NewFieldKind, page: number, rect: Rect) {
  if (!requirePermission('designForms')) return;
  await S().run('Adding field…', async () => {
    const { bytes, name } = await forms.createField(S().bytes!, kind, page, rect);
    await S().commitBytes(bytes);
    useStore.setState({ formDesign: true, selectedField: { name, widget: 0 }, selected: null });
  });
}

export async function updateFieldProps(name: string, patch: forms.FieldPatch) {
  if (!requirePermission('designForms')) return;
  await S().run('Updating field…', async () => {
    const bytes = await forms.updateField(S().bytes!, name, patch);
    const parent = name.includes('.') ? name.slice(0, name.lastIndexOf('.') + 1) : '';
    const newName = patch.name && patch.name !== name ? parent + patch.name.trim() : name;
    await S().commitBytes(bytes, undefined, undefined, newName !== name ? moveFormValue(name, newName) : undefined);
    const sel = S().selectedField;
    if (sel?.name === name) useStore.setState({ selectedField: { ...sel, name: newName } });
  });
}

export async function deleteField(name: string) {
  if (!requirePermission('designForms')) return;
  if (!confirm(tf('Delete the form field “{name}”?', { name }))) return;
  await S().run('Deleting field…', async () => {
    await S().commitBytes(await forms.deleteField(S().bytes!, name), undefined, undefined, moveFormValue(name, null));
    useStore.setState({ selectedField: null });
  });
}

export async function moveFieldWidget(name: string, widget: number, rect: Rect) {
  if (!requirePermission('designForms')) return;
  await S().run('Moving field…', async () => S().commitBytes(await forms.setWidgetRect(S().bytes!, name, widget, rect)));
}

export async function addRadioButton(name: string) {
  if (!requirePermission('designForms')) return;
  await S().run('Adding button…', async () => S().commitBytes(await forms.addRadioOption(S().bytes!, name)));
}

// ---------------------------------------------------------------- page content

/** Add an image to the page content (not as an annotation), centred on the current page. */
export async function addContentImage() {
  if (!requirePermission('modify')) return;
  const [f] = await pickFile('image/*');
  if (!f) return;
  const img = await normaliseImage(await readAsDataUrl(f));
  const s = S();
  const index = s.currentPage;
  const g = s.geoms[index];
  const vs = viewSize(g);
  const k = Math.min((vs.width * 0.6) / img.width, (vs.height * 0.6) / img.height, 0.75);
  const w = img.width * k;
  const h = img.height * k;
  const rect = viewRectToPdf(g, { left: (vs.width - w) / 2, top: (vs.height - h) / 2, width: w, height: h });
  const { applyContentEdits, imageBytes } = await import('./content');
  s.setTool('content');
  await applyContentEdits(index, [{ type: 'addImage', rect, image: imageBytes(img.src) }]);
}

/** Lock or unlock all form fields (Acrobat's "Locked" field property). */
export async function setAllFieldsLocked(locked: boolean) {
  if (!requirePermission('designForms')) return;
  await S().run(locked ? 'Locking fields…' : 'Unlocking fields…', async () => {
    const { bytes, changed } = await forms.setFieldsLocked(S().bytes!, locked);
    if (!changed) return S().notify(locked ? 'All fields are already locked.' : 'No fields are locked.');
    await S().commitBytes(bytes);
    S().notify(tf(locked ? 'Locked {n} field widget(s).' : 'Unlocked {n} field widget(s).', { n: changed }));
  });
}

/** Clear read-only, value locks and Locked on every field so the form can be filled and edited. */
export async function makeAllFieldsEditable() {
  if (!requirePermission('designForms')) return;
  await S().run('Updating fields…', async () => {
    const { bytes, changed } = await forms.makeFieldsEditable(S().bytes!);
    if (!changed) return S().notify('All fields are already editable.');
    await S().commitBytes(bytes);
    S().notify(tf('Made {n} field(s) editable.', { n: changed }));
  });
}
