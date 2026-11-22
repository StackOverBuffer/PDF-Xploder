/**
 * Markdown and plain text to PDF: lays out the parsed document on pages with
 * the bundled Noto fonts (any script), clickable links, bookmarks for the
 * headings and links to them (#anchor) that work. The output is tagged
 * (structure tree, /Lang) so screen readers can follow the document's semantics.
 */
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber, PDFOperator, PDFOperatorNames, beginText, degrees, endMarkedContent, endText, rgb, rotateAndSkewTextRadiansAndTranslate, setFillingColor, setFontAndSize, showText, toRadians, type PDFDict, type PDFFont, type PDFImage, type PDFPage, type PDFRef, type RGB } from '@cantoo/pdf-lib';
import { createTextEngine } from './fonts';
import { useLang, type Lang } from './i18n';
import type { TextEngine } from './appearance';
import { inlineText, parseMarkdown, slug, type Align, type Block, type Inline } from './markdown';
import { setOutline, type OutlineNode } from './outline';
import { stampNewDocument } from './pdfOps';
import { saveDoc } from './pdfSave';
import { asciiString } from './pdfStrings';

export interface TextPdfOptions {
  /** Page size in points (default A4 portrait). */
  pageSize?: [number, number];
  /** Document title (default: the first heading). */
  title?: string;
  /** Margin in points (default 2 cm). */
  margin?: number;
  /** Body text size in points (default 11). */
  fontSize?: number;
  /** Document language (default: the interface language, like sample.ts). */
  lang?: Lang;
}

const A4: [number, number] = [595.28, 841.89];
const TEXT = rgb(0.13, 0.13, 0.13);
const MUTED = rgb(0.4, 0.4, 0.4);
const LINK = rgb(0.04, 0.35, 0.75);
const RULE = rgb(0.82, 0.82, 0.82);
const CODE_BG = rgb(0.95, 0.95, 0.96);
const OBLIQUE = degrees(12);

// ---------------------------------------------------------------- emoji

/**
 * Colour emoji are not in the bundled fonts: common ones become a similar symbol that
 * is (✅ → ✔), arrows become ASCII. Emoji presentation selectors are dropped.
 */
const SUBSTITUTES: Record<string, string> = {
  '✅': '✔', '☑️': '☑', '✔️': '✔', '❌': '✘', '❎': '✘', '✖️': '✖', '🔴': '●', '🔵': '●', '⚪': '○', '⚫': '●', '🟥': '■', '🟩': '■', '🟨': '■', '🟦': '■',
  '🚫': '⛔', '💡': '★', '📌': '•', '👉': '->', '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '⇐': '<=', '⇔': '<=>', '↑': '^', '↓': 'v', '➡️': '->', '➡': '->', '⬅️': '<-', '⬅': '<-',
};
const SUB_RE = new RegExp(Object.keys(SUBSTITUTES).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gu');

export function substituteSymbols(text: string): string {
  return text.replace(SUB_RE, (m) => SUBSTITUTES[m]).replace(/[\ufe0e\ufe0f]/g, '');
}

// ---------------------------------------------------------------- styled text

interface Style {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  href?: string;
  muted?: boolean;
  /** Monospaced without the code background (plain text files). */
  mono?: boolean;
}

type Frag = { text: string; style: Style } | { br: true };

/** Inline content as styled fragments. Style objects are shared, so equal styles can be merged by identity. */
function flatten(nodes: Inline[], style: Style, out: Frag[] = []): Frag[] {
  for (const n of nodes) {
    switch (n.type) {
      case 'text': out.push({ text: n.text, style }); break;
      case 'code': out.push({ text: n.text, style: { ...style, code: true } }); break;
      case 'br': out.push({ br: true }); break;
      case 'strong': flatten(n.children, { ...style, bold: true }, out); break;
      case 'em': flatten(n.children, { ...style, italic: true }, out); break;
      case 'del': flatten(n.children, { ...style, strike: true }, out); break;
      case 'link': flatten(n.children, { ...style, href: n.href }, out); break;
      case 'image': out.push({ text: n.alt ? `[${n.alt}]` : '[image]', style: { ...style, italic: true, muted: true } }); break;
    }
  }
  return out;
}

interface Piece {
  text: string;
  style: Style;
  w: number;
}
interface Line {
  pieces: Piece[];
  width: number;
}

interface Fonts {
  regular: TextEngine;
  bold: TextEngine;
  mono: TextEngine;
}

const engineOf = (f: Fonts, s: Style) => (s.code || s.mono ? f.mono : s.bold ? f.bold : f.regular);
const sizeOf = (s: Style, size: number) => (s.code ? size * 0.9 : size);

/** Greedy word wrap over styled fragments. Words may span fragments; overlong words are broken anywhere. */
function wrap(fonts: Fonts, frags: Frag[], size: number, maxWidth: number): Line[] {
  const lines: Line[] = [];
  let line: Piece[] = [];
  let width = 0;
  let word: Piece[] = [];
  let space: Piece | null = null;
  const measure = (text: string, style: Style) => engineOf(fonts, style).width(text, sizeOf(style, size));
  const endLine = () => {
    // Merge neighbouring pieces of the same style.
    const merged: Piece[] = [];
    for (const p of line) {
      const last = merged[merged.length - 1];
      if (last && last.style === p.style) {
        last.text += p.text;
        last.w += p.w;
      } else merged.push({ ...p });
    }
    lines.push({ pieces: merged, width });
    line = [];
    width = 0;
    space = null;
  };
  const putWord = () => {
    if (!word.length) return;
    const ww = word.reduce((n, p) => n + p.w, 0);
    const sw = line.length && space ? space.w : 0;
    if (line.length && width + sw + ww > maxWidth) endLine();
    else if (line.length && space) {
      line.push(space);
      width += space.w;
    }
    if (!line.length && ww > maxWidth) {
      // Too long for a line by itself: break between characters.
      for (const p of word) {
        let cur = '';
        for (const ch of p.text) {
          const w = measure(cur + ch, p.style);
          if (cur && width + w > maxWidth) {
            line.push({ text: cur, style: p.style, w: measure(cur, p.style) });
            width += line[line.length - 1].w;
            endLine();
            cur = ch;
          } else cur += ch;
        }
        if (cur) {
          line.push({ text: cur, style: p.style, w: measure(cur, p.style) });
          width += line[line.length - 1].w;
        }
      }
    } else {
      line.push(...word);
      width += ww;
    }
    word = [];
    space = null;
  };
  for (const f of frags) {
    if ('br' in f) {
      putWord();
      endLine();
      continue;
    }
    for (const tok of f.text.split(/(\s+)/)) {
      if (!tok) continue;
      if (/^\s+$/.test(tok)) {
        putWord();
        // Code keeps its spaces; elsewhere a run of white space is one space.
        const t = f.style.code || f.style.mono ? tok.replace(/\s/g, ' ') : ' ';
        if (!space) space = { text: t, style: f.style, w: measure(t, f.style) };
      } else word.push({ text: tok, style: f.style, w: measure(tok, f.style) });
    }
  }
  putWord();
  if (line.length || !lines.length) endLine();
  return lines;
}

// ---------------------------------------------------------------- tagged structure

interface SElem {
  /** The structure type (/S): Document, P, H1…, Code, L, LI, Lbl, LBody, Link, … */
  s: string;
  parent: SElem | null;
  /** Marked content, child elements and (for links) annotation references, in order. */
  kids: ({ page: PDFRef; mcid: number } | { objr: PDFRef; page: PDFRef } | SElem)[];
  /** Alternative text (figures). */
  alt?: string;
  /** Keep the element even when it holds nothing (table cells keep the grid aligned). */
  keepEmpty?: boolean;
  /** The annotation a Link element stands for (set when the annotation is created). */
  annot?: { ref: PDFRef; dict: PDFDict; page: PDFRef };
}

/**
 * Builds the structure tree while the pages are laid out: every line of text is drawn as
 * one marked-content sequence whose id belongs to the innermost open element, and
 * setStructTree writes the tree out once the document is complete.
 */
class Tagger {
  root: SElem;
  private stack: SElem[];
  /** Content ids handed out so far, per page (they count per page). */
  private mcids = new Map<PDFPage, number>();
  /** The Link elements created so far, in document order. */
  links: SElem[] = [];
  /** The link element the pieces drawn so far on this line belong to. */
  link: { href: string; node: SElem } | null = null;

  constructor(private doc: PDFDocument) {
    this.root = { s: 'Document', parent: null, kids: [] };
    this.stack = [this.root];
  }

  get top(): SElem {
    return this.stack[this.stack.length - 1];
  }

  /** Open an element: it owns everything drawn until it is closed. */
  push(s: string, keepEmpty = false): SElem {
    const node: SElem = { s, parent: this.top, kids: [], keepEmpty };
    this.top.kids.push(node);
    this.stack.push(node);
    return node;
  }

  pop(): void {
    this.stack.pop();
    this.link = null;
  }

  /** An element outside the stack order (a list label is drawn with the line that follows it). */
  child(s: string): SElem {
    const node: SElem = { s, parent: this.top, kids: [] };
    this.top.kids.push(node);
    return node;
  }

  /** The element for the link pieces drawn now: one element per run of link text on a line. */
  linkNode(href: string): SElem {
    if (this.link?.href === href) return this.link.node;
    const node: SElem = { s: 'Link', parent: this.top, kids: [] };
    this.top.kids.push(node);
    this.links.push(node);
    this.link = { href, node };
    return node;
  }

  /** Open a marked-content sequence owned by `owner`: emit it, draw, then emit `close()`. */
  open(page: PDFPage, owner: SElem): PDFOperator {
    const mcid = this.mcids.get(page) ?? 0;
    this.mcids.set(page, mcid + 1);
    owner.kids.push({ page: page.ref, mcid });
    return PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
      PDFName.of(owner.s),
      // A properties dictionary is a legal BDC operand; the fork's arg type omits it.
      this.doc.context.obj({ MCID: PDFNumber.of(mcid) }) as never,
    ]);
  }

  close(): PDFOperator {
    return endMarkedContent();
  }
}

/**
 * Write the recorded structure into the document: pruned of the elements nothing was drawn
 * in, with the parent tree that leads pages and link annotations back to their elements,
 * and /MarkInfo, so the file counts as tagged. Marked-content ids count per page, so items
 * an element holds on another page than its /Pg go in as MCR references.
 */
function setStructTree(doc: PDFDocument, tag: Tagger): void {
  // A link's annotation joins its element as an object reference, like tagAnnots writes them.
  for (const n of tag.links) if (n.annot) n.kids.push({ objr: n.annot.ref, page: n.annot.page });
  const prune = (n: SElem): boolean => {
    n.kids = n.kids.filter((k) => !('s' in k) || !prune(k));
    return !n.kids.length && !n.keepEmpty && !n.annot;
  };
  prune(tag.root);

  const ctx = doc.context;
  const refs = new Map<SElem, PDFRef>();
  const assign = (n: SElem): void => {
    refs.set(n, ctx.nextRef());
    for (const k of n.kids) if ('s' in k) assign(k);
  };
  const rootRef = ctx.nextRef();
  assign(tag.root);

  // The page the content of an element starts on (for /Pg).
  const firstPage = (n: SElem): PDFRef | undefined => {
    for (const k of n.kids) {
      if (!('s' in k)) return k.page;
      const p = firstPage(k);
      if (p) return p;
    }
    return undefined;
  };
  /** Per page: the element each marked-content id belongs to (the parent tree's arrays). */
  const owners = new Map<PDFRef, SElem[]>();
  const build = (n: SElem, parent: PDFRef): void => {
    for (const k of n.kids) if ('s' in k) build(k, refs.get(n)!);
    const pg = firstPage(n);
    const kids = n.kids.map((k) =>
      's' in k ? refs.get(k)
        : 'objr' in k ? ctx.obj({ Type: 'OBJR', Obj: k.objr, Pg: k.page })
        : k.page === pg ? PDFNumber.of(k.mcid)
        : ctx.obj({ Type: 'MCR', Pg: k.page, MCID: PDFNumber.of(k.mcid) }));
    ctx.assign(refs.get(n)!, ctx.obj({
      Type: 'StructElem', S: n.s, P: parent,
      ...(pg ? { Pg: pg } : {}),
      ...(n.alt ? { Alt: PDFHexString.fromText(n.alt) } : {}),
      K: kids.length === 1 ? kids[0] : ctx.obj(kids),
    }));
    for (const k of n.kids) {
      if ('s' in k || 'objr' in k) continue;
      let list = owners.get(k.page);
      if (!list) owners.set(k.page, (list = []));
      list[k.mcid] = n;
    }
  };
  build(tag.root, rootRef);

  // The parent tree: per page, one element per marked-content id; per link annotation, its
  // element. Pages without marked content need no key.
  const nums: (PDFNumber | PDFRef)[] = [];
  let nextKey = 0;
  for (const page of doc.getPages()) {
    const list = owners.get(page.ref);
    if (!list) continue;
    page.node.set(PDFName.of('StructParents'), PDFNumber.of(nextKey));
    nums.push(PDFNumber.of(nextKey), ctx.register(ctx.obj(list.map((e) => refs.get(e)!))));
    nextKey++;
  }
  for (const n of tag.links) {
    if (!n.annot) continue;
    n.annot.dict.set(PDFName.of('StructParent'), PDFNumber.of(nextKey));
    nums.push(PDFNumber.of(nextKey), ctx.register(ctx.obj([refs.get(n)!])));
    nextKey++;
  }
  ctx.assign(rootRef, ctx.obj({
    Type: 'StructTreeRoot',
    K: [refs.get(tag.root)!],
    ParentTree: ctx.register(ctx.obj({ Nums: ctx.obj(nums) })),
    ParentTreeNextKey: PDFNumber.of(nextKey),
  }));
  doc.catalog.set(PDFName.of('StructTreeRoot'), rootRef);
  doc.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));
}

// ---------------------------------------------------------------- page writer

type Marker = { kind: 'bullet'; depth: number } | { kind: 'number'; text: string } | { kind: 'task'; checked: boolean };

interface Heading {
  level: number;
  title: string;
  page: number;
  y: number;
}

interface PendingLink {
  page: number;
  rect: [number, number, number, number];
  href: string;
  /** The link's structure element (missing for pieces with no text of their own). */
  node?: SElem;
}

class Writer {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  readonly tag: Tagger;
  readonly top: number;
  readonly bottom: number;
  /** Active block quotes: bar position and where the bar started on this page. */
  quotes: { x: number; from: number }[] = [];
  marker: { marker: Marker; x: number; size: number; lbl?: SElem } | null = null;
  headings: Heading[] = [];
  links: PendingLink[] = [];
  /** Font resource keys per page, so a font is registered once however often it is drawn. */
  private fontKeys = new Map<PDFPage, Map<PDFFont, PDFName>>();

  constructor(readonly doc: PDFDocument, readonly fonts: Fonts, readonly w: number, readonly h: number, readonly margin: number, readonly base: number) {
    this.tag = new Tagger(doc);
    this.top = h - margin;
    this.bottom = margin;
    this.newPage();
  }

  newPage() {
    if (this.page) for (const q of this.quotes) this.quoteBar(q, this.bottom);
    this.page = this.doc.addPage([this.w, this.h]);
    this.pages.push(this.page);
    this.y = this.top;
    for (const q of this.quotes) q.from = this.top;
  }

  atTop() {
    return this.y >= this.top - 0.01;
  }

  /** Vertical space between blocks (none at the top of a page). */
  space(h: number) {
    if (this.atTop()) return;
    this.y -= h;
  }

  /** Start a new page unless `h` points still fit. */
  ensure(h: number) {
    if (this.y - h < this.bottom - 0.01 && !this.atTop()) this.newPage();
  }

  quoteBar(q: { x: number; from: number }, to: number) {
    if (q.from - to > 0.5) this.page.drawRectangle({ x: q.x, y: to, width: 2.5, height: q.from - to, color: RULE });
  }

  /** The resource name of `font` on `page`, registering it on first use (drawText does this itself). */
  private fontOf(page: PDFPage, font: PDFFont): PDFName {
    let keys = this.fontKeys.get(page);
    if (!keys) this.fontKeys.set(page, (keys = new Map()));
    let key = keys.get(font);
    if (!key) keys.set(font, (key = page.node.newFontDictionary(font.name, font.ref)));
    return key;
  }

  /** Draw a pending list marker next to a line whose baseline is `baseline`. */
  drawMarker(baseline: number) {
    const m = this.marker;
    if (!m) return;
    this.marker = null;
    const s = m.size;
    const mid = baseline + s * 0.32;
    if (m.marker.kind === 'bullet') {
      const r = s * 0.17;
      const cx = m.x + s * 0.35;
      const d = m.marker.depth % 3;
      if (d === 0) this.page.drawCircle({ x: cx, y: mid, size: r, color: TEXT });
      else if (d === 1) this.page.drawCircle({ x: cx, y: mid, size: r, borderColor: TEXT, borderWidth: 0.7 });
      else this.page.drawRectangle({ x: cx - r, y: mid - r, width: 2 * r, height: 2 * r, color: TEXT });
    } else if (m.marker.kind === 'number') {
      this.text(this.fonts.regular, m.marker.text, m.x, baseline, s, TEXT, false, m.lbl);
    } else {
      const b = s * 0.72;
      const x = m.x;
      const y = baseline - s * 0.08;
      this.page.drawRectangle({ x, y, width: b, height: b, borderColor: TEXT, borderWidth: 0.7, color: m.marker.checked ? rgb(0.9, 0.93, 0.98) : undefined });
      if (m.marker.checked) {
        this.page.drawLine({ start: { x: x + b * 0.2, y: y + b * 0.5 }, end: { x: x + b * 0.42, y: y + b * 0.22 }, thickness: 1.1, color: TEXT });
        this.page.drawLine({ start: { x: x + b * 0.42, y: y + b * 0.22 }, end: { x: x + b * 0.82, y: y + b * 0.8 }, thickness: 1.1, color: TEXT });
      }
    }
  }

  text(engine: TextEngine, text: string, x: number, baseline: number, size: number, color: RGB, italic = false, owner?: SElem): number {
    // The text becomes marked content of the element it belongs to (space alone is no content).
    const o = owner ?? this.tag.top;
    const open = /\S/.test(text) ? this.tag.open(this.page, o) : null;
    if (open) this.page.pushOperators(open);
    let dx = 0;
    for (const run of engine.runs(text)) {
      this.page.drawText(run.text, { x: x + dx, y: baseline, size, font: run.font, color, ...(italic ? { ySkew: OBLIQUE } : {}) });
      dx += run.font.widthOfTextAtSize(run.text, size);
    }
    if (open) this.page.pushOperators(this.tag.close());
    return dx;
  }

  /** Draw a laid-out line with its baseline at `baseline`. */
  drawLine(line: Line, x: number, baseline: number, size: number, color: RGB = this.quotes.length ? MUTED : TEXT) {
    this.drawMarker(baseline);
    // A link's element does not reach across lines.
    this.tag.link = null;
    // One content item and one text object per line, owned by the block element: the runs
    // join into one findable, replaceable line, and marked-content sequences must not nest,
    // so a link's element holds its annotation, not its text.
    const content = line.pieces.some((p) => /\S/.test(p.text));
    let dx = 0;
    // Code backgrounds go under the whole line, before any text is drawn.
    for (const p of line.pieces) {
      if (p.style.code) this.page.drawRectangle({ x: x + dx - 1.5, y: baseline - size * 0.27, width: p.w + 3, height: size * 1.12, color: CODE_BG });
      dx += p.w;
    }
    const open = content ? this.tag.open(this.page, this.tag.top) : null;
    if (open) this.page.pushOperators(open);
    if (content) {
      // Font, size and colour change only when they must, so the runs of a line stay one
      // text object for search and replacement.
      const ops: PDFOperator[] = [beginText()];
      let font: PDFFont | undefined;
      let sizeAt = 0;
      let fill: RGB | undefined;
      dx = 0;
      for (const p of line.pieces) {
        const fs = sizeOf(p.style, size);
        const c = p.style.href ? LINK : p.style.muted ? MUTED : color;
        for (const run of engineOf(this.fonts, p.style).runs(p.text)) {
          if (!run.text) continue;
          if (run.font !== font || fs !== sizeAt) {
            font = run.font;
            sizeAt = fs;
            ops.push(setFontAndSize(this.fontOf(this.page, run.font), fs));
          }
          if (c !== fill) {
            fill = c;
            ops.push(setFillingColor(c));
          }
          ops.push(rotateAndSkewTextRadiansAndTranslate(0, 0, p.style.italic ? toRadians(OBLIQUE) : 0, x + dx, baseline));
          ops.push(showText(run.font.encodeText(run.text)));
          dx += run.font.widthOfTextAtSize(run.text, fs);
        }
      }
      ops.push(endText());
      this.page.pushOperators(...ops);
    }
    dx = 0;
    for (const p of line.pieces) {
      const s = p.style;
      const px = x + dx;
      if (s.href) {
        const owner = this.tag.linkNode(s.href);
        if (p.text.trim()) this.page.drawLine({ start: { x: px, y: baseline - size * 0.13 }, end: { x: px + p.w, y: baseline - size * 0.13 }, thickness: 0.5, color: LINK });
        this.links.push({ page: this.pages.length - 1, rect: [px, baseline - size * 0.3, px + p.w, baseline + size * 0.9], href: s.href, node: owner });
      }
      if (s.strike) this.page.drawLine({ start: { x: px, y: baseline + size * 0.3 }, end: { x: px + p.w, y: baseline + size * 0.3 }, thickness: 0.6, color: s.href ? LINK : s.muted ? MUTED : color });
      dx += p.w;
    }
    if (open) this.page.pushOperators(this.tag.close());
  }

  /** Lay out a paragraph of styled text, breaking pages between lines. */
  paragraph(frags: Frag[], x: number, width: number, size: number, lineHeight = 1.45) {
    const lh = size * lineHeight;
    for (const line of wrap(this.fonts, frags, size, width)) {
      this.ensure(lh);
      this.drawLine(line, x, this.y - size * 1.05, size);
      this.y -= lh;
    }
  }
}

// ---------------------------------------------------------------- blocks

const HEADING_SCALE = [2, 1.6, 1.3, 1.15, 1, 0.95];

function imageData(src: string): { png: boolean; bytes: Uint8Array } | null {
  const m = /^data:image\/(png|jpe?g);base64,([a-z0-9+/=\s]+)$/i.exec(src.trim());
  if (!m) return null;
  try {
    const bin = atob(m[2].replace(/\s/g, ''));
    return { png: m[1].toLowerCase() === 'png', bytes: Uint8Array.from(bin, (c) => c.charCodeAt(0)) };
  } catch {
    return null;
  }
}

class Layout {
  private slugs = new Map<string, number>();
  images = new Map<string, PDFImage>();
  anchors = new Map<string, { page: number; y: number }>();

  constructor(readonly wr: Writer) {}

  blocks(blocks: Block[], x: number, width: number, depth: { list: number; tight: boolean }) {
    blocks.forEach((b, i) => this.block(b, x, width, depth, i === 0));
  }

  private gap(first: boolean, tight: boolean) {
    const base = this.wr.base;
    if (!first) this.wr.space(tight ? base * 0.25 : base * 0.75);
  }

  block(b: Block, x: number, width: number, depth: { list: number; tight: boolean }, first: boolean) {
    const wr = this.wr;
    const base = wr.base;
    switch (b.type) {
      case 'heading': {
        const size = base * HEADING_SCALE[b.level - 1];
        if (!first) wr.space(size * (b.level <= 2 ? 0.9 : 0.75));
        // Keep the heading with the start of what follows.
        wr.ensure(size * 1.35 + base * 1.45 * 2);
        const title = inlineText(b.content).trim();
        let s = slug(title);
        const n = this.slugs.get(s) ?? 0;
        this.slugs.set(s, n + 1);
        if (n) s = `${s}-${n}`;
        const at = { page: wr.pages.length - 1, y: Math.min(wr.top, wr.y + size * 0.3) };
        this.anchors.set(s, at);
        if (title) wr.headings.push({ level: b.level, title, ...at });
        wr.tag.push(`H${b.level}`);
        wr.paragraph(flatten(b.content, { bold: true, muted: b.level === 6 }), x, width, size, 1.3);
        if (b.level <= 2) {
          wr.y -= size * 0.15;
          wr.page.drawLine({ start: { x, y: wr.y }, end: { x: x + width, y: wr.y }, thickness: b.level === 1 ? 0.8 : 0.5, color: RULE });
        }
        wr.y -= base * 0.35;
        wr.tag.pop();
        return;
      }
      case 'paragraph': {
        this.gap(first, depth.tight);
        const images = b.content.filter((n) => n.type === 'image');
        const onlyImages = images.length && b.content.every((n) => n.type === 'image' || n.type === 'br' || (n.type === 'text' && !n.text.trim()));
        if (onlyImages && images.every((n) => n.type === 'image' && this.images.has(n.src))) {
          images.forEach((n, k) => {
            if (k) wr.space(base * 0.5);
            this.image(n as Extract<Inline, { type: 'image' }>, x, width);
          });
          return;
        }
        wr.tag.push('P');
        wr.paragraph(flatten(b.content, {}), x, width, base);
        wr.tag.pop();
        return;
      }
      case 'code': {
        this.gap(first, depth.tight);
        wr.tag.push('Code');
        this.code(b.text, x, width);
        wr.tag.pop();
        return;
      }
      case 'quote': {
        this.gap(first, depth.tight);
        const q = { x: x + 1, from: wr.y };
        wr.quotes.push(q);
        wr.tag.push('BlockQuote');
        const inner = base * 1.1;
        // Quoted text is drawn in grey (see drawLine).
        this.blocks(b.children, x + inner, width - inner, { ...depth, tight: false });
        wr.tag.pop();
        wr.quotes.pop();
        wr.quoteBar(q, wr.y + base * 0.3);
        return;
      }
      case 'list': {
        this.gap(first, depth.tight);
        const last = b.start + b.items.length - 1;
        const numW = b.ordered ? wr.fonts.regular.width(`${last}.`, base) : 0;
        const indent = Math.max(base * 1.6, numW + base * 0.6);
        wr.tag.push('L');
        b.items.forEach((item, k) => {
          if (k) wr.space(b.tight ? base * 0.2 : base * 0.6);
          wr.tag.push('LI');
          const marker: Marker = item.checked !== null ? { kind: 'task', checked: item.checked } : b.ordered ? { kind: 'number', text: `${b.start + k}.` } : { kind: 'bullet', depth: depth.list };
          // Only an ordered marker is text; bullets and check boxes are graphics without content.
          wr.marker = { marker, x, size: base, lbl: marker.kind === 'number' ? wr.tag.child('Lbl') : undefined };
          if (!item.children.length) {
            wr.ensure(base * 1.45);
            wr.drawMarker(wr.y - base * 1.05);
            wr.y -= base * 1.45;
          } else {
            const firstChild = item.children[0];
            if (firstChild.type !== 'paragraph' && firstChild.type !== 'heading' && firstChild.type !== 'code') {
              wr.ensure(base * 1.45);
              wr.drawMarker(wr.y - base * 1.05);
            }
            wr.tag.push('LBody');
            this.blocks(item.children, x + indent, width - indent, { list: depth.list + 1, tight: b.tight });
            wr.tag.pop();
          }
          wr.tag.pop();
          wr.marker = null;
        });
        wr.tag.pop();
        return;
      }
      case 'table': {
        this.gap(first, depth.tight);
        wr.tag.push('Table');
        this.table(b, x, width);
        wr.tag.pop();
        return;
      }
      case 'hr': {
        this.gap(first, depth.tight);
        wr.ensure(base);
        const y = wr.y - base * 0.5;
        wr.page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: 1, color: RULE });
        wr.y -= base;
        return;
      }
    }
  }

  code(text: string, x: number, width: number) {
    const wr = this.wr;
    const size = wr.base * 0.85;
    const lh = size * 1.4;
    const pad = size * 0.8;
    const mono = wr.fonts.mono;
    // Break long lines at the box edge, keeping all spaces.
    const lines: string[] = [];
    for (const raw of text.replace(/\s+$/, '').split('\n')) {
      let cur = '';
      for (const ch of raw) {
        if (cur && mono.width(cur + ch, size) > width - 2 * pad) {
          lines.push(cur);
          cur = ch;
        } else cur += ch;
      }
      lines.push(cur);
    }
    let k = 0;
    while (k < lines.length) {
      wr.ensure(lh + 2 * pad);
      const fit = Math.max(1, Math.floor((wr.y - wr.bottom - 2 * pad) / lh));
      const n = Math.min(fit, lines.length - k);
      const h = n * lh + 2 * pad;
      wr.page.drawRectangle({ x, y: wr.y - h, width, height: h, color: CODE_BG });
      for (let j = 0; j < n; j++) {
        const baseline = wr.y - pad - j * lh - size * 1.0;
        if (k === 0 && j === 0) wr.drawMarker(baseline);
        wr.text(mono, lines[k + j], x + pad, baseline, size, TEXT);
      }
      k += n;
      wr.y -= h;
      if (k < lines.length) wr.newPage();
    }
  }

  image(n: Extract<Inline, { type: 'image' }>, x: number, width: number) {
    const wr = this.wr;
    const img = this.images.get(n.src);
    if (!img) return;
    // 96 dpi, shrunk to fit the column and the page.
    let w = img.width * 0.75;
    let h = img.height * 0.75;
    const k = Math.min(1, width / w, (wr.top - wr.bottom) / h);
    w *= k;
    h *= k;
    wr.ensure(h);
    wr.drawMarker(wr.y - wr.base);
    const fig = wr.tag.push('Figure');
    if (n.alt) fig.alt = n.alt;
    wr.page.pushOperators(wr.tag.open(wr.page, fig));
    wr.page.drawImage(img, { x, y: wr.y - h, width: w, height: h });
    wr.page.pushOperators(wr.tag.close());
    wr.tag.pop();
    wr.y -= h;
  }

  table(b: Extract<Block, { type: 'table' }>, x: number, width: number) {
    const wr = this.wr;
    const size = wr.base * 0.92;
    const lh = size * 1.35;
    const padX = size * 0.5;
    const padY = size * 0.35;
    const cols = b.header.length;
    const head = b.header.map((c) => flatten(c, { bold: true }));
    const rows = b.rows.map((r) => r.map((c) => flatten(c, {})));
    // Natural and minimum (longest word) widths per column.
    const natural = new Array<number>(cols).fill(0);
    const minimum = new Array<number>(cols).fill(0);
    for (const r of [head, ...rows]) {
      r.forEach((frags, c) => {
        const one = wrap(wr.fonts, frags, size, Infinity);
        natural[c] = Math.max(natural[c], ...one.map((l) => l.width));
        for (const f of frags) if (!('br' in f)) for (const word of f.text.split(/\s+/)) if (word) minimum[c] = Math.max(minimum[c], engineOf(wr.fonts, f.style).width(word, sizeOf(f.style, size)));
      });
    }
    const avail = width - cols * 2 * padX;
    const nat = natural.map((v, c) => Math.max(v, minimum[c], size));
    let widths: number[];
    const natSum = nat.reduce((a, v) => a + v, 0);
    const minSum = minimum.reduce((a, v) => a + Math.max(v, size), 0);
    if (natSum <= avail) widths = nat;
    else if (minSum >= avail) widths = minimum.map((v) => (Math.max(v, size) / minSum) * avail);
    else {
      const extra = avail - minSum;
      const want = nat.reduce((a, v, c) => a + (v - Math.max(minimum[c], size)), 0);
      widths = nat.map((v, c) => Math.max(minimum[c], size) + (want ? ((v - Math.max(minimum[c], size)) / want) * extra : 0));
    }
    const colW = widths.map((v) => v + 2 * padX);
    const tableW = colW.reduce((a, v) => a + v, 0);

    const drawRow = (cellsF: ReturnType<typeof flatten>[], header: boolean) => {
      const wrapped = cellsF.map((frags, c) => wrap(wr.fonts, frags, size, widths[c]));
      const h = Math.max(...wrapped.map((l) => l.length)) * lh + 2 * padY;
      return { wrapped, h, header };
    };
    const headRow = drawRow(head, true);
    const paint = (row: ReturnType<typeof drawRow>) => {
      const top = wr.y;
      if (row.header) wr.page.drawRectangle({ x, y: top - row.h, width: tableW, height: row.h, color: CODE_BG });
      wr.tag.push('TR');
      let cx = x;
      row.wrapped.forEach((lines, c) => {
        // Cells stay in the tree even when empty, so the table keeps its grid.
        wr.tag.push(row.header ? 'TH' : 'TD', true);
        wr.tag.push('P');
        lines.forEach((line, j) => {
          const free = colW[c] - 2 * padX - line.width;
          const al: Align = b.align[c];
          const dx = al === 'right' ? free : al === 'center' ? free / 2 : 0;
          wr.drawLine(line, cx + padX + Math.max(0, dx), top - padY - j * lh - size * 1.0, size);
        });
        wr.tag.pop();
        wr.tag.pop();
        cx += colW[c];
      });
      wr.tag.pop();
      const border = { thickness: 0.5, color: RULE };
      wr.page.drawLine({ start: { x, y: top }, end: { x: x + tableW, y: top }, ...border });
      wr.page.drawLine({ start: { x, y: top - row.h }, end: { x: x + tableW, y: top - row.h }, ...border });
      let vx = x;
      for (let c = 0; c <= cols; c++) {
        wr.page.drawLine({ start: { x: vx, y: top }, end: { x: vx, y: top - row.h }, ...border });
        vx += colW[c] ?? 0;
      }
      wr.y -= row.h;
    };
    // The header stays with the first row.
    const firstRow = rows.length ? drawRow(rows[0], false) : null;
    wr.ensure(headRow.h + (firstRow?.h ?? 0));
    paint(headRow);
    rows.forEach((cellsF, k) => {
      const row = k === 0 ? firstRow! : drawRow(cellsF, false);
      if (wr.y - row.h < wr.bottom - 0.01) {
        // Continue on the next page, repeating the header.
        wr.newPage();
        paint(headRow);
      }
      paint(row);
    });
  }
}

// ---------------------------------------------------------------- fonts

/** All text of the document, by the font weight it is drawn in. */
function collectText(blocks: Block[], out: { regular: string[]; bold: string[]; code: string[] }) {
  const inl = (nodes: Inline[], bold: boolean) => {
    for (const n of nodes) {
      if (n.type === 'text') (bold ? out.bold : out.regular).push(n.text);
      else if (n.type === 'code') out.code.push(n.text);
      else if (n.type === 'image') (bold ? out.bold : out.regular).push(`[${n.alt}][image]`);
      else if (n.type === 'strong') inl(n.children, true);
      else if (n.type !== 'br') inl(n.children, bold);
    }
  };
  for (const b of blocks) {
    if (b.type === 'heading') inl(b.content, true);
    else if (b.type === 'paragraph') inl(b.content, false);
    else if (b.type === 'code') out.code.push(b.text);
    else if (b.type === 'quote') collectText(b.children, out);
    else if (b.type === 'list') {
      out.regular.push('0123456789.');
      for (const it of b.items) collectText(it.children, out);
    } else if (b.type === 'table') {
      b.header.forEach((c) => inl(c, true));
      b.rows.forEach((r) => r.forEach((c) => inl(c, false)));
    }
  }
}

async function makeFonts(doc: PDFDocument, blocks: Block[]): Promise<Fonts> {
  const texts = { regular: [] as string[], bold: [] as string[], code: [] as string[] };
  collectText(blocks, texts);
  // Code used to be drawn in Courier, a standard font: those are not embedded, which breaks
  // PDF/A and renders differently across viewers, and no monospaced font is bundled. So code
  // is drawn with the embedded Noto Sans engine like the rest of the text (a proportional
  // look — the trade-off for a file that carries all its fonts).
  const regular = await createTextEngine(doc, [...texts.regular, ...texts.code].filter(Boolean));
  const bold = await createTextEngine(doc, texts.bold.filter(Boolean), 'bold');
  return { regular, bold, mono: regular };
}

// ---------------------------------------------------------------- links, bookmarks, entry points

function addLinks(doc: PDFDocument, wr: Writer, anchors: Map<string, { page: number; y: number }>) {
  // Neighbouring pieces of one link on a line become one link area.
  const merged: PendingLink[] = [];
  for (const l of wr.links) {
    const last = merged[merged.length - 1];
    if (last && last.page === l.page && last.href === l.href && Math.abs(last.rect[1] - l.rect[1]) < 0.5 && Math.abs(last.rect[2] - l.rect[0]) < 1) {
      last.rect[2] = l.rect[2];
      last.node ??= l.node;
    } else merged.push({ ...l, rect: [...l.rect] });
  }
  for (const l of merged) {
    let target: Record<string, unknown>;
    if (l.href.startsWith('#')) {
      let id = l.href.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // Keep it as written.
      }
      const a = anchors.get(id.toLowerCase()) ?? anchors.get(slug(id));
      if (!a) continue;
      target = { Dest: [wr.pages[a.page].ref, PDFName.of('XYZ'), PDFNull, PDFNumber.of(a.y), PDFNull] };
    } else if (/^(https?|mailto|ftp|tel):/i.test(l.href)) {
      target = { A: { Type: 'Action', S: 'URI', URI: asciiString(l.href) } };
    } else continue; // Relative links have nothing to point to in a PDF.
    const page = wr.pages[l.page];
    const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: l.rect, Border: [0, 0, 0], F: 4, ...target }) as PDFDict;
    const ref = doc.context.register(annot);
    // The link's structure element gets the annotation as an object reference, and a
    // parent-tree key for it, when the structure tree is written (setStructTree).
    if (l.node) l.node.annot = { ref, dict: annot, page: page.ref };
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (annots instanceof PDFArray) annots.push(ref);
    else page.node.set(PDFName.of('Annots'), doc.context.obj([ref as PDFRef]));
  }
}

/** Bookmarks nested by heading level. */
function bookmarks(headings: Heading[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: { level: number; node: OutlineNode }[] = [];
  headings.forEach((h, i) => {
    const node: OutlineNode = { id: `md-${i}`, title: h.title, page: h.page, y: h.y, open: h.level <= 2, bold: false, italic: false, children: [] };
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    (stack.length ? stack[stack.length - 1].node.children : roots).push(node);
    stack.push({ level: h.level, node });
  });
  return roots;
}

/** The document language, the way sample.ts sets it: the interface language as a BCP 47 tag. */
const docLanguage = (lang: Lang = useLang.getState().lang): string => (lang === 'de' ? 'de-DE' : 'en-GB');

async function finishDoc(doc: PDFDocument, wr: Writer, anchors: Map<string, { page: number; y: number }>, title: string | undefined): Promise<Uint8Array> {
  addLinks(doc, wr, anchors);
  if (wr.headings.length) setOutline(doc, bookmarks(wr.headings));
  setStructTree(doc, wr.tag);
  const docTitle = title || wr.headings[0]?.title;
  if (docTitle) doc.setTitle(docTitle, { showInWindowTitleBar: true });
  doc.setCreator('PDF-Xploder');
  return saveDoc(doc);
}

/** Embed the images given inline as data: URLs (others cannot be loaded and show their description). */
async function embedImages(doc: PDFDocument, blocks: Block[], layout: Layout) {
  const visit = async (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.type === 'image' && !layout.images.has(n.src)) {
        const data = imageData(n.src);
        if (!data) continue;
        try {
          layout.images.set(n.src, data.png ? await doc.embedPng(data.bytes) : await doc.embedJpg(data.bytes));
        } catch {
          // Broken image data: shown as its description.
        }
      } else if ('children' in n) await visit(n.children);
    }
  };
  for (const b of blocks) {
    if (b.type === 'paragraph' || b.type === 'heading') await visit(b.content);
    else if (b.type === 'quote') await embedImages(doc, b.children, layout);
    else if (b.type === 'list') for (const it of b.items) await embedImages(doc, it.children, layout);
  }
}

/** Convert a Markdown document to a PDF. */
export async function markdownToPdf(markdown: string, o: TextPdfOptions = {}): Promise<Uint8Array> {
  const blocks = parseMarkdown(substituteSymbols(markdown));
  const doc = await PDFDocument.create();
  // The stamp and the language the other documents the app creates get (see pdfOps, sample.ts).
  stampNewDocument(doc);
  doc.setLanguage(docLanguage(o.lang));
  const fonts = await makeFonts(doc, blocks);
  const [w, h] = o.pageSize ?? A4;
  const wr = new Writer(doc, fonts, w, h, o.margin ?? 56.7, o.fontSize ?? 11);
  const layout = new Layout(wr);
  // Images are embedded up front (embedding is asynchronous, layout is not).
  await embedImages(doc, blocks, layout);
  layout.blocks(blocks, wr.margin, w - 2 * wr.margin, { list: 0, tight: false });
  return finishDoc(doc, wr, layout.anchors, o.title);
}

const MONO: Style = { mono: true };

/** Convert plain text to a PDF: monospaced, line breaks and spacing kept, long lines wrapped. */
export async function textToPdf(text: string, o: TextPdfOptions = {}): Promise<Uint8Array> {
  const clean = substituteSymbols(text).replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').replace(/\f/g, '\n');
  const lines = clean.split('\n').map((l) => {
    let out = '';
    for (const ch of l) out += ch === '\t' ? ' '.repeat(8 - (out.length % 8)) : ch;
    return out;
  });
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();
  const doc = await PDFDocument.create();
  stampNewDocument(doc);
  doc.setLanguage(docLanguage(o.lang));
  const fonts = await makeFonts(doc, [{ type: 'code', lang: '', text: lines.join('\n') }]);
  const [w, h] = o.pageSize ?? A4;
  const size = o.fontSize ?? 10;
  const wr = new Writer(doc, fonts, w, h, o.margin ?? 56.7, size);
  const lh = size * 1.3;
  const width = w - 2 * wr.margin;
  for (const l of lines) {
    // Wrap at spaces where possible, else anywhere; wrapped lines keep the indentation.
    const indent = /^ */.exec(l)![0];
    const indentW = Math.min(fonts.mono.width(indent, size), width / 2);
    const wrapped = l.trim() ? wrap(fonts, [{ text: l.slice(indent.length), style: MONO }], size, width - indentW) : [];
    if (!wrapped.length) {
      wr.ensure(lh);
      wr.y -= lh;
      continue;
    }
    // Each source line reads as its own paragraph (plain text keeps its line structure).
    wr.tag.push('P');
    for (const line of wrapped) {
      wr.ensure(lh);
      wr.drawLine(line, wr.margin + indentW, wr.y - size, size);
      wr.y -= lh;
    }
    wr.tag.pop();
  }
  return finishDoc(doc, wr, new Map(), o.title);
}
