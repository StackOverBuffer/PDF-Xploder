import { describe, expect, it } from 'vitest';
import {
  addTitleText, bookmarkEveryNth, bookmarksFromHeadings, bookmarksFromText, bookmarksFromToc, bookmarksToHtml, bookmarksToText, changeCase,
  mergeDuplicates, pageOrderByBookmarks, removeActions, replaceTitles, validateBookmarks, bookmarkNode as node,
} from '../src/lib/bookmarkTools';
import type { OutlineNode } from '../src/lib/outline';

const shape = (ns: OutlineNode[]): unknown[] => ns.map((n) => (n.children.length ? [n.title, shape(n.children)] : n.title));

describe('generating bookmarks', () => {
  it('every Nth page', () => {
    const t = bookmarkEveryNth(10, 3, 'Seite {page} ({n})');
    expect(t.map((n) => [n.title, n.page])).toEqual([['Seite 1 (1)', 0], ['Seite 4 (2)', 3], ['Seite 7 (3)', 6], ['Seite 10 (4)', 9]]);
  });

  it('from headings by font size, nesting smaller headings and joining wrapped titles', () => {
    const body = (page: number, y: number) => ({ page, y, size: 10, text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod.' });
    const t = bookmarksFromHeadings([
      { page: 0, y: 800, size: 20, text: '1 Einleitung' }, body(0, 760), body(0, 740),
      { page: 0, y: 700, size: 14, text: '1.1 Motivation' }, body(0, 680),
      { page: 1, y: 800, size: 20, text: '2 Ein sehr langer' }, { page: 1, y: 776, size: 20, text: 'Kapiteltitel' }, body(1, 740),
      { page: 1, y: 700, size: 10, text: 'Seite 2' },
    ]);
    expect(shape(t)).toEqual([['1 Einleitung', ['1.1 Motivation']], '2 Ein sehr langer Kapiteltitel']);
    expect(t[1].page).toBe(1);
  });

  it('ignores running headers and slightly larger paragraph text', () => {
    const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod tempor.';
    const lines = [0, 1, 2].flatMap((p) => [
      { page: p, y: 820, size: 18, text: 'Firmenname' },
      { page: p, y: 780, size: 16, text: `${p + 1}. Kapitel ${p + 1}` },
      { page: p, y: 750, size: 12, text: 'This intro paragraph is set a little larger than the body text and runs on,' },
      { page: p, y: 735, size: 12, text: 'over a few lines like a normal paragraph would do in a document.' },
      ...[700, 688, 676, 664, 652, 640].map((y) => ({ page: p, y, size: 10, text: lorem })),
    ]);
    expect(shape(bookmarksFromHeadings(lines))).toEqual(['1. Kapitel 1', '2. Kapitel 2', '3. Kapitel 3']);
  });

  it('from a table of contents with numbering levels and a page offset', () => {
    const t = bookmarksFromToc([
      { text: 'Inhaltsverzeichnis' }, { text: '1 Einleitung ........ 3' }, { text: '1.1 Ziele .......... 4' }, { text: '2 Methoden . . . . 7' }, { text: 'Anhang 99' },
    ], 12, 2);
    expect(shape(t)).toEqual([['1 Einleitung', ['1.1 Ziele']], '2 Methoden']);
    expect(t.map((n) => n.page)).toEqual([4, 8]);
  });

  it('from a text file with tabs and page numbers', () => {
    const t = bookmarksFromText('Teil A\t1\n\tKapitel 1\t2\n\tKapitel 2 | 5\nTeil B\n\tKapitel 3\t9\n', 10);
    expect(shape(t)).toEqual([['Teil A', ['Kapitel 1', 'Kapitel 2']], ['Teil B', ['Kapitel 3']]]);
    // A line without a number takes the next numbered page.
    expect(t[1].page).toBe(8);
  });
});

describe('editing titles', () => {
  it('changes case', () => {
    expect(changeCase('the LORD of the rings', 'title')).toBe('The Lord of the Rings');
    expect(changeCase('ÜBER DIE SACHE', 'sentence')).toBe('Über die sache');
    expect(changeCase('Abc', 'upper')).toBe('ABC');
  });

  it('finds and replaces with or without regex, and adds text', () => {
    const t = [node('Chapter 1', 0, undefined, [node('chapter 1.1', 1)])];
    expect(shape(replaceTitles(t, 'chapter', 'Kapitel').tree)).toEqual([['Kapitel 1', ['Kapitel 1.1']]]);
    const r = replaceTitles(t, '^Chapter (\\d+)$', 'Teil $1', { regex: true, matchCase: true });
    expect(r.changed).toBe(1);
    expect(shape(r.tree)).toEqual([['Teil 1', ['chapter 1.1']]]);
    expect(shape(addTitleText(t, '{n}. ', ' (S. {page})'))).toEqual([['1. Chapter 1 (S. 1)', ['2. chapter 1.1 (S. 2)']]]);
  });
});

describe('cleaning up and exporting', () => {
  it('merges duplicate siblings, removes actions and validates', () => {
    const a = node('A', 0, 100, [node('x', 0)]);
    const b = node('A', 0, 100, [node('y', 1)]);
    const act = { ...node('Website'), action: 'URI: https://example.org' };
    const { tree, merged } = mergeDuplicates([a, b, act, node('', 99)]);
    expect(merged).toBe(1);
    expect(shape(tree).slice(0, 1)).toEqual([['A', ['x', 'y']]]);
    expect(validateBookmarks(tree, 5).map((p) => p.problem)).toEqual(['action', 'empty-title', 'bad-page']);
    const cleaned = removeActions(tree);
    expect(cleaned.removed).toBe(1);
    expect(cleaned.tree[1]).toMatchObject({ clearAction: true, action: undefined });
  });

  it('exports text and HTML', () => {
    const t = [{ ...node('Kapitel <1>', 0, undefined, [node('Teil', 2)]), bold: true }];
    expect(bookmarksToText(t)).toBe('Kapitel <1>\t1\n\tTeil\t3\n');
    const html = bookmarksToHtml(t, 'Test', 'my file.pdf');
    expect(html).toContain('Kapitel &lt;1&gt;');
    expect(html).toContain('href="my%20file.pdf#page=3"');
    expect(html).toContain('font-weight:bold');
  });

  it('orders pages by bookmarks, keeping pages between bookmarks together', () => {
    const t = [node('C', 4), node('A', 0), node('B', 2)];
    expect(pageOrderByBookmarks(t, 6)).toEqual([4, 5, 0, 1, 2, 3]);
  });
});

describe('table of contents pages', () => {
  it('inserts contents pages with links to the original pages', async () => {
    const { PDFDocument, PDFName } = await import('@cantoo/pdf-lib');
    const { insertTocPages } = await import('../src/lib/tocPages');
    const d = await PDFDocument.create();
    for (let i = 0; i < 3; i++) d.addPage([595, 842]);
    const tree = [node('Einführung', 0, undefined, [node('Grundlagen ✓', 1)]), node('Ergebnisse', 2)];
    const { bytes, count } = await insertTocPages(await d.save(), tree, { title: 'Inhalt', levels: 2, fontSize: 11, links: true });
    expect(count).toBe(1);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(4);
    const annots = out.getPage(0).node.lookup(PDFName.of('Annots')) as import('@cantoo/pdf-lib').PDFArray;
    expect(annots.size()).toBe(3);
    // The first link goes to the old first page, now page 2.
    const dest = (out.context.lookup(annots.get(0)) as import('@cantoo/pdf-lib').PDFDict).lookup(PDFName.of('Dest')) as import('@cantoo/pdf-lib').PDFArray;
    expect(dest.get(0).toString()).toBe(out.getPage(1).ref.toString());
  });
});
