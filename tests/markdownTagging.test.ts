import { describe, expect, it } from 'vitest';
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, decodePDFRawStream, type PDFContext, type PDFPage } from '@cantoo/pdf-lib';
import { markdownToPdf, textToPdf } from '../src/lib/markdownPdf';
import { checkAccessibility } from '../src/lib/accessibility';
import { findMatches } from '../src/lib/content/ops';
import { useLang } from '../src/lib/i18n';

// The default /Lang comes from the interface language; pin it for the assertions below.
useLang.setState({ lang: 'en' });

const N = (s: string) => PDFName.of(s);
const name = (o: unknown) => (o instanceof PDFName ? o.toString() : '');
const OPTS = { matchCase: true, wholeWord: false };

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==';
const md = `# Report

Intro with [a link](https://example.com), **bold**, \`code\` and a [jump](#the-end).

## Section

- item
- [x] done

1. first
2. second

| A | B |
|---|---|
| x | \`y\` |

\`\`\`
const code = 1;
\`\`\`

> quoted text

![dot](data:image/png;base64,${PNG})

## The end
`;

/** The values of a dictionary entry: one or an array, raw (references stay references). */
function kidsOf(dict: PDFDict, key: string): unknown[] {
  const k = dict.get(N(key));
  return k === undefined ? [] : k instanceof PDFArray ? k.asArray() : [k];
}

/** A structure element, through a reference. */
function elem(ctx: PDFContext, k: unknown): PDFDict | undefined {
  const d = k instanceof PDFRef ? ctx.lookup(k) : k;
  return d instanceof PDFDict && d.lookup(N('Type'))?.toString() === '/StructElem' ? d : undefined;
}

/** Every structure element under the tree root, depth first, with its reference. */
function walkElems(ctx: PDFContext, root: PDFDict): { ref: PDFRef; d: PDFDict }[] {
  const out: { ref: PDFRef; d: PDFDict }[] = [];
  const visit = (ref: PDFRef, d: PDFDict) => {
    out.push({ ref, d });
    for (const k of kidsOf(d, 'K')) {
      if (k instanceof PDFRef) {
        const e = elem(ctx, k);
        if (e) visit(k, e);
      }
    }
  };
  for (const k of kidsOf(root, 'K')) {
    if (k instanceof PDFRef) {
      const e = elem(ctx, k);
      if (e) visit(k, e);
    }
  }
  return out;
}

/** A page's content streams, decoded and joined. */
async function contentOf(page: PDFPage): Promise<Uint8Array> {
  const c = page.node.Contents();
  const streams = c instanceof PDFArray ? c.asArray().map((r) => page.doc.context.lookup(r)) : [c];
  const parts = streams.map((st) => (st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : new Uint8Array()));
  return new Uint8Array(parts.flatMap((p) => [...p, 10]));
}

/** The raw value of one parent-tree key (an element reference for annotations). */
function parentEntry(root: PDFDict, key: number) {
  const nums = (root.lookup(N('ParentTree')) as PDFDict).lookup(N('Nums')) as PDFArray;
  for (let i = 0; i + 1 < nums.size(); i += 2) if ((nums.lookup(i) as PDFNumber).asNumber() === key) return nums.get(i + 1);
  return undefined;
}

/** The parent tree of a tagged document, as key → array. */
function parentTree(root: PDFDict): Map<number, PDFArray> {
  const tree = root.lookup(N('ParentTree'));
  const nums = tree instanceof PDFDict ? tree.lookup(N('Nums')) : undefined;
  const byKey = new Map<number, PDFArray>();
  if (nums instanceof PDFArray) {
    for (let i = 0; i + 1 < nums.size(); i += 2) {
      const key = nums.lookup(i);
      const value = nums.lookup(i + 1);
      if (key instanceof PDFNumber && value instanceof PDFArray) byKey.set(key.asNumber(), value);
    }
  }
  return byKey;
}

describe('Markdown PDF tagging', () => {
  it('sets /Lang and MarkInfo and builds a structure tree of the block semantics', async () => {
    const doc = await PDFDocument.load(await markdownToPdf(md, { title: 'My report' }));
    const ctx = doc.context;
    expect((doc.catalog.lookup(N('Lang')) as PDFString).decodeText()).toBe('en-GB');
    const markInfo = doc.catalog.lookup(N('MarkInfo'));
    expect(markInfo instanceof PDFDict && markInfo.lookup(N('Marked'))).toBe(PDFBool.True);

    const root = doc.catalog.lookup(N('StructTreeRoot'));
    expect(root).toBeInstanceOf(PDFDict);
    const docElem = elem(ctx, kidsOf(root as PDFDict, 'K')[0]);
    expect(docElem && name(docElem.lookup(N('S')))).toBe('/Document');
    const top = kidsOf(docElem!, 'K').map((k) => name(elem(ctx, k)!.lookup(N('S'))));
    expect(top).toEqual(['/H1', '/P', '/H2', '/L', '/L', '/Table', '/Code', '/BlockQuote', '/Figure', '/H2']);

    // List structure: unordered items have bodies, ordered ones a label with the number.
    const kids = (d: PDFDict) => kidsOf(d, 'K').map((k) => name(elem(ctx, k)!.lookup(N('S'))));
    expect(kids(elem(ctx, kidsOf(docElem!, 'K')[3])!)).toEqual(['/LI', '/LI']);
    const ol = elem(ctx, kidsOf(docElem!, 'K')[4])!;
    expect(kids(ol)).toEqual(['/LI', '/LI']);
    expect(kids(elem(ctx, kidsOf(ol, 'K')[0])!)).toEqual(['/Lbl', '/LBody']);

    // Table: rows with header and body cells that hold the cell's paragraphs.
    const tr = elem(ctx, kidsOf(elem(ctx, kidsOf(docElem!, 'K')[5])!, 'K')[0])!;
    expect(kids(tr)).toEqual(['/TH', '/TH']);
    // Header cells say which cells they head.
    for (const th of kidsOf(tr, 'K')) {
      const a = elem(ctx, th)!.lookup(N('A')) as PDFDict;
      expect([name(a.lookup(N('O'))), name(a.lookup(N('Scope')))]).toEqual(['/Table', '/Column']);
    }
    const bodyRow = elem(ctx, kidsOf(elem(ctx, kidsOf(docElem!, 'K')[5])!, 'K')[1])!;
    expect(kids(bodyRow)).toEqual(['/TD', '/TD']);
    expect(kids(elem(ctx, kidsOf(bodyRow, 'K')[0])!)).toEqual(['/P']);

    // The image carries its alt text.
    const fig = walkElems(ctx, root as PDFDict).find((e) => name(e.d.lookup(N('S'))) === '/Figure');
    expect(fig && (fig.d.lookup(N('Alt')) as PDFHexString).decodeText()).toBe('dot');
  });

  it('maps every marked-content id to its element through the parent tree', async () => {
    const doc = await PDFDocument.load(await markdownToPdf(md));
    const ctx = doc.context;
    const root = doc.catalog.lookup(N('StructTreeRoot')) as PDFDict;
    const byKey = parentTree(root);
    let taggedPages = 0;
    for (const page of doc.getPages()) {
      const sp = page.node.lookup(N('StructParents'));
      if (!(sp instanceof PDFNumber)) continue;
      taggedPages++;
      const owners = byKey.get(sp.asNumber());
      expect(owners, `page key ${sp.asNumber()}`).toBeInstanceOf(PDFArray);
      // The array is indexed by the marked-content id: no id without an element.
      for (let m = 0; m < owners!.size(); m++) expect(elem(ctx, owners!.get(m))).toBeTruthy();
    }
    expect(taggedPages).toBeGreaterThan(0);
    // And every marked content an element holds resolves back to that element. Object
    // references (OBJR) hold no marked content and are skipped.
    for (const { ref, d } of walkElems(ctx, root)) {
      for (const k of kidsOf(d, 'K')) {
        if (k instanceof PDFRef || !(k instanceof PDFNumber) && !(k instanceof PDFDict)) continue;
        if (k instanceof PDFDict && name(k.lookup(N('Type'))) === '/OBJR') continue;
        const mcid = k instanceof PDFNumber ? k.asNumber() : (k as PDFDict).lookup(N('MCID'));
        // .get, not .lookup: the /Pg entry must stay the reference it is written as.
        const pg = k instanceof PDFNumber ? d.get(N('Pg')) : (k as PDFDict).get(N('Pg'));
        expect(pg, name(d.lookup(N('S')))).toBeInstanceOf(PDFRef);
        const page = ctx.lookup(pg as PDFRef) as PDFDict;
        const sp = page.lookup(N('StructParents')) as PDFNumber;
        const owners = byKey.get(sp.asNumber())!;
        expect((owners.get(mcid as number) as PDFRef).toString()).toBe(ref.toString());
      }
    }
  });

  it('marks decoration (rules, backgrounds, borders, bullets) as artifacts, never inside tagged content', async () => {
    const doc = await PDFDocument.load(await markdownToPdf(md));
    for (const page of doc.getPages()) {
      const text = new TextDecoder().decode(await contentOf(page));
      // Outside marked content only the graphics state and marked content operators remain.
      let depth = 0;
      const stray: string[] = [];
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (/\b(BDC|BMC)$/.test(t)) depth++;
        else if (t === 'EMC') depth--;
        else if (depth === 0 && /\s(re|l|f|S|B|Tj|TJ|Do|c)$|^(f|S|B|BT)$/.test(t)) stray.push(t);
      }
      expect(stray).toEqual([]);
      expect(text).toContain('/Artifact BMC');
    }
  });

  it('gives link annotations a Link element with an object reference', async () => {
    const doc = await PDFDocument.load(await markdownToPdf(md));
    const ctx = doc.context;
    const root = doc.catalog.lookup(N('StructTreeRoot')) as PDFDict;
    const byKey = parentTree(root);
    let found = 0;
    for (const page of doc.getPages()) {
      const annots = page.node.lookup(N('Annots'));
      if (!(annots instanceof PDFArray)) continue;
      for (const a of annots.asArray()) {
        const d = ctx.lookup(a) as PDFDict;
        if (name(d.lookup(N('Subtype'))) !== '/Link') continue;
        const sp = d.lookup(N('StructParent'));
        expect(sp).toBeInstanceOf(PDFNumber);
        // An annotation's parent-tree entry is its element itself, not an array (ISO 32000-1, 14.7.4.4).
        expect(byKey.has((sp as PDFNumber).asNumber())).toBe(false);
        const entry = parentEntry(root, (sp as PDFNumber).asNumber());
        expect(entry).toBeInstanceOf(PDFRef);
        const e = elem(ctx, entry);
        expect(e && name(e.lookup(N('S')))).toBe('/Link');
        // An alternate description for screen readers, and tab order by structure.
        expect((d.lookup(N('Contents')) as PDFHexString | undefined)?.decodeText()).toBeTruthy();
        expect(name(page.node.lookup(N('Tabs')))).toBe('/S');
        const objr = kidsOf(e!, 'K').find((k) => k instanceof PDFDict) as PDFDict;
        expect(name(objr.lookup(N('Type')))).toBe('/OBJR');
        // .get: the object entry stays the reference it is written as.
        expect(objr.get(N('Obj'))).toBe(a);
        found++;
      }
    }
    expect(found).toBe(2); // the web link and the internal jump
  });

  it('keeps a line one text object: search still matches across style boundaries', async () => {
    const bytes = await markdownToPdf('Start **bold middle** end again\n\n[a](https://x.example) tail\n');
    // The line is drawn as one text object (one fill): bold and regular runs join, so a
    // match spans the style boundary in both directions.
    for (const q of ['bold middle end', 'Start bold']) {
      const hits = await findMatches(bytes, q, OPTS);
      expect(hits, q).toHaveLength(1);
      expect(hits[0][1]).toHaveLength(1);
    }
  });

  it('embeds every font, code included, and stamps Producer and trailer ID', async () => {
    const bytes = await markdownToPdf('Text with `code`.\n\n```\nblock code\n```\n');
    // updateMetadata: false — a plain load would stamp pdf-lib's own Producer over the app's.
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const ctx = doc.context;
    const fonts = ctx.enumerateIndirectObjects().flatMap(([, o]) => (o instanceof PDFDict && o.get(N('Type'))?.toString() === '/Font' ? [o] : []));
    expect(fonts.length).toBeGreaterThan(0);
    const descriptorOf = (f: PDFDict): PDFDict | undefined => {
      const direct = f.lookup(N('FontDescriptor'));
      if (direct instanceof PDFDict) return direct;
      const descendants = f.lookup(N('DescendantFonts'));
      const d = descendants instanceof PDFArray ? ctx.lookup(descendants.get(0)) : undefined;
      return d instanceof PDFDict ? (d.lookup(N('FontDescriptor')) as PDFDict | undefined) : undefined;
    };
    for (const f of fonts) {
      const desc = descriptorOf(f);
      // Standard fonts (the old Courier) have no font file; everything drawn must be embedded.
      const embedded = !!desc && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => desc.has(N(k)));
      expect(embedded, name(f.get(N('BaseFont')))).toBe(true);
    }
    expect(fonts.some((f) => name(f.get(N('BaseFont'))).includes('Courier'))).toBe(false);
    expect(doc.getProducer()).toBe('PDF-Xploder');
    const id = ctx.trailerInfo.ID;
    const ids = id instanceof PDFArray ? id : (ctx.lookup(id as PDFRef) as PDFArray);
    expect(ids.size()).toBe(2);
    for (const x of ids.asArray()) expect((x as PDFHexString).asBytes()).toHaveLength(16);
  });

  it("passes the app's own accessibility checks for tagging and language", async () => {
    const bytes = await markdownToPdf(md);
    const doc = await PDFDocument.load(bytes);
    const results = await checkAccessibility(bytes, doc.getPages().map(() => 1), [], true);
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get('tagged')?.status).toBe('pass');
    expect(byId.get('lang')?.status).toBe('pass');
  });

  it('tags plain text output, in the language it is given', async () => {
    const bytes = await textToPdf('Line one\n\nLine two\n', { lang: 'de' });
    const doc = await PDFDocument.load(bytes);
    expect((doc.catalog.lookup(N('Lang')) as PDFString).decodeText()).toBe('de-DE');
    expect(doc.catalog.lookup(N('StructTreeRoot'))).toBeInstanceOf(PDFDict);
    expect(doc.catalog.lookup(N('MarkInfo'))).toBeInstanceOf(PDFDict);
    const hits = await findMatches(bytes, 'Line two', OPTS);
    expect(hits).toHaveLength(1);
    expect(hits[0][1]).toHaveLength(1);
  });

  it('tags an empty document without content items', async () => {
    const doc = await PDFDocument.load(await markdownToPdf(''));
    expect(doc.catalog.lookup(N('StructTreeRoot'))).toBeInstanceOf(PDFDict);
    expect(doc.catalog.lookup(N('MarkInfo'))).toBeInstanceOf(PDFDict);
  });
});
