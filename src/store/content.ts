/**
 * Page-content editing commands: reading a page's objects, applying edits,
 * and checking that a page can be rewritten without changing its look.
 */
import { useStore } from './store';
import { requirePermission } from './permissions';
import { describeObjects, editPage, loadForEditing, readPage, writePage, type ContentEdit, type ObjectInfo } from '../lib/content/page';
import { openPdf, renderToCanvas } from '../lib/pdfjs';
import { downloadBlob, baseName } from '../lib/download';
import { pdfRectToView, viewSize } from '../lib/geometry';
import type { Rect } from '../lib/types';

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
  }
  return p;
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
      if (!confirm(`This page uses content the editor cannot reproduce exactly (${pct}% of the page would look different${pc.unknown.length ? `; unsupported operators: ${[...new Set(pc.unknown)].join(', ')}` : ''}). Edit it anyway?`)) return false;
    }
    verified.add(id);
    return true;
  } finally {
    pdf.destroy();
  }
}

// ---------------------------------------------------------------- editing

/** Apply edits to a page's content; selects the affected objects afterwards. */
export async function applyContentEdits(page: number, edits: ContentEdit[]) {
  if (!edits.length || !requirePermission('modify')) return;
  await S().run('Editing page…', async () => {
    if (!(await confirmPageIsEditable(page))) return;
    const doc = await loadForEditing(S().bytes!);
    const ids = await editPage(doc.getPage(page), edits);
    await S().commitBytes(await doc.save({ useObjectStreams: true }));
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
    const g = s.geoms[page];
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
