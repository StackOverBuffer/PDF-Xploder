import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from '@cantoo/pdf-lib';
import { parseMarkdown, slug, type Block } from '../src/lib/markdown';
import { markdownToPdf, textToPdf } from '../src/lib/markdownPdf';
import { readOutline } from '../src/lib/outline';
import { findMatches } from '../src/lib/content/ops';

const OPTS = { matchCase: true, wholeWord: false };
const para = (b: Block | undefined) => (b?.type === 'paragraph' ? b.content : null);

describe('Markdown parser', () => {
  it('reads headings, paragraphs, rules and code', () => {
    const doc = parseMarkdown('# Title\n\nSome *text*\ncontinued.\n\nSub\n---\n\n***\n\n```ts\nconst a = 1;\n\n  b();\n```\n\n    indented\n');
    expect(doc.map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading', 'hr', 'code', 'code']);
    expect(doc[0]).toMatchObject({ level: 1, content: [{ type: 'text', text: 'Title' }] });
    expect(para(doc[1])).toEqual([{ type: 'text', text: 'Some ' }, { type: 'em', children: [{ type: 'text', text: 'text' }] }, { type: 'text', text: ' continued.' }]);
    expect(doc[2]).toMatchObject({ level: 2 });
    expect(doc[4]).toEqual({ type: 'code', lang: 'ts', text: 'const a = 1;\n\n  b();' });
    expect(doc[5]).toEqual({ type: 'code', lang: '', text: 'indented' });
  });

  it('parses emphasis, code spans, links and escapes', () => {
    const [p] = parseMarkdown('**bold** _it_ ***both*** ~~gone~~ `a*b*` \\*not\\* snake_case_word [site](https://example.com "T") <https://x.org> www.test.de. 2 * 3 * 4');
    expect(para(p)).toEqual([
      { type: 'strong', children: [{ type: 'text', text: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'it' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'strong', children: [{ type: 'text', text: 'both' }] }] },
      { type: 'text', text: ' ' },
      { type: 'del', children: [{ type: 'text', text: 'gone' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'a*b*' },
      { type: 'text', text: ' *not* snake_case_word ' },
      { type: 'link', href: 'https://example.com', children: [{ type: 'text', text: 'site' }] },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'https://x.org', children: [{ type: 'text', text: 'https://x.org' }] },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'http://www.test.de', children: [{ type: 'text', text: 'www.test.de' }] },
      { type: 'text', text: '. 2 * 3 * 4' },
    ]);
  });

  it('resolves reference links and keeps hard breaks', () => {
    const doc = parseMarkdown('See [the docs][d] and [D].  \nNext line\\\nthird &amp; <br> four\n\n[d]: https://docs.example "Docs"\n');
    expect(doc).toHaveLength(1);
    expect(para(doc[0])).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'link', href: 'https://docs.example', children: [{ type: 'text', text: 'the docs' }] },
      { type: 'text', text: ' and ' },
      { type: 'link', href: 'https://docs.example', children: [{ type: 'text', text: 'D' }] },
      { type: 'text', text: '.' },
      { type: 'br' },
      { type: 'text', text: 'Next line' },
      { type: 'br' },
      { type: 'text', text: 'third & ' },
      { type: 'br' },
      { type: 'text', text: ' four' },
    ]);
  });

  it('nests lists and reads task items', () => {
    const doc = parseMarkdown('- one\n- two\n  - inner\n    continued\n- [x] done\n- [ ] open\n\n3. three\n4. four\n\n   more\n');
    expect(doc.map((b) => b.type)).toEqual(['list', 'list']);
    const ul = doc[0] as Extract<Block, { type: 'list' }>;
    expect(ul.ordered).toBe(false);
    expect(ul.tight).toBe(true);
    expect(ul.items.map((i) => i.checked)).toEqual([null, null, true, false]);
    const inner = ul.items[1].children[1] as Extract<Block, { type: 'list' }>;
    expect(inner.type).toBe('list');
    expect(para(inner.items[0].children[0])).toEqual([{ type: 'text', text: 'inner continued' }]);
    const ol = doc[1] as Extract<Block, { type: 'list' }>;
    expect(ol).toMatchObject({ ordered: true, start: 3, tight: false });
    expect(ol.items[1].children.map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
  });

  it('reads block quotes and tables', () => {
    const doc = parseMarkdown('> quoted\nlazy\n> > nested\n\n| Name | Qty |  Note |\n|:-----|----:|:-----:|\n| a \\| b | 2 | `x|y` |\n| c |\n');
    expect(doc[0].type).toBe('quote');
    const q = doc[0] as Extract<Block, { type: 'quote' }>;
    expect(para(q.children[0])).toEqual([{ type: 'text', text: 'quoted lazy' }]);
    expect(q.children[1].type).toBe('quote');
    const t = doc[1] as Extract<Block, { type: 'table' }>;
    expect(t.align).toEqual(['left', 'right', 'center']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0][0]).toEqual([{ type: 'text', text: 'a | b' }]);
    expect(t.rows[0][2]).toEqual([{ type: 'code', text: 'x|y' }]);
    expect(t.rows[1][1]).toEqual([]);
  });

  it('skips front matter and HTML comments', () => {
    const doc = parseMarkdown('---\ntitle: x\n---\n<!-- hidden\nstill hidden -->\nText\n');
    expect(doc).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }]);
  });

  it('makes GitHub-style heading anchors', () => {
    expect(slug('Hello, World!')).toBe('hello-world');
    expect(slug('Über uns & mehr')).toBe('über-uns--mehr');
  });
});

describe('Markdown to PDF', () => {
  const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} with some words to wrap across the page width, again and again and again.`).join('\n\n');
  const md = `# Report

Intro with [a link](https://example.com), **bold**, *italic*, \`code\` and Ünïcödé — Ελληνικά, Кириллица.

## Section A

- item
- [x] done

| A | B |
|---|---|
| 1 | 2 |

Go to [the end](#the-end).

\`\`\`
code block
\`\`\`

${long}

## The end

> Quote
`;

  it('lays out pages with text, links and bookmarks', async () => {
    const bytes = await markdownToPdf(md, { title: 'My report' });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toBe('My report');
    const outline = await readOutline(bytes);
    expect(outline.map((n) => n.title)).toEqual(['Report']);
    expect(outline[0].children.map((n) => n.title)).toEqual(['Section A', 'The end']);
    expect(outline[0].children[1].page).toBe(doc.getPageCount() - 1);

    // Link annotations: one to the web, one to the heading on the last page.
    const links = doc.getPages().flatMap((p, i) => (p.node.lookup(PDFName.of('Annots')) as PDFArray | undefined)?.asArray().map((r) => ({ page: i, d: doc.context.lookup(r) as PDFDict })) ?? []);
    const uri = links.find((l) => l.d.lookup(PDFName.of('A')));
    expect(((uri!.d.lookup(PDFName.of('A')) as PDFDict).lookup(PDFName.of('URI')) as PDFString).decodeText()).toBe('https://example.com');
    const internal = links.find((l) => l.d.lookup(PDFName.of('Dest')));
    expect((internal!.d.lookup(PDFName.of('Dest')) as PDFArray).get(0)).toEqual(doc.getPage(doc.getPageCount() - 1).ref);

    // The text can be found in the page content (any script).
    const hits = await findMatches(bytes, 'Кириллица', OPTS, [0]);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('converts plain text with its line breaks', async () => {
    const bytes = await textToPdf('Line one\n\tindented\n\n' + 'x'.repeat(300) + '\n');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const hits = await findMatches(bytes, 'indented', OPTS);
    expect(hits.flatMap(([, m]) => m)).toHaveLength(1);
  });

  it('keeps text searchable: no ligatures, emoji replaced by symbols', async () => {
    const bytes = await markdownToPdf('Fill in the files ✅ → done');
    for (const q of ['Fill in the files', '✔', '-> done']) expect((await findMatches(bytes, q, OPTS)).length, q).toBe(1);
  });

  it('embeds data: images and describes the others', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==';
    const doc = await PDFDocument.load(await markdownToPdf(`![dot](data:image/png;base64,${png})\n\n![remote](https://example.com/x.png)`));
    const xobjects = doc.getPage(0).node.Resources()?.lookup(PDFName.of('XObject')) as PDFDict | undefined;
    expect(xobjects?.keys().length).toBe(1);
  });

  it('handles an empty document', async () => {
    const doc = await PDFDocument.load(await markdownToPdf(''));
    expect(doc.getPageCount()).toBe(1);
  });
});
