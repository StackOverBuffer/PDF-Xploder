/**
 * Bookmark tools from PDF-XChange's Bookmarks tab: generating bookmarks,
 * bulk-editing titles, cleaning up and exporting the outline. All work on
 * the editable tree from ./outline.
 */
import { newNodeId, type OutlineNode } from './outline';

const make = (title: string, page?: number, y?: number, children: OutlineNode[] = []): OutlineNode => ({
  id: newNodeId(), title, page, y, open: false, bold: false, italic: false, children,
});

/** Visit every node (depth first); `fn` returns the replacement. */
export function mapTree(nodes: OutlineNode[], fn: (n: OutlineNode) => OutlineNode): OutlineNode[] {
  return nodes.map((n) => fn({ ...n, children: mapTree(n.children, fn) }));
}

export function countNodes(nodes: OutlineNode[]): number {
  return nodes.reduce((k, n) => k + 1 + countNodes(n.children), 0);
}

// ---------------------------------------------------------------- generating

/** One bookmark every `every` pages, titled from a template with {page} (1-based) and {n} (running number). */
export function bookmarkEveryNth(pageCount: number, every: number, template: string, start = 0): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (let p = start, n = 1; p < pageCount; p += Math.max(1, every), n++) out.push(make(template.replace(/\{page\}/g, String(p + 1)).replace(/\{n\}/g, String(n)), p));
  return out;
}

/** A line of page text with its size (for heading detection). */
export interface TextLine {
  page: number;
  text: string;
  /** Font size in points. */
  size: number;
  /** Top of the line in user space. */
  y: number;
  bold?: boolean;
}

/**
 * Headings are lines set noticeably larger than the body text. The largest
 * sizes become levels 1..maxLevels, nested under the previous bigger heading.
 */
export function bookmarksFromHeadings(lines: TextLine[], opts: { maxLevels?: number; minRatio?: number; maxLength?: number } = {}): OutlineNode[] {
  const { maxLevels = 3, minRatio = 1.15, maxLength = 90 } = opts;
  let clean = lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() })).filter((l) => l.text && /\p{L}/u.test(l.text));
  if (!clean.length) return [];
  // Running headers/footers (the same text on most pages) are not headings.
  const pages = new Set(clean.map((l) => l.page)).size;
  if (pages >= 3) {
    const onPages = new Map<string, Set<number>>();
    for (const l of clean) onPages.set(l.text, (onPages.get(l.text) ?? new Set()).add(l.page));
    // Only lines at the very top or bottom of their page count as running headers/footers.
    const top = new Map<number, number>();
    const bottom = new Map<number, number>();
    for (const l of clean) {
      top.set(l.page, Math.max(top.get(l.page) ?? -Infinity, l.y));
      bottom.set(l.page, Math.min(bottom.get(l.page) ?? Infinity, l.y));
    }
    const atEdge = (l: TextLine) => l.y >= top.get(l.page)! - l.size * 2 || l.y <= bottom.get(l.page)! + l.size * 2;
    clean = clean.filter((l) => !(atEdge(l) && onPages.get(l.text)!.size >= Math.max(2, pages * 0.5)));
  }
  // Body size: the size covering the most characters.
  const weight = new Map<number, number>();
  for (const l of clean) weight.set(round(l.size), (weight.get(round(l.size)) ?? 0) + l.text.length);
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];
  // Sizes whose lines are as long as body lines are paragraphs (e.g. an intro), not headings.
  const stats = new Map<number, { chars: number; lines: number }>();
  for (const l of clean) {
    const st = stats.get(round(l.size)) ?? { chars: 0, lines: 0 };
    st.chars += l.text.length;
    st.lines++;
    stats.set(round(l.size), st);
  }
  const avg = (size: number) => stats.get(size)!.chars / stats.get(size)!.lines;
  const bodyAvg = avg(body);
  const headingSizes = [...new Set(clean.filter((l) => l.size >= body * minRatio).map((l) => round(l.size)))]
    .filter((size) => avg(size) < Math.max(25, bodyAvg * 0.7))
    .sort((a, b) => b - a)
    .slice(0, maxLevels);
  const sentence = (t: string) => t.length > 25 && /[.,;:!?]$/.test(t) && !/^\d+(\.\d+)*\.?$/.test(t);
  const level = (l: TextLine) => headingSizes.indexOf(round(l.size));
  const roots: OutlineNode[] = [];
  const stack: { node: OutlineNode; level: number }[] = [];
  for (const l of clean) {
    const lv = level(l);
    if (lv < 0 || l.text.length > maxLength || sentence(l.text)) continue;
    // Consecutive lines of the same heading (wrapped titles) are joined.
    const last = stack[stack.length - 1];
    if (last && last.level === lv && last.node.page === l.page && last.node.y !== undefined && Math.abs(last.node.y - l.y) < l.size * 1.6 && !last.node.children.length) {
      last.node.title += ' ' + l.text;
      last.node.y = Math.max(last.node.y, l.y);
      continue;
    }
    const node = make(l.text, l.page, Math.round(l.y + l.size * 0.2));
    while (stack.length && stack[stack.length - 1].level >= lv) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ node, level: lv });
  }
  return roots;
}

const round = (x: number) => Math.round(x * 2) / 2;

/**
 * Parse a table of contents: lines like "2.1 Title ........ 17" or
 * "Title 17". Numbering depth (1, 1.2, 1.2.3) or indentation sets the level.
 * `offset` is added to the printed page numbers (e.g. for front matter).
 */
export function bookmarksFromToc(lines: { text: string; x?: number }[], pageCount: number, offset = 0): OutlineNode[] {
  const entries: { title: string; page: number; level: number; x: number }[] = [];
  for (const l of lines) {
    const m = /^(.*?\S)[\s.·…_-]{2,}(\d{1,5})\s*$/.exec(l.text.trim()) ?? /^(.*\D)\s(\d{1,5})\s*$/.exec(l.text.trim());
    if (!m) continue;
    const page = Number(m[2]) - 1 + offset;
    if (page < 0 || page >= pageCount) continue;
    const title = m[1].replace(/[\s.·…_-]+$/, '').trim();
    if (!title || !/\p{L}/u.test(title)) continue;
    const num = /^(\d+(?:\.\d+)*)\.?\s/.exec(title);
    entries.push({ title, page, level: num ? num[1].split('.').length - 1 : -1, x: l.x ?? 0 });
  }
  // Without numbering, indentation decides: distinct x positions from left to right.
  const xs = [...new Set(entries.filter((e) => e.level < 0).map((e) => Math.round(e.x / 6)))].sort((a, b) => a - b);
  for (const e of entries) if (e.level < 0) e.level = Math.max(0, xs.indexOf(Math.round(e.x / 6)));
  return nest(entries.map((e) => ({ node: make(e.title, e.page), level: e.level })));
}

/**
 * Bookmarks from a text file: one per line, nesting by leading tabs (or
 * two/four spaces), optional page number at the end after a tab, "|" or
 * several spaces/dots. Lines without a page number get the next page with one.
 */
export function bookmarksFromText(text: string, pageCount: number): OutlineNode[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const unit = lines.some((l) => l.startsWith('\t')) ? null : Math.min(...lines.map((l) => /^ +/.exec(l)?.[0].length ?? 99).filter((n) => n > 0), 99);
  const parsed = lines.map((l) => {
    const indent = /^[\t ]*/.exec(l)![0];
    const level = unit === null ? (indent.match(/\t/g) ?? []).length : unit === 99 ? 0 : Math.round(indent.length / unit);
    const m = /^(.*?)(?:\t+|\s*\|\s*|\s{2,}|\s*\.{3,}\s*)(\d{1,5})\s*$/.exec(l.trim());
    const page = m ? Math.min(pageCount, Math.max(1, Number(m[2]))) - 1 : undefined;
    return { title: (m ? m[1] : l.trim()).trim(), page, level };
  });
  for (let i = parsed.length - 1, next: number | undefined; i >= 0; i--) {
    if (parsed[i].page === undefined) parsed[i].page = next;
    else next = parsed[i].page;
  }
  return nest(parsed.map((p) => ({ node: make(p.title, p.page), level: p.level })));
}

function nest(items: { node: OutlineNode; level: number }[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: { node: OutlineNode; level: number }[] = [];
  for (const it of items) {
    while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(it.node);
    else roots.push(it.node);
    stack.push(it);
  }
  return roots;
}

// ---------------------------------------------------------------- titles

export type CaseMode = 'upper' | 'lower' | 'title' | 'sentence';

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'und', 'oder', 'der', 'die', 'das', 'im', 'in', 'zu', 'von', 'mit', 'für']);

export function changeCase(s: string, mode: CaseMode): string {
  if (mode === 'upper') return s.toLocaleUpperCase();
  if (mode === 'lower') return s.toLocaleLowerCase();
  if (mode === 'sentence') {
    const l = s.toLocaleLowerCase();
    return l.replace(/\p{L}/u, (c) => c.toLocaleUpperCase());
  }
  return s
    .toLocaleLowerCase()
    .split(/(\s+)/)
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/\p{L}/u, (c) => c.toLocaleUpperCase())))
    .join('');
}

export function changeCaseAll(nodes: OutlineNode[], mode: CaseMode): OutlineNode[] {
  return mapTree(nodes, (n) => ({ ...n, title: changeCase(n.title, mode) }));
}

/** Find and replace in titles; returns the new tree and the number of titles changed. */
export function replaceTitles(nodes: OutlineNode[], find: string, replace: string, opts: { regex?: boolean; matchCase?: boolean } = {}): { tree: OutlineNode[]; changed: number } {
  if (!find) return { tree: nodes, changed: 0 };
  const flags = 'g' + (opts.matchCase ? '' : 'i') + 'u';
  const re = new RegExp(opts.regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  let changed = 0;
  const tree = mapTree(nodes, (n) => {
    const title = n.title.replace(re, opts.regex ? replace : replace.replace(/\$/g, '$$$$'));
    if (title !== n.title) changed++;
    return { ...n, title };
  });
  return { tree, changed };
}

/** Add text before/after every title; {page} and {n} are replaced (n = running number). */
export function addTitleText(nodes: OutlineNode[], prefix: string, suffix: string): OutlineNode[] {
  let n = 0;
  const fill = (s: string, node: OutlineNode) => s.replace(/\{page\}/g, node.page === undefined ? '' : String(node.page + 1)).replace(/\{n\}/g, String(n));
  return nodes.map(function walk(node): OutlineNode {
    n++;
    const self = { ...node, title: fill(prefix, node) + node.title + fill(suffix, node) };
    return { ...self, children: node.children.map(walk) };
  });
}

// ---------------------------------------------------------------- cleaning up

/** Merge siblings that have the same title and destination; their children are combined. */
export function mergeDuplicates(nodes: OutlineNode[]): { tree: OutlineNode[]; merged: number } {
  let merged = 0;
  const walk = (list: OutlineNode[]): OutlineNode[] => {
    const out: OutlineNode[] = [];
    for (const n of list) {
      const twin = out.find((o) => o.title.trim() === n.title.trim() && o.page === n.page && (o.y === undefined || n.y === undefined || Math.abs(o.y - n.y) < 2) && o.action === n.action);
      if (twin) {
        twin.children = [...twin.children, ...n.children];
        merged++;
      } else out.push({ ...n, children: [...n.children] });
    }
    return out.map((o) => ({ ...o, children: walk(o.children) }));
  };
  return { tree: walk(nodes), merged };
}

/** Bookmarks that run actions instead of going to a page lose the action (they stay as plain titles). */
export function removeActions(nodes: OutlineNode[]): { tree: OutlineNode[]; removed: number } {
  let removed = 0;
  const tree = mapTree(nodes, (n) => {
    if (!n.action || n.page !== undefined) return n;
    removed++;
    return { ...n, action: undefined, clearAction: true };
  });
  return { tree, removed };
}

export interface BookmarkProblem {
  id: string;
  title: string;
  problem: 'no-destination' | 'bad-page' | 'empty-title' | 'action';
  detail?: string;
}

/** Check every bookmark: has a title, a destination, and the destination is in the document. */
export function validateBookmarks(nodes: OutlineNode[], pageCount: number): BookmarkProblem[] {
  const out: BookmarkProblem[] = [];
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      if (!n.title.trim()) out.push({ id: n.id, title: n.title, problem: 'empty-title' });
      if (n.page === undefined && !n.action) out.push({ id: n.id, title: n.title, problem: 'no-destination' });
      else if (n.page !== undefined && (n.page < 0 || n.page >= pageCount)) out.push({ id: n.id, title: n.title, problem: 'bad-page' });
      else if (n.action && n.page === undefined) out.push({ id: n.id, title: n.title, problem: 'action', detail: n.action });
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

// ---------------------------------------------------------------- exporting

export function bookmarksToText(nodes: OutlineNode[], opts: { pages?: boolean; indent?: string } = {}): string {
  const { pages = true, indent = '\t' } = opts;
  const lines: string[] = [];
  const walk = (list: OutlineNode[], depth: number) => {
    for (const n of list) {
      lines.push(indent.repeat(depth) + n.title + (pages && n.page !== undefined ? `\t${n.page + 1}` : ''));
      walk(n.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return lines.join('\n') + '\n';
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A standalone HTML page; page links point into the PDF with #page=N when `pdfName` is given. */
export function bookmarksToHtml(nodes: OutlineNode[], title: string, pdfName?: string): string {
  const list = (ns: OutlineNode[]): string =>
    ns.length
      ? `<ul>${ns
          .map((n) => {
            const style = [n.bold ? 'font-weight:bold' : '', n.italic ? 'font-style:italic' : '', n.color ? `color:${n.color}` : ''].filter(Boolean).join(';');
            const label = `<span${style ? ` style="${style}"` : ''}>${esc(n.title)}</span>`;
            const target = n.page !== undefined ? (pdfName ? `<a href="${esc(encodeURI(pdfName))}#page=${n.page + 1}">${label}</a> <small>${n.page + 1}</small>` : `${label} <small>${n.page + 1}</small>`) : label;
            return `<li>${target}${list(n.children)}</li>`;
          })
          .join('')}</ul>`
      : '';
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;line-height:1.5}small{color:#777;margin-left:.4em}ul{list-style:none;padding-left:1.2em}a{text-decoration:none}</style></head><body><h1>${esc(title)}</h1>${list(nodes)}</body></html>\n`;
}

/** Page order following the bookmarks: pages in order of first mention, then the rest in their order. */
export function pageOrderByBookmarks(nodes: OutlineNode[], pageCount: number): number[] {
  const seen = new Set<number>();
  const order: number[] = [];
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      if (n.page !== undefined && n.page >= 0 && n.page < pageCount && !seen.has(n.page)) {
        // Take the run of pages up to the next bookmarked page.
        seen.add(n.page);
        order.push(n.page);
      }
      walk(n.children);
    }
  };
  walk(nodes);
  // Pages between bookmarks follow the bookmark that precedes them in the original order.
  const starts = [...order];
  const result: number[] = [];
  const sortedStarts = [...starts].sort((a, b) => a - b);
  for (const s of starts) {
    const next = sortedStarts.find((x) => x > s) ?? pageCount;
    for (let p = s; p < next; p++) if (!result.includes(p)) result.push(p);
  }
  for (let p = 0; p < pageCount; p++) if (!result.includes(p)) result.push(p);
  return result;
}

export const bookmarkNode = make;
