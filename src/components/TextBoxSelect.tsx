/**
 * Select Text tool, as in PDF-XChange: drag a rectangle and the text inside
 * it is selected (by character, across lines and columns).
 */
import { memo, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { styleFor, uid, useStore } from '../store/store';
import { can, useCan } from '../store/permissions';
import { viewRectToPdf, type VRect } from '../lib/geometry';
import { mergeLineRects } from './Viewer';
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

/** Characters of a page's text layer whose centres fall inside `box` (view space, scale 1). */
export function textInBox(pageEl: HTMLElement, box: VRect, scale: number): { rects: VRect[]; text: string } {
  const pr = pageEl.getBoundingClientRect();
  const toLocal = (r: DOMRect): VRect => ({ left: (r.left - pr.left) / scale, top: (r.top - pr.top) / scale, width: r.width / scale, height: r.height / scale });
  const inside = (r: VRect) => {
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return cx >= box.left && cx <= box.left + box.width && cy >= box.top && cy <= box.top + box.height;
  };
  const overlaps = (r: VRect) => r.left < box.left + box.width && r.left + r.width > box.left && r.top < box.top + box.height && r.top + r.height > box.top;
  const segs: Seg[] = [];
  const range = document.createRange();
  for (const span of pageEl.querySelectorAll<HTMLElement>('.textLayer span:not(.markedContent)')) {
    const node = span.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE || !overlaps(toLocal(span.getBoundingClientRect()))) continue;
    const s = node.textContent ?? '';
    let cur: Seg | null = null;
    for (let i = 0; i < s.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = toLocal(range.getBoundingClientRect());
      if (r.width <= 0 || r.height <= 0 || !inside(r)) {
        if (cur) segs.push(cur);
        cur = null;
        continue;
      }
      if (cur) {
        const right = Math.max(cur.r.left + cur.r.width, r.left + r.width);
        const left = Math.min(cur.r.left, r.left);
        const top = Math.min(cur.r.top, r.top);
        const bottom = Math.max(cur.r.top + cur.r.height, r.top + r.height);
        cur = { r: { left, top, width: right - left, height: bottom - top }, text: cur.text + s[i] };
      } else cur = { r, text: s[i] };
    }
    if (cur) segs.push(cur);
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
  for (const line of lines) {
    line.sort((a, b) => a.r.left - b.r.left);
    let prev: Seg | null = null;
    for (const sg of line) {
      if (prev && sg.r.left - (prev.r.left + prev.r.width) > sg.r.height * 0.2 && !/\s$/.test(prev.text) && !/^\s/.test(sg.text)) text += ' ';
      text += sg.text;
      prev = sg;
    }
    text = text.replace(/[ \t]+$/, '') + '\n';
  }
  return { rects: mergeLineRects(segs.map((s) => s.r)), text: text.trim() };
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
