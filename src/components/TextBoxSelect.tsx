/**
 * Select Text tool, as in PDF-XChange: drag a rectangle and the text inside
 * it is selected (by character, across lines and columns).
 */
import { memo, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { styleFor, uid, useStore } from '../store/store';
import { can, useCan } from '../store/permissions';
import { viewRectToPdf, type VRect } from '../lib/geometry';
import { tr } from '../lib/i18n';
import { useContextMenu } from './Menu';
import { textSelectionMenu } from './contextMenus';
import type { PageGeom, Pt, TextMarkupKind } from '../lib/types';

export interface TextBoxSelection {
  page: number;
  /** One rect per selected run, in view space at scale 1. */
  rects: VRect[];
  text: string;
}

export const useTextBox = create<{ sel: TextBoxSelection | null }>()(() => ({ sel: null }));

interface Seg {
  r: VRect;
  text: string;
}

/**
 * Words of a page's text layer covered by `box` (view space, scale 1). Whole
 * words are selected, so a rectangle drawn a little too tight (common with OCR
 * text, whose invisible glyphs never match the scan exactly) does not cut words
 * or drop them: a word counts when the box covers half its width (or the box
 * lies within the word) and a good part of its height.
 */
export function textInBox(pageEl: HTMLElement, box: VRect, scale: number): { rects: VRect[]; text: string } {
  const pr = pageEl.getBoundingClientRect();
  const toLocal = (r: DOMRect): VRect => ({ left: (r.left - pr.left) / scale, top: (r.top - pr.top) / scale, width: r.width / scale, height: r.height / scale });
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const covered = (r: VRect) => {
    const hx = overlap(r.left, r.left + r.width, box.left, box.left + box.width);
    const vy = overlap(r.top, r.top + r.height, box.top, box.top + box.height);
    const horiz = hx >= r.width * 0.5 || (box.width > 0 && hx >= box.width * 0.9);
    const vert = vy >= r.height * 0.35 || (box.height > 0 && vy >= box.height * 0.9);
    return horiz && vert && hx > 0 && vy > 0;
  };
  const near = (r: VRect) => r.left < box.left + box.width + r.height && r.left + r.width > box.left - r.height && r.top < box.top + box.height && r.top + r.height > box.top;
  const union = (a: VRect, b: VRect): VRect => {
    const left = Math.min(a.left, b.left);
    const top = Math.min(a.top, b.top);
    return { left, top, width: Math.max(a.left + a.width, b.left + b.width) - left, height: Math.max(a.top + a.height, b.top + b.height) - top };
  };
  const segs: Seg[] = [];
  const range = document.createRange();
  for (const span of pageEl.querySelectorAll<HTMLElement>('.textLayer span:not(.markedContent)')) {
    const node = span.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE || !near(toLocal(span.getBoundingClientRect()))) continue;
    const s = node.textContent ?? '';
    // Split the span into words; each word's box is the union of its characters.
    let word: Seg | null = null;
    const flush = () => {
      if (word && covered(word.r)) segs.push(word);
      word = null;
    };
    for (let i = 0; i <= s.length; i++) {
      if (i === s.length || /\s/.test(s[i])) {
        flush();
        continue;
      }
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = toLocal(range.getBoundingClientRect());
      if (r.width <= 0 || r.height <= 0) continue;
      word = word ? { r: union(word.r, r), text: word.text + s[i] } : { r, text: s[i] };
    }
  }
  // Reading order: lines from top to bottom, left to right within a line.
  segs.sort((a, b) => a.r.top + a.r.height / 2 - (b.r.top + b.r.height / 2));
  const lines: Seg[][] = [];
  for (const sg of segs) {
    const line = lines[lines.length - 1];
    const cy = sg.r.top + sg.r.height / 2;
    const ref = line?.[0];
    if (ref && Math.abs(ref.r.top + ref.r.height / 2 - cy) < Math.min(ref.r.height, sg.r.height) * 0.5) line.push(sg);
    else lines.push([sg]);
  }
  let text = '';
  const rects: VRect[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.r.left - b.r.left);
    let prev: Seg | null = null;
    for (const sg of line) {
      const gap = prev ? sg.r.left - (prev.r.left + prev.r.width) : 0;
      // Pieces of one word split across spans join without a space.
      if (prev && gap > sg.r.height * 0.15) text += ' ';
      text += sg.text;
      // One highlight rect per run of words, covering the spaces between them.
      const last = rects[rects.length - 1];
      if (prev && last && gap < sg.r.height * 1.2) rects[rects.length - 1] = union(last, sg.r);
      else rects.push({ ...sg.r });
      prev = sg;
    }
    text += '\n';
  }
  return { rects, text: text.trim() };
}

/** Select all text on a page. */
export function selectAllText(page: number) {
  const pageEl = document.querySelector<HTMLElement>(`.page[data-index="${page}"]`);
  if (!pageEl) return;
  const s = useStore.getState();
  const { rects, text } = textInBox(pageEl, { left: -1e4, top: -1e4, width: 2e4, height: 2e4 }, s.scale);
  useTextBox.setState({ sel: rects.length ? { page, rects, text } : null });
}

export async function copyBoxText() {
  const sel = useTextBox.getState().sel;
  if (!sel) return;
  if (!can('copy')) return useStore.getState().notify(tr('Copying is not allowed by this document’s security settings.'), 'error');
  try {
    await navigator.clipboard.writeText(sel.text);
    useStore.getState().notify(tr('Text copied to the clipboard.'));
  } catch {
    useStore.getState().notify(tr('The browser blocked clipboard access.'), 'error');
  }
}

/** Turn the selection into a highlight, underline or strikeout comment. */
export function markupBox(kind: TextMarkupKind) {
  const sel = useTextBox.getState().sel;
  if (!sel || !can('annotate')) return;
  const s = useStore.getState();
  const g = s.geoms[sel.page];
  const st = styleFor(kind);
  s.addAnnotation(sel.page, {
    id: uid('annot'), type: kind, color: st.color, opacity: st.opacity, author: s.author, createdAt: Date.now(),
    rects: sel.rects.map((v) => viewRectToPdf(g, v)), rot: g.rotation, text: sel.text,
  });
  useTextBox.setState({ sel: null });
}

export const TextBoxLayer = memo(function TextBoxLayer({ index, geom, scale: S }: { index: number; geom: PageGeom; scale: number }) {
  const sel = useTextBox((x) => (x.sel?.page === index ? x.sel : null));
  const [drag, setDrag] = useState<{ start: Pt; end: Pt } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const canCopy = useCan('copy');
  const menu = useContextMenu();

  const pt = (e: { clientX: number; clientY: number }): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / S, y: (e.clientY - r.top) / S };
  };
  const boxOf = (d: { start: Pt; end: Pt }): VRect => ({ left: Math.min(d.start.x, d.end.x), top: Math.min(d.start.y, d.end.y), width: Math.abs(d.end.x - d.start.x), height: Math.abs(d.end.y - d.start.y) });
  const update = (d: { start: Pt; end: Pt }) => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const pageEl = ref.current?.parentElement;
      if (!pageEl) return;
      const { rects, text } = textInBox(pageEl, boxOf(d), S);
      useTextBox.setState({ sel: rects.length ? { page: index, rects, text } : null });
    });
  };

  // The selection belongs to one zoom level and document version.
  const docVersion = useStore((s) => s.docVersion);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    if (useTextBox.getState().sel?.page === index) useTextBox.setState({ sel: null });
  }, [docVersion, geom, index]);

  return (
    <div
      ref={ref}
      className="textbox-layer"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        ref.current!.setPointerCapture(e.pointerId);
        window.getSelection()?.removeAllRanges();
        const p = pt(e);
        setDrag({ start: p, end: p });
        useTextBox.setState({ sel: null });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const d = { ...drag, end: pt(e) };
        setDrag(d);
        update(d);
      }}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onDoubleClick={() => selectAllText(index)}
      onContextMenu={(e) => {
        e.stopPropagation();
        menu.open(e, textSelectionMenu(index, geom, pt(e)));
      }}
    >
      <svg width="100%" height="100%">
        {sel?.rects.map((r, i) => <rect key={i} className="textbox-hit" x={r.left * S} y={r.top * S} width={r.width * S} height={r.height * S} />)}
        {drag && (() => {
          const b = boxOf(drag);
          return <rect className="textbox-marquee" x={b.left * S} y={b.top * S} width={b.width * S} height={b.height * S} />;
        })()}
      </svg>
      {sel && !drag && !canCopy && <span className="textbox-note">{tr('Copying is not allowed by this document’s security settings.')}</span>}
      {menu.element}
    </div>
  );
});
