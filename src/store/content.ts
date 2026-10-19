/**
 * Page-content editing commands: reading a page's objects, applying edits,
 * and checking that a page can be rewritten without changing its look.
 */
import { useStore } from './store';
import { requirePermission } from './permissions';
import { tf } from '../lib/i18n';
import { describeObjects, editPage, loadForEditing, readPage, writePage, type ContentEdit, type ObjectInfo } from '../lib/content/page';
import { openPdf, renderToCanvas } from '../lib/pdfjs';
import { downloadBlob, baseName } from '../lib/download';
import { pageGeom, pdfRectToView, viewSize } from '../lib/geometry';
import type { Rect } from '../lib/types';
import { saveDoc } from '../lib/pdfSave';
import { ask } from '../lib/ask';

const S = () => useStore.getState();

export type ContentFilter = 'all' | 'text' | 'image' | 'shape';

export const matchesFilter = (o: ObjectInfo, f: ContentFilter) =>
  f === 'all' || (f === 'text' ? o.kind === 'text' : f === 'image' ? o.kind === 'image' : o.kind === 'path' || o.kind === 'form' || o.kind === 'shading');

// ---------------------------------------------------------------- reading

let docCache: { bytes: Uint8Array; doc: ReturnType<typeof loadForEditing> } | null = null;
const objectCache = new Map<string, Promise<ObjectInfo[]>>();

function currentDoc() {
  const bytes = S().bytes!;
  if (docCache?.bytes !== bytes) {
    docCache = { bytes, doc: loadForEditing(bytes) };
    objectCache.clear();
  }
  return docCache.doc;
}

/** The objects on a page of the current document. */
export function pageObjects(page: number): Promise<ObjectInfo[]> {
  currentDoc();
  const key = String(page);
  let p = objectCache.get(key);
  if (!p) {
    p = currentDoc().then((doc) => describeObjects(readPage(doc.getPage(page))));
    objectCache.set(key, p);
    // A failure must not stick: try again next time.
    p.catch(() => objectCache.get(key) === p && objectCache.delete(key));
  }
  return p;
}

/** The layers of the current document (cached with the parsed document). */
export async function currentLayers() {
  const { listLayers } = await import('../lib/content/page');
  return listLayers(await currentDoc());
}

// ---------------------------------------------------------------- safety check

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
  const doc = await loadForEditing(s.bytes!);
  const pc = readPage(doc.getPage(page));
  writePage(doc.getPage(page), pc.objects);
  const { pdf } = await openPdf(await doc.save(), () => null);
  try {
    const before = await renderToCanvas(await s.pdf!.getPage(page + 1), 0.75);
    const after = await renderToCanvas(await pdf.getPage(page + 1), 0.75);
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
  const doc = await loadForEditing(s.bytes!);
  const unknown = new Set<number>();
  for (const p of todo) {
    const pc = readPage(doc.getPage(p));
    if (pc.unknown.length) unknown.add(p);
    writePage(doc.getPage(p), pc.objects);
  }
  const { pdf } = await openPdf(await doc.save(), () => null);
  const risky: number[] = [];
  try {
    for (const p of todo) {
      const before = await renderToCanvas(await s.pdf!.getPage(p + 1), 0.75);
      const after = await renderToCanvas(await pdf.getPage(p + 1), 0.75);
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
    const doc = await loadForEditing(S().bytes!);
    const ids = await editPage(doc.getPage(page), edits);
    await S().commitBytes(await saveDoc(doc));
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
