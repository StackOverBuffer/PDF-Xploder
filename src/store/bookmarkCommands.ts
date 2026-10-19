/** Store glue for the Bookmarks tab. */
import { reportProgress, useStore } from './store';
import { requirePermission } from './permissions';
import { tf, tr } from '../lib/i18n';
import { readOutline, writeOutline, flatten, findNode, type OutlineNode } from '../lib/outline';
import * as bt from '../lib/bookmarkTools';
import { insertTocPages, type TocOptions } from '../lib/tocPages';
import { arrange, commitInserted, deletePageList } from './organizeCommands';
import { baseName, downloadBlob } from '../lib/download';
import { currentViewTarget } from './viewActions';
import { ask } from '../lib/ask';

const S = () => useStore.getState();

export const currentOutline = () => readOutline(S().bytes!);

/** Read the outline, transform it and write it back (one undo step). */
export async function editOutline(label: string, fn: (tree: OutlineNode[]) => OutlineNode[] | Promise<OutlineNode[]>, done?: (tree: OutlineNode[]) => string | void) {
  if (!requirePermission('modify')) return;
  await S().run(label, async () => {
    const tree = await fn(await currentOutline());
    await S().commitBytes(await writeOutline(S().bytes!, tree));
    const msg = done?.(tree);
    if (msg) S().notify(msg);
    S().setSidebar('outline');
  });
}

export type GenerateMode = 'append' | 'replace';
const combine = (mode: GenerateMode, existing: OutlineNode[], added: OutlineNode[]) => (mode === 'replace' ? added : [...existing, ...added]);

export async function bookmarkEveryNth(every: number, template: string, start: number, mode: GenerateMode) {
  const n = S().pageIds.length;
  await editOutline('Adding bookmarks…', (t) => combine(mode, t, bt.bookmarkEveryNth(n, every, template, start)), (t) => tf('{count} bookmark(s) in the document.', { count: bt.countNodes(t) }));
}

/** Text lines of pages with font size and position, from the renderer. */
async function textLines(pages: number[]): Promise<(bt.TextLine & { x: number })[]> {
  const pdf = S().pdf!;
  const out: (bt.TextLine & { x: number })[] = [];
  for (const [k, p] of pages.entries()) {
    reportProgress(k, pages.length);
    const tc = await (await pdf.getPage(p + 1)).getTextContent();
    let cur: (bt.TextLine & { x: number }) | null = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const [a, b, , , x, y] = it.transform as number[];
      const size = Math.hypot(a, b) || it.height;
      if (cur && Math.abs(cur.y - y) < Math.max(cur.size, size) * 0.4 && Math.abs(cur.size - size) < 0.6) {
        cur.text += (/\s$/.test(cur.text) || /^\s/.test(it.str) ? '' : ' ') + it.str;
      } else {
        if (cur) out.push(cur);
        cur = { page: p, text: it.str, size, y: y + size * 0.8, x };
      }
      if (it.hasEOL && cur) {
        out.push(cur);
        cur = null;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

export async function bookmarksFromHeadings(pages: number[], levels: number, mode: GenerateMode) {
  await editOutline('Looking for headings…', async (t) => {
    const found = bt.bookmarksFromHeadings(await textLines(pages), { maxLevels: levels });
    if (!found.length) throw new Error(tr('No headings were found (the pages need real text; run OCR on scans first).'));
    return combine(mode, t, found);
  }, (t) => tf('{count} bookmark(s) in the document.', { count: bt.countNodes(t) }));
}

export async function bookmarksFromToc(tocPages: number[], offset: number, mode: GenerateMode) {
  const n = S().pageIds.length;
  await editOutline('Reading the table of contents…', async (t) => {
    const found = bt.bookmarksFromToc(await textLines(tocPages), n, offset);
    if (!found.length) throw new Error(tr('No entries like “Title …… 12” were found on these pages.'));
    return combine(mode, t, found);
  }, (t) => tf('{count} bookmark(s) in the document.', { count: bt.countNodes(t) }));
}

export async function bookmarksFromText(text: string, mode: GenerateMode) {
  const n = S().pageIds.length;
  await editOutline('Adding bookmarks…', (t) => combine(mode, t, bt.bookmarksFromText(text, n)), (t) => tf('{count} bookmark(s) in the document.', { count: bt.countNodes(t) }));
}

export const changeCase = (mode: bt.CaseMode) => editOutline('Updating bookmarks…', (t) => bt.changeCaseAll(t, mode));

export async function replaceInTitles(find: string, replace: string, opts: { regex?: boolean; matchCase?: boolean }) {
  let changed = 0;
  await editOutline('Updating bookmarks…', (t) => {
    const r = bt.replaceTitles(t, find, replace, opts);
    changed = r.changed;
    return r.tree;
  }, () => tf('{count} title(s) changed.', { count: changed }));
}

export const addText = (prefix: string, suffix: string) => editOutline('Updating bookmarks…', (t) => bt.addTitleText(t, prefix, suffix));

export async function mergeDuplicates() {
  let merged = 0;
  await editOutline('Merging duplicate bookmarks…', (t) => {
    const r = bt.mergeDuplicates(t);
    merged = r.merged;
    return r.tree;
  }, () => tf('{count} duplicate bookmark(s) merged.', { count: merged }));
}

export async function removeActions() {
  let removed = 0;
  await editOutline('Removing actions…', (t) => {
    const r = bt.removeActions(t);
    removed = r.removed;
    return r.tree;
  }, () => tf('Actions removed from {count} bookmark(s).', { count: removed }));
}

export async function deleteAllBookmarks() {
  if (!(await ask({ message: tr('Delete all bookmarks?'), ok: 'Delete', danger: true }))) return;
  await editOutline('Deleting bookmarks…', () => []);
}

export async function exportBookmarks(format: 'txt' | 'html') {
  const tree = await currentOutline();
  if (!tree.length) return S().notify(tr('This document has no bookmarks.'));
  const name = baseName(S().fileName || 'document');
  if (format === 'txt') downloadBlob(new Blob([bt.bookmarksToText(tree)], { type: 'text/plain;charset=utf-8' }), `${name}-${tr('bookmarks')}.txt`, 'text/plain');
  else downloadBlob(new Blob([bt.bookmarksToHtml(tree, name, S().fileName || undefined)], { type: 'text/html;charset=utf-8' }), `${name}-${tr('bookmarks')}.html`, 'text/html');
}

export async function sortPagesByBookmarks() {
  if (!requirePermission('assemble')) return;
  const tree = await currentOutline();
  const order = bt.pageOrderByBookmarks(tree, S().pageIds.length);
  if (order.every((p, i) => p === i)) return S().notify(tr('The pages are already in bookmark order.'));
  await arrange(tr('Sorting pages…'), order);
}

/** Delete the pages a bookmark covers: from its page up to the next bookmark's page. */
export async function deleteBookmarkPages(id: string) {
  if (!requirePermission('assemble')) return;
  const tree = await currentOutline();
  const node = findNode(tree, id);
  if (node?.page === undefined) return;
  const starts = [...new Set(flatten(tree, () => true).map((r) => r.node.page).filter((p): p is number => p !== undefined))].sort((a, b) => a - b);
  const end = starts.find((p) => p > node.page!) ?? S().pageIds.length;
  const pages = Array.from({ length: end - node.page }, (_, i) => node.page! + i);
  if (!(await ask({ message: tf('Delete page(s) {from}–{to} that “{title}” points to?', { from: node.page + 1, to: end, title: node.title }), ok: 'Delete', danger: true }))) return;
  await deletePageList(pages);
}

export async function buildToc(o: TocOptions) {
  if (!requirePermission('assemble')) return;
  await S().run(tr('Building the table of contents…'), async () => {
    const tree = await currentOutline();
    const { bytes, count } = await insertTocPages(S().bytes!, tree, o);
    await commitInserted(bytes, 0, count);
  });
}

/** Go to the next or previous bookmark (in document order) from the current view. */
export async function goToBookmark(dir: 1 | -1) {
  const tree = await currentOutline();
  const items = flatten(tree, () => true).map((r) => r.node).filter((n) => n.page !== undefined);
  if (!items.length) return;
  const here = currentViewTarget();
  // Order by page, then top to bottom.
  const key = (n: OutlineNode) => n.page! * 1e5 - (n.y ?? 1e4);
  const hereKey = here.page * 1e5 - (here.y ?? 1e4) + dir * 0.5;
  const sorted = [...items].sort((a, b) => key(a) - key(b));
  const target = dir > 0 ? sorted.find((n) => key(n) > hereKey + 2) : [...sorted].reverse().find((n) => key(n) < hereKey - 2);
  if (target) S().goToPage(target.page!, target.y);
}
