/** Commands of the Organize tab: glue between its dialogs, the store and the organize library. */
import type * as OpsT from '../lib/pdfOps';
import type * as OrgT from '../lib/organize';
import { ops } from '../lib/worker';
import { org } from '../lib/worker';
import { annotationsByPage, uid, useStore } from './store';
import { requirePermission } from './permissions';
import { currentBytes, deletePages, normaliseImage } from './commands';
import { baseName, downloadBlob, fileBytes, readAsDataUrl } from '../lib/download';
import { renderToCanvas } from '../lib/pdfjs';
import { viewSize } from '../lib/geometry';
import { tr } from '../lib/i18n';
import type { Annotation } from '../lib/types';

const S = () => useStore.getState();

/** Translate a message and fill in {placeholders}. */
export function trf(s: string, vars: Record<string, string | number> = {}): string {
  return tr(s).replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** store.run with a translated label; errors thrown by the library are translated too. */
function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  return S().run(tr(label), async () => {
    try {
      return await fn();
    } catch (e) {
      throw new Error(tr((e as Error).message || String(e)));
    }
  });
}

export const allPages = () => S().pageIds.map((_, i) => i);

/** Displayed page sizes, for orientation filters. */
export const pageSizes = () => S().geoms.map(viewSize);

const cloneAnnots = (list: Annotation[] = []) => list.map((a) => ({ ...a, id: uid('annot') }));

/**
 * Commit bytes built with organize.assemblePages: the first use of a page keeps
 * its id and comments, repeats get fresh ids with copies of the comments, pages
 * from other files get new ids.
 */
async function commitLayout(bytes: Uint8Array, layout: OrgT.PageSource[]) {
  const s = S();
  const seen = new Set<number>();
  const annotations = { ...s.annotations };
  const ids = layout.map((e) => {
    if (typeof e !== 'number') return uid('page');
    if (!seen.has(e)) {
      seen.add(e);
      return s.pageIds[e];
    }
    const id = uid('page');
    annotations[id] = cloneAnnots(s.annotations[s.pageIds[e]]);
    return id;
  });
  await s.commitBytes(bytes, ids, annotations);
}

/** Commit bytes whose page content moved; comments move with it. */
async function commitTransformed(res: OrgT.TransformResult) {
  const s = S();
  const annotations = { ...s.annotations };
  res.transforms.forEach((t, i) => {
    const id = s.pageIds[i];
    if (t && annotations[id]) annotations[id] = annotations[id].map((a) => org.transformAnnotation(a, t));
  });
  await s.commitBytes(res.bytes, undefined, annotations);
}

/** Insert pages that do not exist yet (new ids) before position `at`. */
export async function commitInserted(bytes: Uint8Array, at: number, count: number) {
  const ids = [...S().pageIds];
  ids.splice(at, 0, ...Array.from({ length: count }, () => uid('page')));
  await S().commitBytes(bytes, ids);
  S().setSelectedPages(Array.from({ length: count }, (_, k) => at + k));
  S().goToPage(at);
}

/** The document with comments and form values, for writing pages out to other files. */
async function outputBytes(): Promise<Uint8Array> {
  return ops.exportWithAnnotations(await currentBytes(), annotationsByPage(S()));
}

function dataUrlImage(src: string): OrgT.PageImage {
  const [head, data] = src.split(',');
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { data: bytes, png: head.includes('png') };
}

/** Any browser-decodable image as PNG or JPEG bytes. */
export async function imageFromBlob(b: Blob): Promise<OrgT.PageImage> {
  return dataUrlImage((await normaliseImage(await readAsDataUrl(b))).src);
}

export async function pageCountOf(bytes: Uint8Array): Promise<number> {
  return (await ops.load(bytes)).getPageCount();
}

// ---------------------------------------------------------------- inserting

export async function insertBlankPages(at: number, count: number, size?: [number, number]) {
  if (count < 1 || !requirePermission('assemble')) return;
  await run('Inserting…', async () => commitInserted(await org.insertBlankPages(S().bytes!, at, count, size), at, count));
}

export async function insertImagePages(files: Blob[], at: number, o: OrgT.ImagePageOptions) {
  if (!files.length || !requirePermission('assemble')) return;
  await run('Inserting pages…', async () => {
    const images = await Promise.all(files.map(imageFromBlob));
    await commitInserted(await org.insertImagePages(S().bytes!, images, at, o), at, images.length);
  });
}

/** Make a new page from the image on the clipboard. */
export async function insertClipboardImage(at = S().currentPage + 1) {
  if (!requirePermission('assemble')) return;
  let blob: Blob | null = null;
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) {
        blob = await item.getType(type);
        break;
      }
    }
  } catch {
    return S().notify(tr('The clipboard could not be read. Allow clipboard access and try again.'), 'error');
  }
  if (!blob) return S().notify(tr('There is no image on the clipboard.'), 'error');
  await insertImagePages([blob], at, { size: null, margin: 0 });
}

/** Insert all pages of other PDF files before position `at`, in the given order. */
export async function insertPdfFiles(files: File[], at: number) {
  if (!files.length || !requirePermission('assemble')) return;
  await run('Inserting pages…', async () => {
    let bytes = S().bytes!;
    let pos = at;
    for (const f of files) {
      const res = await ops.insertDocument(bytes, await fileBytes(f), pos);
      bytes = res.bytes;
      pos += res.count;
    }
    await commitInserted(bytes, at, pos - at);
  });
}

/** Insert some pages of another PDF before position `at`. */
export async function insertPagesFromFile(other: Uint8Array, pages: number[], at: number) {
  if (!pages.length) return S().notify(tr('No pages match.'), 'error');
  if (!requirePermission('assemble')) return;
  const n = S().pageIds.length;
  const layout: OrgT.PageSource[] = Array.from({ length: n }, (_, i) => i);
  layout.splice(at, 0, ...pages.map((page) => ({ file: 0, page })));
  await arrange('Inserting pages…', layout, [other]);
  S().setSelectedPages(pages.map((_, k) => at + k));
  S().goToPage(at);
}

// ---------------------------------------------------------------- deleting & extracting

export async function deletePageList(pages: number[]) {
  if (!pages.length) return S().notify(tr('No pages match.'), 'error');
  await deletePages(pages);
}

export async function deleteBlankPages() {
  if (!requirePermission('assemble')) return;
  await run('Looking for blank pages…', async () => {
    const blank = await org.findBlankPages(S().bytes!);
    if (!blank.length) return S().notify(tr('There are no blank pages.'));
    if (blank.length >= S().pageIds.length) return S().notify(tr('A document must keep at least one page.'), 'error');
    if (!confirm(trf('Delete {n} blank page(s): {pages}?', { n: blank.length, pages: org.rangeText(blank) }))) return;
    const ids = S().pageIds.filter((_, i) => !blank.includes(i));
    await S().commitBytes(await ops.deletePages(S().bytes!, blank), ids);
    S().setSelectedPages([]);
    S().notify(trf('Deleted {n} blank page(s).', { n: blank.length }));
  });
}

export interface ExtractOptions {
  /** One file per page instead of a single file. */
  separate: boolean;
  /** Remove the pages from this document afterwards. */
  deleteAfter: boolean;
}

export async function extractPageList(pages: number[], o: ExtractOptions) {
  if (!pages.length) return S().notify(tr('No pages match.'), 'error');
  if (!requirePermission('copy') || (o.deleteAfter && !requirePermission('assemble'))) return;
  if (o.deleteAfter && pages.length >= S().pageIds.length) return S().notify(tr('A document must keep at least one page.'), 'error');
  await run('Extracting…', async () => {
    const name = baseName(S().fileName || 'document');
    const output = await outputBytes();
    if (o.separate) for (const i of pages) downloadBlob(await ops.extractPages(output, [i]), `${name}-p${i + 1}.pdf`);
    else downloadBlob(await ops.extractPages(output, pages), `${name}-p${org.rangeText(pages).replace(/, /g, '_')}.pdf`);
    if (o.deleteAfter) {
      const ids = S().pageIds.filter((_, i) => !pages.includes(i));
      await S().commitBytes(await ops.deletePages(S().bytes!, pages), ids);
      S().setSelectedPages([]);
    }
  });
}

export type SplitMethod =
  | { kind: 'pages'; every: number }
  | { kind: 'ranges'; groups: number[][] }
  | { kind: 'bookmarks' }
  | { kind: 'size'; megabytes: number };

export async function splitDocument(m: SplitMethod) {
  if (!requirePermission('copy')) return;
  await run('Splitting…', async () => {
    const name = baseName(S().fileName || 'document');
    const output = await outputBytes();
    let parts: { title?: string; bytes: Uint8Array }[];
    if (m.kind === 'pages') parts = (await ops.splitEvery(output, Math.max(1, Math.round(m.every)))).map((bytes) => ({ bytes }));
    else if (m.kind === 'ranges') parts = (await org.splitByRanges(output, m.groups)).map((bytes) => ({ bytes }));
    else if (m.kind === 'bookmarks') parts = await org.splitByBookmarks(output);
    else parts = (await org.splitBySize(output, m.megabytes * 1024 * 1024)).map((bytes) => ({ bytes }));
    if (!parts.length) return S().notify(tr('No pages match.'), 'error');
    parts.forEach((p, i) => {
      const title = p.title?.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60);
      downloadBlob(p.bytes, `${name}-${String(i + 1).padStart(String(parts.length).length, '0')}${title ? ` ${title}` : ''}.pdf`);
    });
    S().notify(trf('Created {n} file(s).', { n: parts.length }));
  });
}

// ---------------------------------------------------------------- arranging

export async function arrange(label: string, layout: OrgT.PageSource[], others: Uint8Array[] = []) {
  await run(label, async () => commitLayout(await org.assemblePages(S().bytes!, layout, others), layout));
}

export async function duplicatePageList(pages: number[], copies: number, where: OrgT.DuplicateWhere, collate: boolean) {
  if (!pages.length || copies < 1 || !requirePermission('assemble')) return;
  await arrange('Duplicating…', org.duplicateLayout(S().pageIds.length, pages, Math.round(copies), where, collate));
}

export async function swapPageGroups(a: number[], b: number[]) {
  if (!requirePermission('assemble')) return;
  let layout: number[];
  try {
    layout = org.swapLayout(S().pageIds.length, a, b);
  } catch (e) {
    return S().notify(tr((e as Error).message), 'error');
  }
  await arrange('Swapping pages…', layout);
}

/** Replace pages with pages of another PDF (their comments are dropped). */
export async function replacePageList(targets: number[], other: Uint8Array, sourcePages: number[]) {
  if (!requirePermission('assemble')) return;
  if (!targets.length || !sourcePages.length) return S().notify(tr('No pages match.'), 'error');
  await arrange('Replacing pages…', org.replaceLayout(S().pageIds.length, targets, sourcePages), [other]);
}

/** Reverse the order of the given pages (of the whole document for fewer than two). */
export async function reversePages(pages: number[]) {
  if (!requirePermission('assemble') || S().pageIds.length < 2) return;
  await arrange('Reversing…', org.reverseLayout(S().pageIds.length, pages));
}

export async function rotatePageList(pages: number[], delta: number) {
  if (!pages.length) return S().notify(tr('No pages match.'), 'error');
  if (!requirePermission('assemble')) return;
  await run('Rotating…', async () => S().commitBytes(await ops.rotatePages(S().bytes!, pages, delta)));
}

// ---------------------------------------------------------------- comparing

/** Groups of identical pages; `visual` compares small renderings instead of the page content. */
export async function findDuplicates(visual: boolean): Promise<number[][] | undefined> {
  return run('Looking for duplicate pages…', async () => {
    if (!visual) return org.findDuplicatePages(S().bytes!);
    const pdf = S().pdf!;
    const thumbs: number[][] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const canvas = await renderToCanvas(page, 96 / Math.max(vp.width, vp.height));
      const img = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      // Pages of a different shape are never "the same": keep the aspect in the key.
      thumbs.push([...org.grayThumb(img.data, img.width, img.height, 24), Math.round((vp.width / vp.height) * 1000)]);
    }
    return org.groupSimilar(thumbs, 1.5);
  });
}

/** Delete all but the first page of each group. */
export async function deleteDuplicates(groups: number[][]) {
  const extra = [...new Set(groups.flatMap((g) => g.slice(1)))];
  if (!extra.length || !requirePermission('assemble')) return;
  await run('Deleting…', async () => {
    const ids = S().pageIds.filter((_, i) => !extra.includes(i));
    await S().commitBytes(await ops.deletePages(S().bytes!, extra), ids);
    S().setSelectedPages([]);
    S().notify(trf('Deleted {n} duplicate page(s).', { n: extra.length }));
  });
}

// ---------------------------------------------------------------- page shape

export async function overlayFromFile(other: Uint8Array, o: OrgT.OverlayOptions) {
  if (!o.pages.length) return S().notify(tr('No pages match.'), 'error');
  if (!requirePermission('modify')) return;
  await run('Overlaying pages…', async () => S().commitBytes(await org.overlayPages(S().bytes!, other, o)));
}

export async function normalize(pages: number[], o: OrgT.NormalizeOptions) {
  if (!pages.length || !requirePermission('modify')) return;
  await run('Normalizing pages…', async () => commitTransformed(await org.normalizePages(S().bytes!, pages, o)));
}

export async function resize(pages: number[], o: OrgT.ResizeOptions) {
  if (!pages.length || !requirePermission('modify')) return;
  await run('Resizing pages…', async () => commitTransformed(await org.resizePages(S().bytes!, pages, o)));
}

export async function addMargins(pages: number[], m: OpsT.Margins) {
  if (!pages.length || !requirePermission('modify')) return;
  await run('Adding margins…', async () => S().commitBytes(await org.addMargins(S().bytes!, pages, m)));
}

/** Crop pages to their visible content (rendered without comments), keeping `padding` points around it. */
export async function autoCrop(pages: number[], padding = 6) {
  if (!pages.length || !requirePermission('modify')) return;
  await run('Removing white margins…', async () => {
    const pdf = S().pdf!;
    const scale = 2;
    let bytes = S().bytes!;
    let cropped = 0;
    for (const i of pages) {
      const canvas = await renderToCanvas(await pdf.getPage(i + 1), scale);
      const img = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      const b = org.contentBounds(img.data, img.width, img.height);
      if (!b) continue;
      const m = {
        left: Math.max(0, b.left / scale - padding),
        top: Math.max(0, b.top / scale - padding),
        right: Math.max(0, (img.width - b.right) / scale - padding),
        bottom: Math.max(0, (img.height - b.bottom) / scale - padding),
      };
      if (m.left + m.top + m.right + m.bottom < 1) continue;
      bytes = await ops.cropPages(bytes, [i], m);
      cropped++;
    }
    if (!cropped) return S().notify(tr('No white margins found.'));
    await S().commitBytes(bytes);
    S().notify(trf('Cropped {n} page(s).', { n: cropped }));
  });
}

// ---------------------------------------------------------------- page marks

const MARK_NAMES: Record<OrgT.MarkKind, string> = {
  Watermark: 'watermarks', Background: 'backgrounds', Header: 'headers and footers', Footer: 'headers and footers', BatesN: 'Bates numbers',
};

export async function removeMarks(kinds: OrgT.MarkKind[]) {
  if (!requirePermission('modify')) return;
  const what = tr(MARK_NAMES[kinds[0]]);
  await run('Removing…', async () => {
    const { bytes, removed } = await org.removePageMarks(S().bytes!, kinds);
    if (!removed) return S().notify(trf('There are no {what} to remove.', { what }));
    await S().commitBytes(bytes);
    S().notify(trf('Removed {what} from the pages.', { what }));
  });
}

export async function addWatermark(o: OpsT.WatermarkOptions & { under?: boolean }) {
  if (!requirePermission('modify')) return;
  await run('Adding watermark…', async () => S().commitBytes(await org.addWatermarkMark(S().bytes!, o)));
}

export async function addBackground(o: Omit<OrgT.BackgroundOptions, 'image'> & { imageFile?: Blob | null }) {
  if (!o.pages.length || !requirePermission('modify')) return;
  await run('Adding background…', async () => {
    const image = o.imageFile ? await imageFromBlob(o.imageFile) : null;
    await S().commitBytes(await org.addBackground(S().bytes!, { ...o, image }));
  });
}

export async function addHeadersFooters(o: OrgT.HeaderFooterSet) {
  if (!requirePermission('modify')) return;
  if (!Object.values(o.texts).some((t) => t?.trim())) return S().notify(tr('Enter the text for at least one position.'), 'error');
  await run('Adding header/footer…', async () => S().commitBytes(await org.addHeadersFooters(S().bytes!, o)));
}

export async function addBates(o: OrgT.BatesOptions) {
  if (!o.pages.length || !requirePermission('modify')) return;
  await run('Adding Bates numbers…', async () => S().commitBytes(await org.addBates(S().bytes!, o)));
}

export async function readPageLabels(): Promise<OrgT.PageLabelRange[]> {
  return org.getPageLabels(S().bytes!);
}

export async function setPageLabels(ranges: OrgT.PageLabelRange[]) {
  if (!requirePermission('modify')) return;
  await run('Numbering pages…', async () => S().commitBytes(await org.setPageLabels(S().bytes!, ranges)));
}
