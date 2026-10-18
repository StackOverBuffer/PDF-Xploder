/**
 * Find and replace in the page content itself (text objects are lines of text).
 * Matches come with exact glyph boxes, so redaction marks cover the words and
 * nothing else; replacing rewrites the line in its own font where possible.
 */
import type { PDFPage } from '@cantoo/pdf-lib';
import { mul, apply, type M } from './matrix';
import { isStr, type Operand } from './syntax';
import { readPage, editPage, type PageContent, type ContentEdit } from './page';
import type { ContentObject, TextRun } from './objects';
import type { FontInfo } from './fonts';
import type { Rect } from '../types';

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

export interface TextMatch {
  /** Index of the text object (line) on the page. */
  object: number;
  /** Character range in the line's text. */
  start: number;
  end: number;
  /** One box per text run the match touches, in user space. */
  rects: Rect[];
}

/** Characters of a run with their start/end in text space, consistent with measureShow's text. */
function runChars(r: TextRun, font: FontInfo | undefined): { x0: number; x1: number }[] {
  const th = r.Tz / 100;
  const out: { x0: number; x1: number }[] = [];
  let adv = 0;
  let text = '';
  const glyphs = (s: Operand) => {
    if (!isStr(s)) return;
    const codes = font ? font.codes(s.bytes) : Array.from(s.bytes, (code) => ({ code, len: 1 }));
    for (const { code, len } of codes) {
      const w0 = font ? font.width(code) : 0.5;
      const start = adv;
      adv += (w0 * r.size + r.Tc + (len === 1 && code === 32 ? r.Tw : 0)) * th;
      const u = font ? font.unicode(code) : String.fromCharCode(code);
      // A ligature's characters share the glyph's width.
      const n = Math.max(1, u.length);
      for (let k = 0; k < u.length; k++) out.push({ x0: start + ((adv - start) * k) / n, x1: start + ((adv - start) * (k + 1)) / n });
      text += u;
    }
  };
  if (r.show.op === 'TJ') {
    for (const item of (r.show.args[0] as Operand[]) ?? []) {
      if (typeof item === 'number') {
        adv -= (item / 1000) * r.size * th;
        if (item < -180 && text && !text.endsWith(' ')) {
          text += ' ';
          out.push({ x0: adv, x1: adv });
        }
      } else glyphs(item);
    }
  } else glyphs(r.show.args[0]);
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function matcher(query: string, o: FindOptions): RegExp | null {
  if (!query) return null;
  const body = escape(query);
  return new RegExp(o.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body, `gu${o.matchCase ? '' : 'i'}`);
}

function lineText(o: ContentObject) {
  return o.runs.map((r) => r.text).join('');
}

function boxOf(m: M, x0: number, y0: number, x1: number, y1: number): Rect {
  const pts = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x1, y1), apply(m, x0, y1)];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** All matches on a page that has been read with readPage. */
export function findInContent(pc: PageContent, query: string, o: FindOptions): TextMatch[] {
  const re = matcher(query, o);
  if (!re) return [];
  const out: TextMatch[] = [];
  pc.objects.forEach((obj, id) => {
    if (obj.kind !== 'text' || !obj.runs.length) return;
    const text = lineText(obj);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    // Character positions per run, computed when the line has a match.
    let layout: { run: TextRun; start: number; chars: { x0: number; x1: number }[] }[] | null = null;
    while ((m = re.exec(text))) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      if (!layout) {
        let at = 0;
        layout = obj.runs.map((run) => {
          const chars = runChars(run, pc.fonts.get(run.font));
          const entry = { run, start: at, chars };
          at += run.text.length;
          return entry;
        });
      }
      const start = m.index;
      const end = start + m[0].length;
      const rects: Rect[] = [];
      for (const { run, start: rs, chars } of layout) {
        const a = Math.max(start, rs) - rs;
        const b = Math.min(end, rs + run.text.length) - rs;
        if (a >= b || !chars.length) continue;
        const font = pc.fonts.get(run.font);
        const x0 = chars[Math.min(a, chars.length - 1)].x0;
        const x1 = chars[Math.min(b - 1, chars.length - 1)].x1;
        const mt = mul(mul(run.tm, obj.state.ctm), obj.user);
        rects.push(boxOf(mt, x0, run.Ts + (font?.descent ?? -0.25) * run.size, x1, run.Ts + (font?.ascent ?? 0.75) * run.size));
      }
      if (rects.length) out.push({ object: id, start, end, rects });
    }
  });
  return out;
}

/** Matches on one page (reads its content). */
export function findOnPage(page: PDFPage, query: string, o: FindOptions): TextMatch[] {
  return findInContent(readPage(page), query, o);
}

/**
 * Replace matches on a page; `only` limits it to one match (by object and start).
 * Returns how many were replaced.
 */
export async function replaceOnPage(page: PDFPage, query: string, replacement: string, o: FindOptions, only?: { object: number; start: number }): Promise<number> {
  const pc = readPage(page);
  const matches = findInContent(pc, query, o).filter((m) => !only || (m.object === only.object && m.start === only.start));
  if (!matches.length) return 0;
  const edits: ContentEdit[] = [];
  const emptied: number[] = [];
  const byObject = new Map<number, TextMatch[]>();
  for (const m of matches) byObject.set(m.object, [...(byObject.get(m.object) ?? []), m]);
  for (const [id, list] of byObject) {
    let text = lineText(pc.objects[id]);
    // From the end, so earlier positions stay valid.
    for (const m of [...list].sort((a, b) => b.start - a.start)) text = text.slice(0, m.start) + replacement + text.slice(m.end);
    // A line replaced by nothing goes away entirely.
    if (text.trim()) edits.push({ type: 'text', id, text });
    else emptied.push(id);
  }
  if (emptied.length) edits.push({ type: 'delete', ids: emptied });
  await editPage(page, edits);
  return matches.length;
}
