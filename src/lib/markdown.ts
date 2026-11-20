/**
 * A small Markdown parser (CommonMark with the common GitHub extensions: tables,
 * task lists, strikethrough, bare URLs). It produces a plain tree for laying out
 * as PDF pages; raw HTML is reduced to its text (with <br> as a line break).
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'br' }
  | { type: 'strong' | 'em' | 'del'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'image'; src: string; alt: string };

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { type: 'heading'; level: number; content: Inline[] }
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; tight: boolean; items: ListItem[] }
  | { type: 'table'; align: Align[]; header: Inline[][]; rows: Inline[][][] }
  | { type: 'hr' };

export interface ListItem {
  /** null for ordinary items, true/false for task list items ([x] / [ ]). */
  checked: boolean | null;
  children: Block[];
}

interface LinkDef {
  href: string;
}
type Defs = Map<string, LinkDef>;

// ---------------------------------------------------------------- blocks

const RE = {
  blank: /^[ \t]*$/,
  fence: /^( {0,3})(`{3,}|~{3,})[ \t]*([^`]*)$/,
  atx: /^ {0,3}(#{1,6})(?=[ \t]|$)[ \t]*(.*?)(?:[ \t]+#+)?[ \t]*$/,
  hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
  quote: /^ {0,3}> ?/,
  item: /^( {0,3})([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*)|$)/,
  setext: /^ {0,3}(=+|-+)[ \t]*$/,
  indented: /^(?: {4}|\t)/,
  tableDelim: /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/,
  def: /^ {0,3}\[([^\]]+)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/,
  htmlComment: /^ {0,3}<!--/,
};

const normLabel = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Expand tabs to the next multiple of four (enough for indentation). */
function detab(line: string): string {
  if (!line.includes('\t')) return line;
  let out = '';
  for (const ch of line) out += ch === '\t' ? ' '.repeat(4 - (out.length % 4)) : ch;
  return out;
}

/** Split a table row into cells (escaped pipes stay in the cell). */
function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = '';
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '`') {
      code = !code;
      cur += ch;
    } else if (ch === '|' && !code) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Whether `line` starts a block that interrupts a paragraph. */
function interrupts(line: string): boolean {
  if (RE.atx.test(line) || RE.fence.test(line) || RE.hr.test(line) || RE.quote.test(line) || RE.htmlComment.test(line)) return true;
  const m = RE.item.exec(line);
  // Only bullets and lists starting at 1 interrupt a paragraph, and not when empty.
  return !!m && !!m[4]?.trim() && (/^[-*+]$/.test(m[2]) || /^1[.)]$/.test(m[2]));
}

interface Raw {
  blocks: RawBlock[];
}
/** Blocks before inline parsing (link definitions are only known at the end). */
type RawBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; lang: string; text: string }
  | { type: 'quote'; children: RawBlock[] }
  | { type: 'list'; ordered: boolean; start: number; tight: boolean; items: { checked: boolean | null; children: RawBlock[] }[] }
  | { type: 'table'; align: Align[]; header: string[]; rows: string[][] }
  | { type: 'hr' };

function parseBlocks(input: string[], defs: Defs): RawBlock[] {
  const lines = input.map(detab);
  const out: RawBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (RE.blank.test(line)) {
      i++;
      continue;
    }
    // HTML comments are dropped.
    if (RE.htmlComment.test(line)) {
      while (i < lines.length && !lines[i].includes('-->')) i++;
      i++;
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = RE.fence.exec(line)) && !(m[2][0] === '`' && m[3].includes('`'))) {
      const indent = m[1].length;
      const fence = m[2];
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
        if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
          i++;
          break;
        }
        body.push(lines[i].replace(new RegExp(`^ {0,${indent}}`), ''));
        i++;
      }
      out.push({ type: 'code', lang: m[3].trim().split(/\s+/)[0] ?? '', text: body.join('\n') });
      continue;
    }
    if ((m = RE.atx.exec(line))) {
      out.push({ type: 'heading', level: m[1].length, text: m[2] });
      i++;
      continue;
    }
    if (RE.hr.test(line)) {
      out.push({ type: 'hr' });
      i++;
      continue;
    }
    if (RE.indented.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (RE.indented.test(lines[i]) || RE.blank.test(lines[i]))) body.push(lines[i++].replace(RE.indented, ''));
      while (body.length && RE.blank.test(body[body.length - 1])) body.pop();
      out.push({ type: 'code', lang: '', text: body.join('\n') });
      continue;
    }
    if (RE.quote.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (RE.quote.test(l)) inner.push(l.replace(RE.quote, ''));
        // Lazy continuation of a paragraph inside the quote.
        else if (!RE.blank.test(l) && inner.length && !RE.blank.test(inner[inner.length - 1]) && !interrupts(l)) inner.push(l);
        else break;
        i++;
      }
      out.push({ type: 'quote', children: parseBlocks(inner, defs) });
      continue;
    }
    if ((m = RE.item.exec(line))) {
      const ordered = /\d/.test(m[2]);
      const delim = m[2].slice(-1);
      const list: Extract<RawBlock, { type: 'list' }> = { type: 'list', ordered, start: ordered ? parseInt(m[2], 10) : 1, tight: true, items: [] };
      let blankBetween = false;
      while (i < lines.length && (m = RE.item.exec(lines[i])) && /\d/.test(m[2]) === ordered && m[2].slice(-1) === delim) {
        const markerEnd = m[1].length + m[2].length;
        const gap = m[3] ?? '';
        // Content starts after the marker and its spaces (at most four; more means indented code).
        const contentIndent = markerEnd + (gap.length >= 1 && gap.length <= 4 && m[4] !== '' ? gap.length : 1);
        const body: string[] = [m[4] ? ' '.repeat(Math.max(0, gap.length - (contentIndent - markerEnd))) + m[4] : ''];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (RE.blank.test(l)) {
            // A blank line ends the item unless indented content follows.
            let j = i;
            while (j < lines.length && RE.blank.test(lines[j])) j++;
            if (j < lines.length && lines[j].search(/\S/) >= contentIndent) {
              for (; i < j; i++) body.push('');
              continue;
            }
            break;
          }
          const ind = l.search(/\S/);
          if (ind >= contentIndent) body.push(l.slice(contentIndent));
          else if (!RE.item.test(l) && !interrupts(l) && !RE.blank.test(body[body.length - 1] ?? '')) body.push(l); // lazy continuation
          else break;
          i++;
        }
        let checked: boolean | null = null;
        const task = /^\[([ xX])\][ \t]+/.exec(body[0]);
        if (task) {
          checked = task[1] !== ' ';
          body[0] = body[0].slice(task[0].length);
        }
        const children = parseBlocks(body, defs);
        // Blank lines between the blocks of an item make the list loose.
        if (body.some((l, k) => RE.blank.test(l) && k > 0 && k < body.length - 1 && body.slice(k + 1).some((x) => !RE.blank.test(x)))) list.tight = false;
        list.items.push({ checked, children });
        // Blank lines between items.
        let j = i;
        while (j < lines.length && RE.blank.test(lines[j])) j++;
        const next = j < lines.length ? RE.item.exec(lines[j]) : null;
        if (j > i && next && /\d/.test(next[2]) === ordered && next[2].slice(-1) === delim) {
          blankBetween = true;
          i = j;
        }
      }
      if (blankBetween) list.tight = false;
      out.push(list);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && RE.tableDelim.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = cells(line);
      const align = cells(lines[i + 1]).map((c): Align => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
      if (align.length === header.length) {
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && !RE.blank.test(lines[i]) && lines[i].includes('|') && !interrupts(lines[i])) {
          const r = cells(lines[i++]);
          rows.push(header.map((_, k) => r[k] ?? ''));
        }
        out.push({ type: 'table', align, header, rows });
        continue;
      }
    }
    // Paragraph (or setext heading), with link reference definitions taken out.
    const para: string[] = [];
    let setext = 0;
    while (i < lines.length && !RE.blank.test(lines[i])) {
      const l = lines[i];
      if (para.length && (m = RE.setext.exec(l))) {
        setext = m[1][0] === '=' ? 1 : 2;
        i++;
        break;
      }
      if (para.length && (interrupts(l) || (l.includes('|') && i + 1 < lines.length && RE.tableDelim.test(lines[i + 1]) && lines[i + 1].includes('-')))) break;
      para.push(l);
      i++;
    }
    while (para.length && (m = RE.def.exec(para[0]))) {
      const label = normLabel(m[1]);
      if (!defs.has(label)) defs.set(label, { href: m[2] });
      para.shift();
    }
    if (!para.length) continue;
    const text = para.map((l) => l.replace(/^[ \t]+/, '')).join('\n');
    out.push(setext ? { type: 'heading', level: setext, text: text.trim() } : { type: 'paragraph', text });
  }
  return out;
}

// ---------------------------------------------------------------- inlines

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', bdquo: '„', euro: '€', deg: '°', times: '×', middot: '·', bull: '•',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', larr: '←', rarr: '→', check: '✓',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,31});/gi, (all, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '�';
    }
    return ENTITIES[e] ?? all;
  });
}

const PUNCT = /[!-/:-@[-`{-~\p{P}\p{S}]/u;
const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
const isPunct = (ch: string | undefined) => ch !== undefined && PUNCT.test(ch);

type Node = Inline | { type: 'delim'; char: string; count: number; open: boolean; close: boolean; orig: number };

/** Find the closing `]` of a link text starting after `start` (brackets nest, code spans and escapes skip). */
function closeBracket(s: string, start: number): number {
  let depth = 1;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') i++;
    else if (ch === '`') {
      const run = /^`+/.exec(s.slice(i))![0];
      const end = s.indexOf(run, i + run.length);
      if (end > 0) i = end + run.length - 1;
    } else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) return i;
  }
  return -1;
}

/** Parse `(url "title")` at `i`; returns the target and the index after `)`. */
function linkTarget(s: string, i: number): { href: string; end: number } | null {
  if (s[i] !== '(') return null;
  let j = i + 1;
  while (j < s.length && /[ \t\n]/.test(s[j])) j++;
  let href = '';
  if (s[j] === '<') {
    const end = s.indexOf('>', j);
    if (end < 0) return null;
    href = s.slice(j + 1, end);
    j = end + 1;
  } else {
    let depth = 0;
    for (; j < s.length; j++) {
      const ch = s[j];
      if (ch === '\\' && j + 1 < s.length) {
        href += s[++j];
        continue;
      }
      if (/\s/.test(ch)) break;
      if (ch === '(') depth++;
      if (ch === ')') {
        if (depth === 0) break;
        depth--;
      }
      href += ch;
    }
  }
  while (j < s.length && /[ \t\n]/.test(s[j])) j++;
  // Optional title.
  const q = s[j];
  if (q === '"' || q === "'" || q === '(') {
    const closeQ = q === '(' ? ')' : q;
    const end = s.indexOf(closeQ, j + 1);
    if (end < 0) return null;
    j = end + 1;
    while (j < s.length && /[ \t\n]/.test(s[j])) j++;
  }
  if (s[j] !== ')') return null;
  return { href: decodeEntities(href), end: j + 1 };
}

const plainText = (nodes: Inline[]): string => nodes.map((n) => ('children' in n ? plainText(n.children) : n.type === 'image' ? n.alt : n.type === 'br' ? ' ' : n.text)).join('');

function parseInlines(src: string, defs: Defs, inLink = false): Inline[] {
  const nodes: Node[] = [];
  let text = '';
  const flush = () => {
    if (text) nodes.push({ type: 'text', text });
    text = '';
  };
  const s = src;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    // Escapes and hard line breaks.
    if (ch === '\\') {
      if (s[i + 1] === '\n') {
        flush();
        nodes.push({ type: 'br' });
        i += 2;
        continue;
      }
      if (i + 1 < s.length && PUNCT.test(s[i + 1]) && s.charCodeAt(i + 1) < 128) {
        text += s[i + 1];
        i += 2;
        continue;
      }
    }
    if (ch === '\n') {
      const hard = / {2,}$/.test(text);
      text = text.replace(/ +$/, '');
      if (hard) {
        flush();
        nodes.push({ type: 'br' });
      } else text += ' ';
      i++;
      while (s[i] === ' ') i++;
      continue;
    }
    if (ch === '`') {
      const run = /^`+/.exec(s.slice(i))![0];
      let end = i + run.length;
      for (;;) {
        end = s.indexOf(run, end);
        if (end < 0 || s[end + run.length] !== '`') break;
        end = end + run.length + /^`+/.exec(s.slice(end + run.length))![0].length;
      }
      if (end >= 0) {
        flush();
        let code = s.slice(i + run.length, end).replace(/\n/g, ' ');
        if (/^ .*[^ ].* $/.test(code)) code = code.slice(1, -1);
        nodes.push({ type: 'code', text: code });
        i = end + run.length;
        continue;
      }
      text += run;
      i += run.length;
      continue;
    }
    if (ch === '<') {
      const auto = /^<([a-z][a-z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/i.exec(s.slice(i));
      if (auto && !inLink) {
        flush();
        const href = auto[1].includes(':') ? auto[1] : `mailto:${auto[1]}`;
        nodes.push({ type: 'link', href, children: [{ type: 'text', text: auto[1] }] });
        i += auto[0].length;
        continue;
      }
      const tag = /^<\/?([a-z][a-z0-9-]*)(?:\s[^<>]*)?\/?>/i.exec(s.slice(i));
      if (tag) {
        flush();
        if (tag[1].toLowerCase() === 'br') nodes.push({ type: 'br' });
        i += tag[0].length;
        continue;
      }
    }
    if (ch === '&') {
      const ent = /^&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,31});/i.exec(s.slice(i));
      if (ent) {
        text += decodeEntities(ent[0]);
        i += ent[0].length;
        continue;
      }
    }
    // Links and images.
    if ((ch === '[' || (ch === '!' && s[i + 1] === '[')) && !(inLink && ch === '[')) {
      const image = ch === '!';
      const open = i + (image ? 2 : 1);
      const close = closeBracket(s, open);
      if (close >= 0) {
        const label = s.slice(open, close);
        let href: string | null = null;
        let end = close + 1;
        const t = linkTarget(s, close + 1);
        if (t) {
          href = t.href;
          end = t.end;
        } else {
          const ref = /^\[([^\]]*)\]/.exec(s.slice(close + 1));
          const key = normLabel(ref && ref[1] ? ref[1] : label);
          const def = defs.get(key);
          if (def) {
            href = def.href;
            if (ref) end = close + 1 + ref[0].length;
          }
        }
        if (href !== null) {
          flush();
          const children = parseInlines(label, defs, !image);
          if (image) nodes.push({ type: 'image', src: href, alt: plainText(children) });
          else nodes.push({ type: 'link', href, children });
          i = end;
          continue;
        }
      }
    }
    // Bare URLs (GitHub's autolink extension).
    if (!inLink && (ch === 'h' || ch === 'w') && (i === 0 || /[\s*_~(]/.test(s[i - 1]))) {
      const url = /^(?:https?:\/\/|www\.)[^\s<]*[^\s<?!.,:*_~'")\]]/i.exec(s.slice(i));
      if (url) {
        let u = url[0];
        // A closing parenthesis belongs to the URL only when balanced.
        while (u.endsWith(')') && (u.match(/\)/g)!.length > (u.match(/\(/g)?.length ?? 0))) u = u.slice(0, -1);
        flush();
        nodes.push({ type: 'link', href: u.startsWith('www.') ? `http://${u}` : u, children: [{ type: 'text', text: u }] });
        i += u.length;
        continue;
      }
    }
    // Emphasis delimiters.
    if (ch === '*' || ch === '_' || ch === '~') {
      const run = new RegExp(`^\\${ch}+`).exec(s.slice(i))![0];
      if (ch === '~' && run.length > 2) {
        text += run;
        i += run.length;
        continue;
      }
      const before = i > 0 ? s[i - 1] : undefined;
      const after = s[i + run.length];
      const left = !isSpace(after) && (!isPunct(after) || isSpace(before) || isPunct(before));
      const right = !isSpace(before) && (!isPunct(before) || isSpace(after) || isPunct(after));
      const open = ch === '_' ? left && (!right || isPunct(before)) : left;
      const close = ch === '_' ? right && (!left || isPunct(after)) : right;
      flush();
      nodes.push({ type: 'delim', char: ch, count: run.length, open, close, orig: run.length });
      i += run.length;
      continue;
    }
    text += ch;
    i++;
  }
  flush();
  return resolveEmphasis(nodes);
}

/** Pair emphasis delimiters (CommonMark's algorithm, simplified) and turn the rest into text. */
function resolveEmphasis(nodes: Node[]): Inline[] {
  const list = [...nodes];
  for (let c = 0; c < list.length; c++) {
    const closer = list[c];
    if (closer.type !== 'delim' || !closer.close) continue;
    let o = c - 1;
    for (; o >= 0; o--) {
      const opener = list[o];
      if (opener.type !== 'delim' || !opener.open || opener.char !== closer.char) continue;
      if (closer.char === '~' && opener.count !== closer.count) continue;
      // The "rule of three".
      if (closer.char !== '~' && (opener.close || closer.open) && (opener.orig + closer.orig) % 3 === 0 && (opener.orig % 3 || closer.orig % 3)) continue;
      break;
    }
    if (o < 0) continue;
    const opener = list[o] as Extract<Node, { type: 'delim' }>;
    const use = closer.char === '~' ? closer.count : opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    const inner = resolveEmphasis(list.slice(o + 1, c).map((n) => (n.type === 'delim' ? { ...n, open: false, close: false } : n)));
    const node: Inline = { type: closer.char === '~' ? 'del' : use === 2 ? 'strong' : 'em', children: inner };
    opener.count -= use;
    closer.count -= use;
    const repl: Node[] = [];
    if (opener.count > 0) repl.push(opener);
    repl.push(node);
    if (closer.count > 0) repl.push(closer);
    list.splice(o, c - o + 1, ...repl);
    // Continue with the closer again if it has delimiters left.
    c = o + repl.length - (closer.count > 0 ? 2 : 1);
  }
  // Leftover delimiters are literal text; merge neighbouring text.
  const out: Inline[] = [];
  for (const n of list) {
    const v: Inline = n.type === 'delim' ? { type: 'text', text: n.char.repeat(n.count) } : n;
    const last = out[out.length - 1];
    if (v.type === 'text' && last?.type === 'text') last.text += v.text;
    else if (v.type !== 'text' || v.text) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------- entry point

function finish(raw: RawBlock[], defs: Defs): Block[] {
  return raw.map((b): Block => {
    switch (b.type) {
      case 'heading': return { type: 'heading', level: b.level, content: parseInlines(b.text, defs) };
      case 'paragraph': return { type: 'paragraph', content: parseInlines(b.text, defs) };
      case 'quote': return { type: 'quote', children: finish(b.children, defs) };
      case 'list': return { ...b, items: b.items.map((it) => ({ checked: it.checked, children: finish(it.children, defs) })) };
      case 'table': return { type: 'table', align: b.align, header: b.header.map((c) => parseInlines(c, defs)), rows: b.rows.map((r) => r.map((c) => parseInlines(c, defs))) };
      default: return b;
    }
  });
}

/** Parse a Markdown document. YAML front matter is skipped. */
export function parseMarkdown(source: string): Block[] {
  let text = source.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  const front = /^---\n[\s\S]*?\n(?:---|\.\.\.)\n/.exec(text);
  if (front) text = text.slice(front[0].length);
  const defs: Defs = new Map();
  const raw: Raw = { blocks: parseBlocks(text.split('\n'), defs) };
  return finish(raw.blocks, defs);
}

/** The text of inline content, without formatting. */
export const inlineText = plainText;

/** GitHub's heading anchors: lower case, punctuation removed, spaces as hyphens. */
export function slug(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}
