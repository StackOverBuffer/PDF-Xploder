/**
 * The words of a page's text runs, with their boxes, for spell checking. Runs on one
 * line that touch are joined (pdf.js splits words where the font or spacing changes),
 * and words hyphenated at the end of a line are checked whole.
 */
import type { Rect } from '../types';
import { words } from './checker';

export interface Run {
  str: string;
  rect: Rect;
}

export interface PageWord {
  word: string;
  /** The character after the word ("." makes an abbreviation). */
  next: string;
  rect: Rect;
  context: string;
  /** Hyphenated across two lines: it cannot be replaced in the page text. */
  split?: boolean;
}

/** Width of a part of a run's text, as a share of the run (a stand-in for the font's widths). */
export type Measure = (text: string) => number;

interface Line {
  str: string;
  pieces: { run: Run; from: number }[];
}

function lines(runs: Run[]): Line[] {
  const out: Line[] = [];
  for (const run of runs) {
    const line = out[out.length - 1];
    const prev = line?.pieces[line.pieces.length - 1].run;
    const h = prev ? Math.max(prev.rect.h, 1) : 0;
    const gap = prev ? run.rect.x - (prev.rect.x + prev.rect.w) : 0;
    const sameLine = prev && Math.abs(run.rect.y - prev.rect.y) < h * 0.3 && gap > -h * 0.3 && gap < h * 0.08;
    if (line && sameLine) {
      line.pieces.push({ run, from: line.str.length });
      line.str += run.str;
    } else {
      out.push({ str: run.str, pieces: [{ run, from: 0 }] });
    }
  }
  return out;
}

/** The box of characters [at, at + len) of a line. */
function boxOf(line: Line, at: number, len: number, measure: Measure): Rect {
  const rects: Rect[] = [];
  for (const { run, from } of line.pieces) {
    const a = Math.max(at, from) - from;
    const b = Math.min(at + len, from + run.str.length) - from;
    if (b <= a) continue;
    const total = measure(run.str);
    const share = (s: string) => (total ? measure(s) / total : s.length / Math.max(1, run.str.length));
    const x0 = share(run.str.slice(0, a)) * run.rect.w;
    const w = share(run.str.slice(a, b)) * run.rect.w;
    rects.push({ x: run.rect.x + x0, y: run.rect.y, w: Math.max(2, w), h: run.rect.h });
  }
  if (!rects.length) return line.pieces[0].run.rect;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

const context = (s: string, at: number, len: number) => s.slice(Math.max(0, at - 30), at + len + 30).trim();

export function pageWords(runs: Run[], measure: Measure): PageWord[] {
  const out: PageWord[] = [];
  const ls = lines(runs);
  let carry: { word: string; rect: Rect; context: string } | null = null;
  ls.forEach((line, li) => {
    const ws = words(line.str);
    ws.forEach((t, i) => {
      const end = t.start + t.word.length;
      // The second half of a word hyphenated at the end of the previous line.
      if (i === 0 && carry && !line.str.slice(0, t.start).trim() && /^\p{Ll}/u.test(t.word)) {
        out.push({ word: carry.word + t.word, next: line.str[end] ?? '', rect: carry.rect, context: carry.context, split: true });
        carry = null;
        return;
      }
      const last = i === ws.length - 1 && li < ls.length - 1;
      if (last && /^-\s*$/.test(line.str.slice(end)) && /^\s*\p{Ll}/u.test(ls[li + 1].str)) {
        carry = { word: t.word, rect: boxOf(line, t.start, t.word.length, measure), context: context(line.str, t.start, t.word.length) };
        return;
      }
      out.push({ word: t.word, next: line.str[end] ?? '', rect: boxOf(line, t.start, t.word.length, measure), context: context(line.str, t.start, t.word.length) });
    });
    if (carry && !ws.length) carry = null;
  });
  return out;
}
