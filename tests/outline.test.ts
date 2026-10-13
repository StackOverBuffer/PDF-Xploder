import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { indentNode, insertNode, moveNode, newNodeId, outdentNode, readOutline, removeNode, shiftNode, updateNode, writeOutline, type OutlineNode } from '../src/lib/outline';
import { addBookmark } from '../src/lib/navigation';

async function doc(pages = 3): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([400, 600]);
  return d.save();
}

const node = (title: string, page: number, children: OutlineNode[] = []): OutlineNode => ({ id: newNodeId(), title, page, y: 500, open: true, bold: false, italic: false, children });
const titles = (ns: OutlineNode[]): unknown[] => ns.map((n) => (n.children.length ? [n.title, titles(n.children)] : n.title));

describe('outline', () => {
  it('writes and reads a nested tree with styles and destinations', async () => {
    const tree = [node('Kapitel 1', 0, [node('1.1', 1), node('1.2 Ünïcode ✓', 1)]), { ...node('Kapitel 2', 2), bold: true, italic: true, color: '#cc0000' }];
    const bytes = await writeOutline(await doc(), tree);
    const back = await readOutline(bytes);
    expect(titles(back)).toEqual([['Kapitel 1', ['1.1', '1.2 Ünïcode ✓']], 'Kapitel 2']);
    expect(back[0]).toMatchObject({ page: 0, y: 500, open: true });
    expect(back[0].children[1].page).toBe(1);
    expect(back[1]).toMatchObject({ page: 2, bold: true, italic: true, color: '#cc0000' });
    // pdf.js-compatible structure: counts and links.
    const d = await PDFDocument.load(bytes);
    const root = d.catalog.lookup(PDFName.of('Outlines')) as import('@cantoo/pdf-lib').PDFDict;
    expect(root.lookup(PDFName.of('Count'))!.toString()).toBe('4');
  });

  it('keeps existing items (and their actions) when editing, and drops removed ones', async () => {
    let bytes = await addBookmark(await doc(), 'A', 0, 100);
    bytes = await addBookmark(bytes, 'B', 1, 200);
    bytes = await addBookmark(bytes, 'C', 2);
    let tree = await readOutline(bytes);
    const [a, b, c] = tree;
    tree = updateNode(tree, a.id, { title: 'A renamed' });
    tree = removeNode(tree, c.id).tree;
    tree = moveNode(tree, b.id, a.id, 'inside');
    bytes = await writeOutline(bytes, tree);
    const back = await readOutline(bytes);
    expect(titles(back)).toEqual([['A renamed', ['B']]]);
    expect(back[0].id).toBe(a.id);
    expect(back[0].children[0]).toMatchObject({ id: b.id, page: 1, y: 200 });
    const [n, g] = c.id.split(' ').map(Number);
    const { PDFRef } = await import('@cantoo/pdf-lib');
    // The removed item's dictionary is gone from the file.
    expect((await PDFDocument.load(bytes)).context.lookup(PDFRef.of(n, g))).toBeUndefined();
  });

  it('changes a destination and removes the outline when empty', async () => {
    let bytes = await addBookmark(await doc(), 'A', 0, 100);
    let tree = await readOutline(bytes);
    tree = updateNode(tree, tree[0].id, { page: 2, y: 50, destChanged: true });
    bytes = await writeOutline(bytes, tree);
    expect((await readOutline(bytes))[0]).toMatchObject({ page: 2, y: 50 });
    bytes = await writeOutline(bytes, []);
    expect(await readOutline(bytes)).toEqual([]);
    expect((await PDFDocument.load(bytes)).catalog.has(PDFName.of('Outlines'))).toBe(false);
  });

  it('moves nodes with indent, outdent, shift and never into their own subtree', () => {
    let t = [node('a', 0), node('b', 0, [node('b1', 0)]), node('c', 0)];
    const id = (title: string, ns = t): string => {
      for (const n of ns) {
        if (n.title === title) return n.id;
        const r = n.children.length ? id(title, n.children) : '';
        if (r) return r;
      }
      return '';
    };
    t = indentNode(t, id('c'));
    expect(titles(t)).toEqual(['a', ['b', ['b1', 'c']]]);
    t = outdentNode(t, id('b1'));
    expect(titles(t)).toEqual(['a', ['b', ['c']], 'b1']);
    t = shiftNode(t, id('b1'), -1);
    expect(titles(t)).toEqual(['a', 'b1', ['b', ['c']]]);
    expect(moveNode(t, id('b'), id('c'), 'inside')).toBe(t);
    t = insertNode(t, node('new', 1), id('a'), 'before');
    expect(titles(t)[0]).toBe('new');
  });
});
