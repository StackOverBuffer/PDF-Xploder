import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFString, StandardFonts, decodePDFRawStream, degrees } from '@cantoo/pdf-lib';
import * as ops from '../src/lib/pdfOps';
import * as org from '../src/lib/organize';
import type { Annotation } from '../src/lib/types';

async function makeDoc(n: number, label = 'Page', base = 200): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) {
    const p = doc.addPage([base + i, 300]);
    p.drawText(`${label} ${i + 1}`, { x: 20, y: 250, size: 12, font });
  }
  return doc.save();
}

const widths = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages().map((p) => Math.round(p.getWidth()));

/** Decoded content of every page, joined. */
async function contents(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => {
    const c = p.node.Contents();
    const refs = c instanceof PDFArray ? c.asArray() : [p.node.get(PDFName.of('Contents'))];
    return refs.map((r) => {
      const s = doc.context.lookup(r as PDFRef);
      return s instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : '';
    }).join('\n');
  });
}

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

describe('page lists and layouts', () => {
  it('formats ranges and filters pages', () => {
    expect(org.rangeText([4, 0, 1, 2, 7, 8])).toBe('1-3, 5, 8-9');
    expect(org.filterPages([0, 1, 2, 3], 'even')).toEqual([1, 3]);
    expect(org.filterPages([0, 1, 2, 3], 'odd')).toEqual([0, 2]);
    const sizes = [{ width: 100, height: 200 }, { width: 200, height: 100 }];
    expect(org.filterPages([0, 1], 'all', 'landscape', sizes)).toEqual([1]);
    expect(org.filterPages([0, 1], 'all', 'portrait', sizes)).toEqual([0]);
  });

  it('builds duplicate, swap, replace and reverse layouts', () => {
    expect(org.duplicateLayout(3, [0, 1], 1, 'each')).toEqual([0, 0, 1, 1, 2]);
    expect(org.duplicateLayout(3, [0, 1], 2, 'after')).toEqual([0, 1, 0, 1, 0, 1, 2]);
    expect(org.duplicateLayout(3, [0, 1], 2, 'after', false)).toEqual([0, 1, 0, 0, 1, 1, 2]);
    expect(org.duplicateLayout(2, [1], 1, 'start')).toEqual([1, 0, 1]);
    expect(org.duplicateLayout(2, [0], 1, 'end')).toEqual([0, 1, 0]);
    expect(org.swapLayout(5, [0, 1], [4])).toEqual([4, 2, 3, 0, 1]);
    expect(() => org.swapLayout(5, [0, 1], [1])).toThrow();
    expect(org.replaceLayout(4, [1, 2], [0])).toEqual([0, { file: 0, page: 0 }, 3]);
    expect(org.reverseLayout(5, [1, 2, 3])).toEqual([0, 3, 2, 1, 4]);
    expect(org.reverseLayout(3, [])).toEqual([2, 1, 0]);
  });
});

describe('assembling pages', () => {
  it('reorders, copies, drops and imports pages', async () => {
    const bytes = await makeDoc(3);
    const other = await makeDoc(2, 'Other', 500);
    const out = await org.assemblePages(bytes, [2, 0, 0, { file: 0, page: 1 }], [other]);
    expect(await widths(out)).toEqual([202, 200, 200, 501]);
    await expect(org.assemblePages(bytes, [])).rejects.toThrow();
    await expect(org.assemblePages(bytes, [5])).rejects.toThrow();
  });

  it('inserts blank pages sized like the displayed neighbour', async () => {
    const doc = await PDFDocument.load(await makeDoc(2));
    doc.getPage(0).setRotation(degrees(90));
    const out = await org.insertBlankPages(await doc.save(), 1, 2);
    expect(await widths(out)).toEqual([200, 300, 300, 201]);
    expect(await widths(await org.insertBlankPages(out, 0, 1, [100, 100]))).toEqual([100, 200, 300, 300, 201]);
  });

  it('inserts images as pages', async () => {
    const out = await org.insertImagePages(await makeDoc(1), [{ data: PNG, png: true }, { data: PNG, png: true }], 1, { size: null, margin: 0 });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(1).getSize()).toEqual({ width: 1.5, height: 0.75 });
    // A landscape image on a portrait size gets a landscape page.
    const a4 = await PDFDocument.load(await org.insertImagePages(await makeDoc(1), [{ data: PNG, png: true }], 0, { size: [595, 842], margin: 20 }));
    expect(a4.getPage(0).getSize()).toEqual({ width: 842, height: 595 });
  });

  it('finds blank pages', async () => {
    const bytes = await org.insertBlankPages(await makeDoc(2), 1, 1);
    expect(await org.findBlankPages(bytes)).toEqual([1]);
  });
});

describe('bookmarks and splitting', () => {
  async function withOutline(): Promise<Uint8Array> {
    const doc = await PDFDocument.load(await makeDoc(5));
    const ctx = doc.context;
    const pages = doc.getPages();
    const outlines = ctx.register(ctx.obj({ Type: 'Outlines' }));
    const a = ctx.nextRef();
    const b = ctx.nextRef();
    const named = ctx.obj({}) as PDFDict;
    named.set(PDFName.of('chap2'), ctx.obj([pages[3].ref, PDFName.of('Fit')]));
    doc.catalog.set(PDFName.of('Dests'), named);
    ctx.assign(a, ctx.obj({ Title: PDFString.of('Intro'), Parent: outlines, Next: b, Dest: ctx.obj([pages[1].ref, PDFName.of('Fit')]) }));
    ctx.assign(b, ctx.obj({ Title: PDFString.of('Chapter'), Parent: outlines, Prev: a, A: ctx.obj({ S: 'GoTo', D: PDFName.of('chap2') }) }));
    const o = ctx.lookup(outlines, PDFDict);
    o.set(PDFName.of('First'), a);
    o.set(PDFName.of('Last'), b);
    doc.catalog.set(PDFName.of('Outlines'), outlines);
    return doc.save();
  }

  it('reads top-level bookmarks with direct and named destinations', async () => {
    expect(await org.topLevelBookmarks(await withOutline())).toEqual([{ title: 'Intro', page: 1 }, { title: 'Chapter', page: 3 }]);
  });

  it('splits by bookmarks, ranges and size', async () => {
    const bytes = await withOutline();
    const parts = await org.splitByBookmarks(bytes);
    expect(parts.map((p) => p.title)).toEqual(['Intro', 'Chapter']);
    expect(await Promise.all(parts.map((p) => widths(p.bytes)))).toEqual([[200, 201, 202], [203, 204]]);
    await expect(org.splitByBookmarks(await makeDoc(2))).rejects.toThrow();
    const ranged = await org.splitByRanges(bytes, [[0, 2], [], [4]]);
    expect(await Promise.all(ranged.map(widths))).toEqual([[200, 202], [204]]);
    const one = (await ops.extractPages(bytes, [0])).length;
    const bySize = await org.splitBySize(bytes, Math.round(one * 1.6));
    expect(bySize.every((p) => p.length <= one * 1.6)).toBe(true);
    expect((await Promise.all(bySize.map(widths))).flat()).toEqual([200, 201, 202, 203, 204]);
    expect(await org.splitBySize(bytes, 1)).toHaveLength(5);
  });
});

describe('page geometry', () => {
  it('maps upright display coordinates to user space', () => {
    const m = org.uprightMatrix({ view: [0, 0, 200, 300], rotation: 90 });
    // Displayed bottom-left of a page rotated 90° clockwise is the user-space top-left... rotated: (200, 0).
    expect(m).toEqual([0, 1, -1, 0, 200, 0]);
  });

  it('transforms model annotations', () => {
    const t: org.PageTransform = { m: [2, 0, 0, 2, 10, 0], rot: 90 };
    const a = { id: 'a', type: 'text', rect: { x: 1, y: 2, w: 3, h: 4 }, text: 'x', fontSize: 10, border: false, rot: 90, color: '#000', opacity: 1, author: '', createdAt: 0 } as Annotation;
    expect(org.transformAnnotation(a, t)).toMatchObject({ rect: { x: 12, y: 4, w: 6, h: 8 }, fontSize: 20, rot: 0 });
    const ink = { id: 'i', type: 'ink', paths: [[{ x: 1, y: 1 }]], width: 1, color: '#000', opacity: 1, author: '', createdAt: 0 } as Annotation;
    expect(org.transformAnnotation(ink, t)).toMatchObject({ paths: [[{ x: 12, y: 2 }]], width: 2 });
  });

  it('resizes pages by scaling content or by changing the box', async () => {
    const bytes = await makeDoc(2);
    const scaled = await org.resizePages(bytes, [0], { width: 400, height: 900, mode: 'scale', anchor: 'center', matchOrientation: true });
    const doc = await PDFDocument.load(scaled.bytes);
    expect(doc.getPage(0).getMediaBox()).toEqual({ x: 0, y: 0, width: 400, height: 900 });
    expect(doc.getPage(1).getWidth()).toBe(201);
    expect(scaled.transforms[0]).toEqual({ m: [2, 0, 0, 2, 0, 150], rot: 0 });
    expect(scaled.transforms[1]).toBeNull();
    expect((await contents(scaled.bytes))[0]).toMatch(/^q\n2 0 0 2 0 150 cm/);
    // Landscape target on a portrait page is turned when matching orientation.
    const turned = await org.resizePages(bytes, [0], { width: 600, height: 400, mode: 'box', anchor: 'top-left', matchOrientation: true });
    expect((await PDFDocument.load(turned.bytes)).getPage(0).getCropBox()).toEqual({ x: 0, y: -300, width: 400, height: 600 });
    expect(turned.transforms.every((t) => t === null)).toBe(true);
  });

  it('adds margins without moving content', async () => {
    const out = await org.addMargins(await makeDoc(1), [0], { top: 10, right: 20, bottom: 30, left: 40 });
    const p = (await PDFDocument.load(out)).getPage(0);
    expect(p.getCropBox()).toEqual({ x: -40, y: -30, width: 260, height: 340 });
    expect(p.getMediaBox()).toEqual(p.getCropBox());
  });

  it('normalises boxes, rotation and size', async () => {
    const src = await PDFDocument.load(await makeDoc(2));
    src.getPage(0).setRotation(degrees(90));
    src.getPage(0).setCropBox(10, 20, 100, 200);
    src.getPage(1).setTrimBox(0, 0, 50, 50);
    const res = await org.normalizePages(await src.save(), [0, 1], { boxes: true, rotation: true, size: 'none', matchOrientation: false });
    const doc = await PDFDocument.load(res.bytes);
    const p0 = doc.getPage(0);
    expect(p0.getRotation().angle).toBe(0);
    expect(p0.getMediaBox()).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(res.transforms[0]!.rot).toBe(90);
    expect(doc.getPage(1).node.get(PDFName.of('TrimBox'))).toBeUndefined();
    const sized = await org.normalizePages(await makeDoc(3), [0, 1, 2], { boxes: false, rotation: false, size: 'largest', matchOrientation: true });
    expect(await widths(sized.bytes)).toEqual([202, 202, 202]);
    expect(sized.transforms[2]).toBeNull();
  });

  it('finds the bounds of non-white pixels', () => {
    const w = 4;
    const h = 3;
    const px = new Uint8Array(w * h * 4).fill(255);
    expect(org.contentBounds(px, w, h)).toBeNull();
    px.set([0, 0, 0, 255], (1 * w + 2) * 4);
    expect(org.contentBounds(px, w, h)).toEqual({ left: 2, top: 1, right: 3, bottom: 2 });
  });
});

describe('overlay', () => {
  it('draws other pages over or under the content', async () => {
    const bytes = await makeDoc(3);
    const other = await makeDoc(2, 'Overlay');
    const over = await org.overlayPages(bytes, other, { pages: [0, 1, 2], placement: 'over', mode: 'match', fit: true, opacity: 0.5 });
    const c = await contents(over);
    expect(c[0]).toMatch(/\/Ovl\S* Do\nQ\n?$/);
    expect(c[2]).not.toContain(' Do');
    const doc = await PDFDocument.load(over);
    const xobj = doc.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    expect(xobj.keys().some((k) => k.toString().startsWith('/Ovl'))).toBe(true);
    const under = await contents(await org.overlayPages(bytes, other, { pages: [0, 1, 2], placement: 'under', mode: 'cycle', fit: false, opacity: 1 }));
    expect(under[2]).toMatch(/^q\n.*cm\n\/Ovl/);
  });
});

describe('page marks', () => {
  const wm: ops.WatermarkOptions = { text: 'DRAFT', fontSize: 40, color: '#ff0000', opacity: 0.3, angle: 45, pages: 'all' };

  it('tags watermarks, headers, footers, Bates numbers and backgrounds and removes them by kind', async () => {
    let bytes = await makeDoc(3);
    bytes = await org.addWatermarkMark(bytes, wm);
    bytes = await org.addHeadersFooters(bytes, { texts: { 'top-left': 'Head', 'bottom-center': 'Page {page}' }, fontSize: 10, color: '#000000', margin: 20, startNumber: 1, pages: 'all' });
    bytes = await org.addBates(bytes, { prefix: 'AB', suffix: '-X', start: 7, digits: 4, position: 'bottom-right', fontSize: 8, color: '#000000', margin: 10, pages: [0, 2] });
    bytes = await org.addBackground(bytes, { pages: [1], color: '#eeeeee', image: { data: PNG, png: true }, scale: 0.5, opacity: 0.8 });
    let c = await contents(bytes);
    for (const kind of ['Watermark', 'Header', 'Footer']) expect(c.every((t) => t.includes(`/Subtype /${kind}`))).toBe(true);
    expect(c.map((t) => t.includes('/Subtype /BatesN'))).toEqual([true, false, true]);
    expect(c[1]).toMatch(/^\/Artifact <<\/Type \/Pagination \/Subtype \/Background>> BDC/);

    let res = await org.removePageMarks(bytes, ['Watermark']);
    expect(res.removed).toBe(3);
    c = await contents(res.bytes);
    expect(c.some((t) => t.includes('/Subtype /Watermark'))).toBe(false);
    expect(c.every((t) => t.includes('/Subtype /Header'))).toBe(true);
    res = await org.removePageMarks(res.bytes, ['Header', 'Footer', 'BatesN', 'Background']);
    expect(res.removed).toBe(3 + 3 + 2 + 1);
    c = await contents(res.bytes);
    expect(c.some((t) => t.includes('/Artifact'))).toBe(false);
    // The original page content survives.
    expect(c[0]).toContain('Tj');
    expect((await org.removePageMarks(res.bytes, ['Watermark'])).removed).toBe(0);
  });

  it('numbers Bates labels consecutively over the chosen pages', async () => {
    expect(org.batesLabel({ prefix: 'AB', suffix: '-X', digits: 4 }, 7)).toBe('AB0007-X');
    const out = await org.addBates(await makeDoc(4), { prefix: 'N', suffix: '', start: 1, digits: 3, position: 'bottom-right', fontSize: 8, color: '#000000', margin: 10, pages: [1, 3] });
    const c = await contents(out);
    expect(c.map((t) => t.includes('BatesN'))).toEqual([false, true, false, true]);
    expect(c[1]).not.toEqual(c[3]);
  });

  it('can put a watermark behind the content', async () => {
    const c = await contents(await org.addWatermarkMark(await makeDoc(1), { ...wm, under: true }));
    expect(c[0]).toMatch(/^\/Artifact <<\/Type \/Pagination \/Subtype \/Watermark>> BDC/);
  });

  it('removes marks that refer to a /Properties resource', async () => {
    const doc = await PDFDocument.load(await makeDoc(1));
    const page = doc.getPage(0);
    const props = doc.context.obj({ Type: 'Pagination', Subtype: 'Watermark' });
    const res = page.node.Resources()!;
    res.set(PDFName.of('Properties'), doc.context.obj({ MC0: props }));
    const s = doc.context.register(doc.context.flateStream('/Artifact /MC0 BDC 0 0 m 10 10 l S EMC'));
    const c = page.node.Contents();
    if (c instanceof PDFArray) c.push(s);
    else page.node.set(PDFName.of('Contents'), doc.context.obj([page.node.get(PDFName.of('Contents'))!, s]));
    const out = await org.removePageMarks(await doc.save(), ['Watermark']);
    expect(out.removed).toBe(1);
    expect((await contents(out.bytes))[0]).not.toContain('10 10 l');
  });
});

describe('page labels', () => {
  it('formats labels', () => {
    expect(org.formatPageLabel({ style: 'r', prefix: '', first: 4 }, 0)).toBe('iv');
    expect(org.formatPageLabel({ style: 'R', prefix: 'P-', first: 1 }, 8)).toBe('P-IX');
    expect(org.formatPageLabel({ style: 'A', prefix: '', first: 27 }, 1)).toBe('BB');
    expect(org.formatPageLabel({ style: 'a', prefix: '', first: 1 }, 0)).toBe('a');
    expect(org.formatPageLabel({ style: '', prefix: 'Cover', first: 1 }, 0)).toBe('Cover');
    expect(org.pageLabels(5, [{ start: 2, style: 'D', prefix: '', first: 1 }, { start: 0, style: 'r', prefix: '', first: 1 }])).toEqual(['i', 'ii', '1', '2', '3']);
  });

  it('writes, reads and removes /PageLabels', async () => {
    const ranges: org.PageLabelRange[] = [{ start: 2, style: 'D', prefix: 'S-', first: 5 }];
    const out = await org.setPageLabels(await makeDoc(4), ranges);
    expect(await org.getPageLabels(out)).toEqual([{ start: 0, style: 'D', prefix: '', first: 1 }, { start: 2, style: 'D', prefix: 'S-', first: 5 }]);
    const cleared = await org.setPageLabels(out, []);
    expect(await org.getPageLabels(cleared)).toEqual([]);
  });
});

describe('duplicates', () => {
  it('finds identical pages by content', async () => {
    const bytes = await ops.duplicatePages(await makeDoc(3), [0, 2]);
    // Pages: 1, 1', 2, 3, 3'
    expect(await org.findDuplicatePages(bytes)).toEqual([[0, 1], [3, 4]]);
    expect(org.groupEqual(['a', 'b', 'a', 'c', 'b'])).toEqual([[0, 2], [1, 4]]);
  });

  it('groups visually similar thumbnails', () => {
    const w = 8;
    const img = (dark: number) => {
      const px = new Uint8Array(w * w * 4).fill(255);
      for (let k = 0; k < dark; k++) px.set([0, 0, 0, 255], k * 4);
      return org.grayThumb(px, w, w, 4);
    };
    const a = img(8);
    expect(a).toHaveLength(16);
    expect(a[0]).toBeCloseTo(127.5);
    expect(org.groupSimilar([a, img(0), img(8), img(9)], 5)).toEqual([[0, 2, 3]]);
    expect(org.groupSimilar([a, img(9)], 2)).toEqual([]);
  });
});

describe('German translations', () => {
  it('cover every string of the Organize tab, its dialogs and messages', async () => {
    const { readFile } = await import('node:fs/promises');
    const { translate } = await import('../src/lib/i18n');
    const patterns = [
      /\bt\('((?:[^'\\]|\\.)*)'\)/g, /\btrf?\('((?:[^'\\]|\\.)*)'/g, /label="([^"]+)"/g, /label: '((?:[^'\\]|\\.)*)'/g, /title="([^"]+)"/g,
      /<Hint>([^<]+)<\/Hint>/g, /\[\s*'[^']*',\s*'((?:[^'\\]|\\.)*)'\]/g, /\brun\('([^']+)'/g, /arrange\('([^']+)'/g, /'(?:Header|Footer) (?:left|centre|right)'/g,
      /, '((?:Add|Remove) [^']+)'\)/g,
    ];
    const same = new Set(['OK', 'A4', 'Letter', 'mm', 'in', 'pt', 'Text', 'Position', 'Zoom', 'Suffix', '1, 2, 3', 'i, ii, iii', 'I, II, III', 'a, b, c', 'A, B, C', '180°', 'Hand', 'Footer' /* mark kind, not a label */]);
    const missing: string[] = [];
    for (const f of ['src/components/OrganizeTab.tsx', 'src/components/OrganizeDialogs.tsx', 'src/store/organizeCommands.ts']) {
      const src = await readFile(f, 'utf8');
      for (const re of patterns) {
        for (const m of src.matchAll(re)) {
          const key = (m[1] ?? m[0].slice(1, -1)).replace(/\\'/g, "'");
          if (!same.has(key) && translate('de', key) === key) missing.push(key);
        }
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
