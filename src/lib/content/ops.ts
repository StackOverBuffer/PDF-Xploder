/**
 * Page-content operations on whole documents, bytes in and bytes out, so they can run
 * in the background worker (pdf-lib parses and saves the entire file).
 */
import type { PDFDocument } from '@cantoo/pdf-lib';
import { describeObjects, editPage, loadForEditing, readPage, writePage, type ContentEdit, type ObjectInfo } from './page';
import { findInContent, replaceOnPage, type FindOptions, type TextMatch } from './findText';
import { saveDoc } from '../pdfSave';

/**
 * The last document parsed for reading, by the caller's key for its bytes: reading the
 * objects of one page after another parses the file once. Edits always load afresh.
 */
let reading: { key: string; doc: Promise<PDFDocument> } | null = null;

function forReading(bytes: Uint8Array, key?: string): Promise<PDFDocument> {
  if (key && reading?.key === key) return reading.doc;
  const doc = loadForEditing(bytes);
  reading = key ? { key, doc } : null;
  doc.catch(() => reading?.doc === doc && (reading = null));
  return doc;
}

/** The objects on a page. */
export async function objectsOnPage(bytes: Uint8Array, page: number, key?: string): Promise<ObjectInfo[]> {
  const doc = await forReading(bytes, key);
  return describeObjects(readPage(doc.getPage(page)));
}

/** Text matches in the page content: [page, matches] for pages with any (all pages, or `pages`). */
export async function findMatches(bytes: Uint8Array, query: string, o: FindOptions, pages?: number[], key?: string): Promise<[number, TextMatch[]][]> {
  const doc = await forReading(bytes, key);
  const out: [number, TextMatch[]][] = [];
  const all = doc.getPages();
  for (const i of pages ?? all.map((_, k) => k)) {
    const m = findInContent(readPage(all[i]), query, o);
    if (m.length) out.push([i, m]);
  }
  return out;
}

/** The document with `pages` rewritten unchanged (to compare renderings), and the unknown operators per page. */
export async function rewriteForCheck(bytes: Uint8Array, pages: number[]): Promise<{ bytes: Uint8Array; unknown: [number, string[]][] }> {
  const doc = await loadForEditing(bytes);
  const unknown: [number, string[]][] = [];
  for (const p of pages) {
    const pc = readPage(doc.getPage(p));
    if (pc.unknown.length) unknown.push([p, pc.unknown]);
    writePage(doc.getPage(p), pc.objects);
  }
  return { bytes: await doc.save(), unknown };
}

/** Apply content edits to one page; returns the new document and the ids of the affected objects. */
export async function editPageContent(bytes: Uint8Array, page: number, edits: ContentEdit[]): Promise<{ bytes: Uint8Array; ids: number[] }> {
  const doc = await loadForEditing(bytes);
  const ids = await editPage(doc.getPage(page), edits);
  return { bytes: await saveDoc(doc), ids };
}

/** Replace text on `pages` (or only the match `at`); returns the new document and the number of replacements. */
export async function replaceInPages(
  bytes: Uint8Array,
  pages: number[],
  query: string,
  replacement: string,
  o: FindOptions,
  at?: { object: number; start: number },
): Promise<{ bytes: Uint8Array; n: number }> {
  const doc = await loadForEditing(bytes);
  let n = 0;
  for (const p of pages) n += await replaceOnPage(doc.getPage(p), query, replacement, o, at);
  return { bytes: n ? await saveDoc(doc) : bytes, n };
}
