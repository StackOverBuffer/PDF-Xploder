/**
 * Page-content editing commands: reading a page's objects, applying edits,
 * and checking that a page can be rewritten without changing its look.
 */
import { useStore } from './store';
import { requirePermission } from './permissions';
import { tf } from '../lib/i18n';
import { loadForEditing, type ContentEdit, type ObjectInfo } from '../lib/content/page';
import { content as contentW } from '../lib/worker';
import { openPdf, renderToCanvas, type PDFPageProxy } from '../lib/pdfjs';
import { downloadBlob, baseName } from '../lib/download';
import { pageGeom, pdfRectToView, viewSize } from '../lib/geometry';
import type { Rect } from '../lib/types';
import { ask } from '../lib/ask';

const S = () => useStore.getState();

export type ContentFilter = 'all' | 'text' | 'image' | 'shape';

export const matchesFilter = (o: ObjectInfo, f: ContentFilter) =>
  f === 'all' || (f === 'text' ? o.kind === 'text' : f === 'image' ? o.kind === 'image' : o.kind === 'path' || o.kind === 'form' || o.kind === 'shading');

// ---------------------------------------------------------------- reading

/** A key per document version, so the worker parses a version once for all its reads. */
const keys = new WeakMap<Uint8Array, string>();
let nextKey = 1;
export function bytesKey(bytes: Uint8Array): string {
  let k = keys.get(bytes);
  if (!k) keys.set(bytes, (k = `doc${nextKey++}`));
  return k;
}

let objectCache: { bytes: Uint8Array; pages: Map<number, Promise<ObjectInfo[]>> } | null = null;

/** The objects on a page of the current document (parsed in the worker). */
export function pageObjects(page: number): Promise<ObjectInfo[]> {
  const bytes = S().bytes!;
  if (objectCache?.bytes !== bytes) objectCache = { bytes, pages: new Map() };
  const cache = objectCache.pages;
  let p = cache.get(page);
  if (!p) {
    p = contentW.objectsOnPage(bytes, page, bytesKey(bytes));
    cache.set(page, p);
    // A failure must not stick: try again next time.
    p.catch(() => cache.get(page) === p && cache.delete(page));
  }
  return p;
}

let layerDoc: { bytes: Uint8Array; doc: ReturnType<typeof loadForEditing> } | null = null;

/** The layers of the current document (cached with the parsed document). */
export async function currentLayers() {
  const { listLayers } = await import('../lib/content/page');
  const bytes = S().bytes!;
  if (layerDoc?.bytes !== bytes) layerDoc = { bytes, doc: loadForEditing(bytes) };
  return listLayers(await layerDoc.doc);
}

// ---------------------------------------------------------------- safety check

/** A rendering for comparing a page before and after rewriting: small, at most 1500 px on the longer side (big sheets). */
function checkRender(page: PDFPageProxy) {
  const [x0, y0, x1, y1] = page.view;
  return renderToCanvas(page, Math.min(0.75, 1500 / Math.max(x1 - x0, y1 - y0)));
}

/** Pages (by page id) known to survive being rewritten. */
const verified = new Set<string>();

function diffFraction(a: HTMLCanvasElement, b: HTMLCanvasElement): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const da = a.getContext('2d')!.getImageData(0, 0, a.width, a.height).data;
  const db = b.getContext('2d')!.getImageData(0, 0, b.width, b.height).data;
  let bad = 0;
  for (let i = 0; i < da.length; i += 4) {
    if (Math.abs(da[i] - db[i]) > 40 || Math.abs(da[i + 1] - db[i + 1]) > 40 || Math.abs(da[i + 2] - db[i + 2]) > 40) bad++;
  }
  return bad / (da.length / 4);
}

/**
 * Before the first edit of a page, rewrite it without changes and compare
 * renderings. If the editor cannot reproduce it faithfully, ask first.
 */
async function confirmPageIsEditable(page: number): Promise<boolean> {
  const s = S();
  const id = s.pageIds[page];
  if (verified.has(id)) return true;
  const rewritten = await contentW.rewriteForCheck(s.bytes!, [page]);
  const pc = { unknown: rewritten.unknown[0]?.[1] ?? [] };
  const { pdf } = await openPdf(rewritten.bytes, () => null, { handOver: true });
  try {
    const before = await checkRender(await s.pdf!.getPage(page + 1));
    const after = await checkRender(await pdf.getPage(page + 1));
    const diff = diffFraction(before, after);
    if (diff > 0.002 || pc.unknown.length) {
      const pct = (diff * 100).toFixed(1);
      const ops = pc.unknown.length ? tf('; unsupported operators: {ops}', { ops: [...new Set(pc.unknown)].join(', ') }) : '';
      if (!(await ask({ title: 'Edit page content', message: tf('This page uses content the editor cannot reproduce exactly ({pct}% of the page would look different{ops}). Edit it anyway?', { pct, ops }), ok: 'Edit anyway' }))) return false;
    }
    verified.add(id);
    return true;
  } finally {
    pdf.destroy();
  }
}

/**
 * Check several pages at once (find and replace): asks once about pages the
 * editor cannot reproduce exactly. Returns the pages that may be edited.
 */
export async function confirmPagesEditable(pages: number[]): Promise<number[]> {
  const s = S();
  const todo = pages.filter((p) => !verified.has(s.pageIds[p]));
  if (!todo.length) return pages;
  const rewritten = await contentW.rewriteForCheck(s.bytes!, todo);
  const unknown = new Set(rewritten.unknown.map(([p]) => p));
  const { pdf } = await openPdf(rewritten.bytes, () => null, { handOver: true });
  const risky: number[] = [];
  try {
    for (const p of todo) {
      const before = await checkRender(await s.pdf!.getPage(p + 1));
      const after = await checkRender(await pdf.getPage(p + 1));
      if (unknown.has(p) || diffFraction(before, after) > 0.002) risky.push(p);
      else verified.add(s.pageIds[p]);
    }
  } finally {
    pdf.destroy();
  }
  if (!risky.length) return pages;
  const list = risky.map((p) => p + 1).join(', ');
  if (await ask({ title: 'Edit page content', message: tf('The editor cannot reproduce some pages exactly (pages {list}): they would look slightly different after the change. Edit them anyway? Cancel leaves those pages unchanged.', { list }), ok: 'Edit anyway' })) {
    for (const p of risky) verified.add(s.pageIds[p]);
    return pages;
  }
  return pages.filter((p) => !risky.includes(p));
}

/** Pages rewritten by the editor are in normalised form and need no further check. */
export function markPagesVerified(pages: number[]) {
  for (const p of pages) verified.add(S().pageIds[p]);
}

// ---------------------------------------------------------------- editing

/** Content edits run one after another: each starts from the result of the previous one. */
let chain: Promise<unknown> = Promise.resolve();

/** Apply edits to a page's content; selects the affected objects afterwards. */
export function applyContentEdits(page: number, edits: ContentEdit[]): Promise<void> {
  const next = chain.then(() => applyNow(page, edits));
  chain = next.catch(() => {});
  return next;
}

async function applyNow(page: number, edits: ContentEdit[]) {
  if (!edits.length || !requirePermission('modify')) return;
  await S().run('Editing page…', async () => {
    if (!(await confirmPageIsEditable(page))) return;
    const { bytes, ids } = await contentW.editPageContent(S().bytes!, page, edits);
    await S().commitBytes(bytes);
    // The rewritten page is in normalised form: no need to check it again.
    verified.add(S().pageIds[page]);
    useStore.setState({ contentSelection: ids.length ? { page, ids } : null });
  });
}

/** Render a page region (user-space rect) at high resolution and download it as PNG. */
export async function exportRegionAsImage(page: number, rect: Rect, label = 'selection') {
  if (!requirePermission('copy')) return;
  await S().run('Exporting image…', async () => {
    const s = S();
    const scale = 300 / 72;
    const canvas = await renderToCanvas(await s.pdf!.getPage(page + 1), scale);
    const g = pageGeom(s.geoms[page]);
    const v = pdfRectToView(g, rect);
    const vs = viewSize(g);
    const sx = canvas.width / vs.width;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(v.width * sx));
    out.height = Math.max(1, Math.round(v.height * sx));
    out.getContext('2d')!.drawImage(canvas, v.left * sx, v.top * sx, out.width, out.height, 0, 0, out.width, out.height);
    const blob = await new Promise<Blob>((res) => out.toBlob((b) => res(b!), 'image/png'));
    downloadBlob(blob, `${baseName(s.fileName || 'document')}-p${page + 1}-${label}.png`, 'image/png');
  });
}

/** Convert an image data URL to bytes for embedding. */
export function imageBytes(src: string): { bytes: Uint8Array; png: boolean } {
  const [head, data] = src.split(',');
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, png: head.includes('png') };
}

/** Select all, none, or the inverse of the selection among the current page's objects (respecting the filter). */
export async function selectContent(mode: 'all' | 'none' | 'invert') {
  const s = S();
  if (!s.pdf) return;
  if (s.tool !== 'content') s.setTool('content');
  const page = s.currentPage;
  if (mode === 'none') return useStore.setState({ contentSelection: null });
  const objects = (await pageObjects(page)).filter((o) => matchesFilter(o, S().contentFilter));
  const current = S().contentSelection?.page === page ? S().contentSelection!.ids : [];
  const ids = mode === 'all' ? objects.map((o) => o.id) : objects.map((o) => o.id).filter((id) => !current.includes(id));
  useStore.setState({ contentSelection: ids.length ? { page, ids } : null, selected: null });
}
