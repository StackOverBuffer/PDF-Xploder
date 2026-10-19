/**
 * Commands behind the page-object context menu: image tools, object
 * clipboard, arranging, layers, links, bookmarks, stamps and export.
 */
import { currentLayers } from './content';
import { create } from 'zustand';
import { useStore } from './store';
import { requirePermission } from './permissions';
import { applyContentEdits, imageBytes, matchesFilter, pageObjects, type ContentFilter } from './content';
import { createLayer, findLayer, isolateObjects, loadForEditing, type LayerInfo, type ObjectInfo, type ContentEdit } from '../lib/content/page';
import { about, scale as scaleM, translate } from '../lib/content/matrix';
import { addBookmark, addLink, type LinkTarget } from '../lib/navigation';
import { openPdf } from '../lib/pdfjs';
import { baseName, downloadBlob } from '../lib/download';
import { tr } from '../lib/i18n';
import type { Rect } from '../lib/types';
import { saveDoc } from '../lib/pdfSave';
import { askText } from '../lib/ask';

const S = () => useStore.getState();

export const union = (rs: Rect[]): Rect => {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};

/** The selected objects of the current content selection. */
export async function selectedObjects(): Promise<{ page: number; objects: ObjectInfo[] } | null> {
  const sel = S().contentSelection;
  if (!sel) return null;
  const all = await pageObjects(sel.page);
  return { page: sel.page, objects: all.filter((o) => sel.ids.includes(o.id)) };
}

// ---------------------------------------------------------------- rendering pieces of a page

/** Render an isolated one-page PDF on a transparent canvas. */
async function renderIsolated(bytes: Uint8Array, scale: number): Promise<HTMLCanvasElement> {
  const { pdf } = await openPdf(bytes, () => null);
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport, background: 'rgba(0,0,0,0)' }).promise;
    return canvas;
  } finally {
    pdf.destroy();
  }
}

const MAX_PIXELS = 36e6;

/** An image object's own pixels (at its native resolution, limited to a sane size). */
export async function imageCanvas(page: number, id: number): Promise<{ canvas: HTMLCanvasElement; encodedSize?: number }> {
  const iso = await isolateObjects(S().bytes!, page, [id], { nativeImage: true });
  const k = Math.min(1, Math.sqrt(MAX_PIXELS / (iso.width * iso.height)));
  return { canvas: await renderIsolated(iso.bytes, k), encodedSize: iso.encodedSize };
}

const toBlob = (c: HTMLCanvasElement, type = 'image/png', quality?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), type, quality));

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.readAsDataURL(b);
  });

function hasAlpha(c: HTMLCanvasElement): boolean {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

const fileStem = () => baseName(S().fileName || 'document');

// ---------------------------------------------------------------- image tools

export async function saveImageAs(page: number, id: number) {
  if (!requirePermission('copy')) return;
  await S().run(tr('Extracting image…'), async () => {
    const { canvas } = await imageCanvas(page, id);
    downloadBlob(await toBlob(canvas), `${fileStem()}-p${page + 1}-image.png`, 'image/png');
  });
}

/** Re-encode an image as JPEG at a quality (0–1) and size (fraction of the original pixels' width). */
export async function recompressImage(page: number, id: number, quality: number, size: number) {
  if (!requirePermission('modify')) return;
  await S().run(tr('Compressing image…'), async () => {
    const { canvas, encodedSize } = await imageCanvas(page, id);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(canvas.width * size));
    out.height = Math.max(1, Math.round(canvas.height * size));
    const g = out.getContext('2d')!;
    const alpha = hasAlpha(canvas);
    // JPEG has no transparency: keep PNG for images that need it.
    if (!alpha) {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, out.width, out.height);
    }
    g.drawImage(canvas, 0, 0, out.width, out.height);
    const blob = alpha ? await toBlob(out) : await toBlob(out, 'image/jpeg', quality);
    await applyContentEdits(page, [{ type: 'replaceImage', id, image: imageBytes(await blobToDataUrl(blob)) }]);
    const kb = (n: number) => `${Math.round(n / 1024)} KB`;
    S().notify(`${tr('Image recompressed')}: ${encodedSize ? `${kb(encodedSize)} → ` : ''}${kb(blob.size)}${alpha ? ` (${tr('PNG, because the image is transparent')})` : ''}`);
  });
}

export async function grayscaleImage(page: number, id: number) {
  if (!requirePermission('modify')) return;
  await S().run(tr('Converting image…'), async () => {
    const { canvas } = await imageCanvas(page, id);
    const g = canvas.getContext('2d')!;
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    g.putImageData(img, 0, 0);
    await applyContentEdits(page, [{ type: 'replaceImage', id, image: imageBytes(canvas.toDataURL('image/png')) }]);
  });
}

interface DetectedBarcode { rawValue: string; format: string }
type BarcodeDetectorCtor = new (o?: { formats?: string[] }) => { detect(src: CanvasImageSource): Promise<DetectedBarcode[]> };

export const barcodesSupported = () => 'BarcodeDetector' in window;

/** Find barcodes and QR codes in an image (needs the browser's BarcodeDetector). */
export async function detectBarcodes(page: number, id: number): Promise<DetectedBarcode[] | null> {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) {
    S().notify(tr('This browser cannot recognise barcodes (supported in Chrome on macOS, Android and ChromeOS).'), 'error');
    return null;
  }
  const res = await S().run(tr('Looking for barcodes…'), async () => {
    const { canvas } = await imageCanvas(page, id);
    return new Ctor().detect(canvas);
  });
  return res ?? null;
}

// ---------------------------------------------------------------- object clipboard

let clip: { bytes: Uint8Array; box: Rect; page: number; text: string } | null = null;
export const hasObjectClipboard = () => !!clip;

export async function copyObjects() {
  if (!requirePermission('copy')) return;
  const sel = await selectedObjects();
  if (!sel?.objects.length) return;
  const iso = await isolateObjects(S().bytes!, sel.page, sel.objects.map((o) => o.id));
  const text = sel.objects.filter((o) => o.kind === 'text').map((o) => o.text).join('\n');
  clip = { bytes: iso.bytes, box: iso.box, page: sel.page, text };
  // Text also goes to the system clipboard, for pasting elsewhere.
  if (text) navigator.clipboard?.writeText(text).catch(() => {});
  S().notify(`${sel.objects.length} ${tr('object(s) copied')}`);
}

export async function cutObjects() {
  if (!requirePermission('modify')) return;
  const sel = S().contentSelection;
  if (!sel) return;
  await copyObjects();
  if (clip) await applyContentEdits(sel.page, [{ type: 'delete', ids: sel.ids }]);
}

/**
 * Paste the copied objects onto `page`. `at` is the user-space point for the
 * top-left corner; without it, pasting on the source page offsets the copy
 * slightly and other pages get it at the same position.
 */
export async function pasteObjects(page = S().currentPage, opts: { at?: { x: number; y: number }; inPlace?: boolean } = {}) {
  if (!clip || !requirePermission('modify')) return;
  const c = clip;
  await S().run(tr('Pasting…'), async () => {
    const doc = await loadForEditing(S().bytes!);
    const [emb] = await doc.embedPdf(c.bytes, [0]);
    const off = opts.at ? { x: opts.at.x - c.box.x, y: opts.at.y - (c.box.y + c.box.h) } : !opts.inPlace && page === c.page ? { x: 10, y: -10 } : { x: 0, y: 0 };
    const bbox = { x: c.box.x + off.x, y: c.box.y + off.y, w: c.box.w, h: c.box.h };
    // The embedded page's form maps its box's lower-left corner to the origin.
    const { editPage } = await import('../lib/content/page');
    const ids = await editPage(doc.getPage(page), [{ type: 'addForm', ref: emb.ref, m: translate(bbox.x, bbox.y), bbox }]);
    await S().commitBytes(await saveDoc(doc));
    S().setTool('content');
    useStore.setState({ contentSelection: ids.length ? { page, ids } : null });
  });
}

// ---------------------------------------------------------------- selecting and arranging

export async function selectObjects(page: number, mode: ContentFilter | 'invert' | 'none') {
  if (S().tool !== 'content') S().setTool('content');
  if (mode === 'none') return useStore.setState({ contentSelection: null });
  const all = await pageObjects(page);
  const current = S().contentSelection?.page === page ? S().contentSelection!.ids : [];
  const ids = mode === 'invert' ? all.filter((o) => matchesFilter(o, S().contentFilter) && !current.includes(o.id)).map((o) => o.id) : all.filter((o) => matchesFilter(o, mode)).map((o) => o.id);
  useStore.setState({ contentSelection: ids.length ? { page, ids } : null, selected: null });
}

export type AlignHow = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Align each object's edge or centre to the selection's box (or the page's, for one object). */
export function alignEdits(chosen: ObjectInfo[], how: AlignHow, pageBox: Rect): ContentEdit[] {
  const ref = chosen.length === 1 ? pageBox : union(chosen.map((o) => o.bbox));
  return chosen.map((o) => {
    const b = o.bbox;
    const dx = how === 'left' ? ref.x - b.x : how === 'right' ? ref.x + ref.w - (b.x + b.w) : how === 'hcenter' ? ref.x + ref.w / 2 - (b.x + b.w / 2) : 0;
    const dy = how === 'bottom' ? ref.y - b.y : how === 'top' ? ref.y + ref.h - (b.y + b.h) : how === 'vcenter' ? ref.y + ref.h / 2 - (b.y + b.h / 2) : 0;
    return { type: 'transform', ids: [o.id], m: translate(dx, dy) };
  });
}

export function distributeEdits(chosen: ObjectInfo[], axis: 'x' | 'y'): ContentEdit[] {
  const box = union(chosen.map((o) => o.bbox));
  const sorted = [...chosen].sort((a, b) => (axis === 'x' ? a.bbox.x - b.bbox.x : a.bbox.y - b.bbox.y));
  const size = (o: ObjectInfo) => (axis === 'x' ? o.bbox.w : o.bbox.h);
  const total = sorted.reduce((n, o) => n + size(o), 0);
  const gap = ((axis === 'x' ? box.w : box.h) - total) / Math.max(1, sorted.length - 1);
  let at = axis === 'x' ? box.x : box.y;
  return sorted.map((o) => {
    const d = at - (axis === 'x' ? o.bbox.x : o.bbox.y);
    at += size(o) + gap;
    return { type: 'transform', ids: [o.id], m: axis === 'x' ? translate(d, 0) : translate(0, d) };
  });
}

export function sameSizeEdits(chosen: ObjectInfo[], dim: 'w' | 'h'): ContentEdit[] {
  const target = chosen[0].bbox[dim];
  return chosen.slice(1).map((o) => {
    const k = target / (o.bbox[dim] || 1);
    return { type: 'transform', ids: [o.id], m: about(dim === 'w' ? scaleM(k, 1) : scaleM(1, k), o.bbox.x, o.bbox.y) };
  });
}

/** Centre the selection on the page horizontally, vertically or both. */
export function centerOnPageEdits(chosen: ObjectInfo[], pageBox: Rect, axis: 'x' | 'y' | 'both'): ContentEdit[] {
  const b = union(chosen.map((o) => o.bbox));
  const dx = axis === 'y' ? 0 : pageBox.x + pageBox.w / 2 - (b.x + b.w / 2);
  const dy = axis === 'x' ? 0 : pageBox.y + pageBox.h / 2 - (b.y + b.h / 2);
  return [{ type: 'transform', ids: chosen.map((o) => o.id), m: translate(dx, dy) }];
}

// ---------------------------------------------------------------- layers

export async function documentLayers(): Promise<LayerInfo[]> {
  return currentLayers();
}

/** Put the selected objects on a layer (`ref`), a new layer (`name`) or no layer (null). */
export async function setObjectsLayer(page: number, ids: number[], layer: { ref: string } | { name: string } | null) {
  if (!requirePermission('modify')) return;
  await S().run(tr('Changing layer…'), async () => {
    const doc = await loadForEditing(S().bytes!);
    const ocg = layer === null ? null : 'ref' in layer ? findLayer(doc, layer.ref) ?? null : createLayer(doc, layer.name);
    const { editPage } = await import('../lib/content/page');
    const next = await editPage(doc.getPage(page), [{ type: 'layer', ids, ocg }]);
    await S().commitBytes(await saveDoc(doc));
    useStore.setState({ contentSelection: next.length ? { page, ids: next } : null });
  });
}

// ---------------------------------------------------------------- links and bookmarks

export async function addBookmarkAt(page: number, y: number | undefined, suggested: string) {
  if (!requirePermission('modify')) return;
  const title = await askText({ title: 'Add bookmark', message: tr('Bookmark title:'), value: suggested.trim().slice(0, 120) || tr('New bookmark'), ok: 'Add' });
  if (!title?.trim()) return;
  await S().run(tr('Adding bookmark…'), async () => {
    await S().commitBytes(await addBookmark(S().bytes!, title.trim(), page, y));
    S().setSidebar('outline');
  });
}

export async function addLinkAt(page: number, rect: Rect, kind: 'page' | 'url') {
  if (!requirePermission('annotate')) return;
  let target: LinkTarget;
  if (kind === 'url') {
    const url = (await askText({ title: 'Add link', message: tr('Web address:'), value: 'https://', ok: 'Add' }))?.trim();
    if (!url || url === 'https://') return;
    target = { url: /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}` };
  } else {
    const n = Number(await askText({ title: 'Add link', message: `${tr('Go to page')} (1–${S().pageIds.length}):`, value: String(S().currentPage + 1), ok: 'Add' }));
    if (!Number.isInteger(n) || n < 1 || n > S().pageIds.length) return;
    target = { page: n - 1 };
  }
  await S().run(tr('Adding link…'), async () => S().commitBytes(await addLink(S().bytes!, page, rect, target)));
}

// ---------------------------------------------------------------- stamps and export

export interface CustomStamp {
  id: string;
  name: string;
  src: string;
  /** Size in points. */
  width: number;
  height: number;
}

const STAMP_KEY = 'awesome-pdf.customStamps';

export function customStamps(): CustomStamp[] {
  try {
    return JSON.parse(localStorage.getItem(STAMP_KEY) || '[]') as CustomStamp[];
  } catch {
    return [];
  }
}

function saveStamps(list: CustomStamp[]) {
  try {
    localStorage.setItem(STAMP_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event('awesome-pdf:stamps'));
  } catch {
    S().notify(tr('The browser could not store the stamp (storage full or disabled).'), 'error');
  }
}

export function deleteCustomStamp(id: string) {
  saveStamps(customStamps().filter((s) => s.id !== id));
}

/** Store the selected objects (or one image's own pixels) as a reusable image stamp. */
export async function stampFromSelection(page: number, ids: number[], opts: { image?: boolean } = {}) {
  if (!requirePermission('copy')) return;
  const name = (await askText({ title: 'Create stamp', message: tr('Stamp name:'), value: opts.image ? tr('Logo') : tr('My stamp'), ok: 'Create' }))?.trim();
  if (!name) return;
  await S().run(tr('Creating stamp…'), async () => {
    let canvas: HTMLCanvasElement;
    let width: number;
    let height: number;
    if (opts.image && ids.length === 1) {
      const all = await pageObjects(page);
      const o = all.find((x) => x.id === ids[0])!;
      canvas = (await imageCanvas(page, ids[0])).canvas;
      width = o.bbox.w;
      height = o.bbox.h;
    } else {
      const iso = await isolateObjects(S().bytes!, page, ids);
      canvas = await renderIsolated(iso.bytes, 2);
      width = iso.box.w;
      height = iso.box.h;
    }
    // Keep stored stamps small: at most 800 px on the long side.
    const k = Math.min(1, 800 / Math.max(canvas.width, canvas.height));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(canvas.width * k));
    out.height = Math.max(1, Math.round(canvas.height * k));
    out.getContext('2d')!.drawImage(canvas, 0, 0, out.width, out.height);
    saveStamps([...customStamps(), { id: `stamp-${Date.now().toString(36)}`, name, src: out.toDataURL('image/png'), width, height }]);
    S().notify(tr('Stamp saved. Find it under Comment → Stamp.'));
  });
}

/** A custom stamp waiting to be placed: it follows the pointer until the user clicks on a page. */
export const usePendingStamp = create<{ stamp: CustomStamp | null }>()(() => ({ stamp: null }));

// Leaving the Stamp tool (Esc, another tool) drops a stamp that was not placed.
useStore.subscribe((st) => {
  if (st.tool !== 'stamp' && usePendingStamp.getState().stamp) usePendingStamp.setState({ stamp: null });
});

/** Pick up a custom stamp: it hangs on the pointer and is placed with the next click. */
export function placeCustomStamp(s: CustomStamp) {
  if (!requirePermission('annotate')) return;
  S().setTool('stamp');
  usePendingStamp.setState({ stamp: s });
}

/** Size of a stamp on a page (view space): its own size, shrunk to fit within 90% of the page. */
export function stampViewSize(s: CustomStamp, page: { width: number; height: number }): { width: number; height: number } {
  const k = Math.min(1, (page.width * 0.9) / s.width, (page.height * 0.9) / s.height);
  return { width: s.width * k, height: s.height * k };
}

/** Save the selected objects as their own PDF (cropped to them). */
export async function newDocumentFromSelection(page: number, ids: number[]) {
  if (!requirePermission('copy')) return;
  await S().run(tr('Creating document…'), async () => {
    const iso = await isolateObjects(S().bytes!, page, ids);
    downloadBlob(iso.bytes, `${fileStem()}-${tr('selection')}.pdf`, 'application/pdf');
  });
}

/** Export the selected objects (without what is behind them) as an image at 300 dpi. */
export async function exportSelection(page: number, ids: number[], format: 'png' | 'jpeg') {
  if (!requirePermission('copy')) return;
  await S().run(tr('Exporting image…'), async () => {
    const iso = await isolateObjects(S().bytes!, page, ids);
    let canvas = await renderIsolated(iso.bytes, 300 / 72);
    if (format === 'jpeg') {
      const flat = document.createElement('canvas');
      flat.width = canvas.width;
      flat.height = canvas.height;
      const g = flat.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, flat.width, flat.height);
      g.drawImage(canvas, 0, 0);
      canvas = flat;
    }
    const type = format === 'png' ? 'image/png' : 'image/jpeg';
    downloadBlob(await toBlob(canvas, type, 0.9), `${fileStem()}-p${page + 1}-${tr('selection')}.${format === 'png' ? 'png' : 'jpg'}`, type);
  });
}
