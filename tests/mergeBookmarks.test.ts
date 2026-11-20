import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { newNodeId, readOutline, writeOutline, type OutlineNode } from '../src/lib/outline';
import { insertDocument } from '../src/lib/pdfOps';

async function doc(pages: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([400, 600]);
  return d.save();
}

const node = (title: string, page: number | undefined, children: OutlineNode[] = []): OutlineNode => ({ id: newNodeId(), title, page, y: 500, open: true, bold: false, italic: false, children });
const outline = (ns: OutlineNode[]): unknown[] => ns.map((n) => (n.children.length ? [`${n.title}@${n.page}`, outline(n.children)] : `${n.title}@${n.page}`));

describe('merging files with a bookmark for each', () => {
  it('nests the inserted file’s own bookmarks under one named after it', async () => {
    const other = await writeOutline(await doc(3), [node('Intro', 0), node('Part', 1, [node('Detail', 2)])]);
    const { bytes, count } = await insertDocument(await doc(2), other, 2, { title: 'appendix', currentTitle: 'report' });
    expect(count).toBe(3);
    expect(outline(await readOutline(bytes))).toEqual(['report@0', ['appendix@2', ['Intro@2', ['Part@3', ['Detail@4']]]]]);
  });

  it('orders the new bookmark between existing ones by page, and leaves out items without a page', async () => {
    const base = await writeOutline(await doc(4), [node('A', 0), node('B', 2)]);
    const web = { ...node('Website', undefined, [node('Kept', 0)]), action: 'URI: https://example.com' };
    const other = await writeOutline(await doc(1), [web]);
    const { bytes } = await insertDocument(base, other, 1, { title: 'inserted', currentTitle: 'base' });
    // A stays on page 0; B moved from page 2 to 3; no "base" item because the document had bookmarks.
    expect(outline(await readOutline(bytes))).toEqual(['A@0', ['inserted@1', ['Kept@1']], 'B@3']);
  });

  it('names the document’s own pages when inserting at the start', async () => {
    const { bytes } = await insertDocument(await doc(2), await doc(1), 0, { title: 'cover', currentTitle: 'body' });
    expect(outline(await readOutline(bytes))).toEqual(['cover@0', 'body@1']);
  });

  it('adds no bookmarks unless asked', async () => {
    const { bytes } = await insertDocument(await doc(2), await doc(1), 2);
    expect(await readOutline(bytes)).toEqual([]);
  });
});
