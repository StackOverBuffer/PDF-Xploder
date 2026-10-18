import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { styleFor, uid, useStore } from '../store/store';
import { can } from '../store/permissions';
import { pdfToView, viewRectToPdf, viewSize, type VRect } from '../lib/geometry';
import { PageView } from './PageView';
import { openDropped } from '../store/commands';
import type { PageGeom, TextMarkupKind } from '../lib/types';

const GAP = 16;
const PAD = 24;
const MARKUP: TextMarkupKind[] = ['highlight', 'underline', 'strikeout'];

/** Merge the client rects of a text selection into one rect per line run. */
export function mergeLineRects(rects: VRect[]): VRect[] {
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
  const out: VRect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    const sameLine = last && Math.abs(last.top - r.top) < Math.max(2, r.height * 0.3) && Math.abs(last.height - r.height) < r.height * 0.5;
    if (sameLine && r.left <= last.left + last.width + 2) {
      const right = Math.max(last.left + last.width, r.left + r.width);
      const top = Math.min(last.top, r.top);
      const bottom = Math.max(last.top + last.height, r.top + r.height);
      Object.assign(last, { top, width: right - last.left, height: bottom - top });
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/** Client rects of the selected text only (ignoring the boxes of helper elements). */
function selectionTextRects(range: Range): DOMRect[] {
  const root = range.commonAncestorContainer;
  const walker = document.createTreeWalker(root.nodeType === Node.TEXT_NODE ? root.parentNode! : root, NodeFilter.SHOW_TEXT);
  const out: DOMRect[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n) || !(n.parentElement?.closest('.textLayer'))) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    if (n === range.startContainer) r.setStart(n, range.startOffset);
    if (n === range.endContainer) r.setEnd(n, range.endOffset);
    out.push(...Array.from(r.getClientRects()).filter((x) => x.width > 0.5 && x.height > 0.5));
  }
  return out;
}

/** Pages kept mounted beyond the rendered ones (scrolling back a little needs no re-render). */
const BUFFER = 3;

interface Layout {
  scale: number;
  tops: number[];
  heights: number[];
  widths: number[];
  total: number;
  maxWidth: number;
}

/** Page offsets from geometry, so the DOM never has to be measured. */
function computeLayout(geoms: PageGeom[], scale: number): Layout {
  const tops: number[] = [];
  const heights: number[] = [];
  const widths: number[] = [];
  let y = PAD;
  let maxWidth = 0;
  for (const g of geoms) {
    const { width, height } = viewSize(g);
    const h = Math.floor(height * scale);
    const w = Math.floor(width * scale);
    tops.push(y);
    heights.push(h);
    widths.push(w);
    if (w > maxWidth) maxWidth = w;
    y += h + GAP;
  }
  return { scale, tops, heights, widths, total: y + PAD - GAP, maxWidth };
}

/** Index of the last page whose top is at or above `y` (binary search). */
function pageAtY(L: Layout, y: number): number {
  let lo = 0;
  let hi = L.tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (L.tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

interface PageRange {
  /** Rendered pages (near the viewport). */
  r0: number;
  r1: number;
  /** Mounted pages (rendered plus a buffer). */
  m0: number;
  m1: number;
}

function pageSlots(r: PageRange, L: Layout): number[] {
  const out: number[] = [];
  for (let i = r.m0; i <= Math.min(r.m1, L.tops.length - 1); i++) out.push(i);
  return out;
}

export function Viewer() {
  const geoms = useStore((s) => s.geoms);
  const docSession = useStore((s) => s.docSession);
  const scale = useStore((s) => s.scale);
  const tool = useStore((s) => s.tool);
  const scrollRequest = useStore((s) => s.scrollRequest);
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<PageRange>({ r0: 0, r1: 1, m0: 0, m1: 1 + BUFFER });
  const [dragOver, setDragOver] = useState(false);

  const layout = useMemo(() => computeLayout(geoms, scale), [geoms, scale]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const updateVisible = useCallback(() => {
    const el = ref.current;
    const L = layoutRef.current;
    if (!el || !L.tops.length) return;
    const n = L.tops.length;
    const top = el.scrollTop - el.clientHeight;
    const bottom = el.scrollTop + el.clientHeight * 2;
    let r0 = pageAtY(L, top);
    if (L.tops[r0] + L.heights[r0] < top) r0 = Math.min(n - 1, r0 + 1);
    const r1 = pageAtY(L, bottom);
    const next = { r0, r1, m0: Math.max(0, r0 - BUFFER), m1: Math.min(n - 1, r1 + BUFFER) };
    setRange((prev) => (prev.r0 === next.r0 && prev.r1 === next.r1 && prev.m0 === next.m0 && prev.m1 === next.m1 ? prev : next));
    const current = pageAtY(L, el.scrollTop + el.clientHeight / 3);
    if (useStore.getState().currentPage !== current) useStore.getState().setCurrentPage(current);
  }, []);

  // Scroll events can come faster than frames: handle at most one per frame.
  const frame = useRef(0);
  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      updateVisible();
    });
  }, [updateVisible]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Fit-to-width / fit-to-page.
  const applyFit = useCallback(() => {
    const el = ref.current;
    const { fit, geoms, currentPage, setScale } = useStore.getState();
    if (!el || !fit || !geoms.length) return;
    const g = geoms[currentPage] ?? geoms[0];
    const { width, height } = viewSize(g);
    const maxW = layoutRef.current.scale ? layoutRef.current.maxWidth / layoutRef.current.scale : Math.max(...geoms.map((x) => viewSize(x).width));
    const availW = el.clientWidth - PAD * 2;
    const availH = el.clientHeight - PAD * 2;
    const s = fit === 'width' ? availW / maxW : Math.min(availW / width, availH / height);
    setScale(Math.max(0.1, s), fit);
  }, []);

  const fit = useStore((s) => s.fit);
  useLayoutEffect(() => {
    applyFit();
  }, [fit, geoms, applyFit]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      applyFit();
      updateVisible();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [applyFit, updateVisible]);

  // Coming back to a tab: restore where it was scrolled to.
  useLayoutEffect(() => {
    const r = useStore.getState().restoreScroll;
    const el = ref.current;
    if (!r || !el) return;
    useStore.setState({ restoreScroll: null });
    requestAnimationFrame(() => {
      el.scrollTop = r.top;
      el.scrollLeft = r.left;
      updateVisible();
    });
  }, [docSession, updateVisible]);

  // Keep the same spot of the same page under the anchor (the pointer for Ctrl+wheel, else the centre) when zooming.
  const zoomAnchor = useRef<{ x: number; y: number } | null>(null);
  const prevLayout = useRef(layout);
  useLayoutEffect(() => {
    const el = ref.current;
    const prev = prevLayout.current;
    prevLayout.current = layout;
    const anchor = zoomAnchor.current;
    zoomAnchor.current = null;
    // At the very top (e.g. right after opening) stay there unless zooming at the pointer.
    if (el && prev !== layout && prev.scale !== layout.scale && prev.tops.length === layout.tops.length && (el.scrollTop > 0 || anchor)) {
      const ay = anchor?.y ?? el.clientHeight / 2;
      const ax = anchor?.x ?? el.clientWidth / 2;
      const docY = el.scrollTop + ay;
      const i = pageAtY(prev, docY);
      const frac = (docY - prev.tops[i]) / Math.max(1, prev.heights[i]);
      el.scrollTop = layout.tops[i] + frac * layout.heights[i] - ay;
      // Horizontally the pages are centred in a box at least as wide as the viewer.
      const boxW = (L: Layout) => Math.max(el.clientWidth, L.maxWidth + PAD * 2);
      const docX = el.scrollLeft + ax - boxW(prev) / 2;
      el.scrollLeft = docX * (layout.scale / prev.scale) + boxW(layout) / 2 - ax;
    }
    updateVisible();
  }, [layout, updateVisible]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !scrollRequest) return;
    const { page, y: uy } = scrollRequest;
    const L = layoutRef.current;
    let target = L.tops[page] ?? 0;
    const g = useStore.getState().geoms[page];
    if (uy !== undefined && g) {
      const v = pdfToView(g, { x: g.view[0], y: uy });
      target += v.y * L.scale - el.clientHeight / 3;
    } else {
      target -= GAP / 2;
    }
    el.scrollTo({ top: Math.max(0, target) });
  }, [scrollRequest]);

  // Ctrl + wheel zooms, proportionally to the wheel (smooth on touchpads), at most once per frame.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let factor = 1;
    let raf = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      factor *= Math.exp(-Math.max(-100, Math.min(100, dy)) * 0.0012);
      const r = el.getBoundingClientRect();
      zoomAnchor.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const s = useStore.getState();
        const f = factor;
        factor = 1;
        s.setScale(s.scale * f);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Text markup: turn the current text selection into highlight/underline/strikeout annotations.
  const onMouseUp = () => {
    const s = useStore.getState();
    if (!MARKUP.includes(s.tool as TextMarkupKind) || !can('annotate')) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const rects = selectionTextRects(sel.getRangeAt(0));
    const text = sel.toString().trim();
    const kind = s.tool as TextMarkupKind;
    const st = styleFor(kind);
    ref.current?.querySelectorAll<HTMLElement>('.page').forEach((pageEl) => {
      const index = Number(pageEl.dataset.index);
      const pr = pageEl.getBoundingClientRect();
      const local = rects
        .filter((r) => r.left < pr.right && r.right > pr.left && r.top < pr.bottom && r.bottom > pr.top)
        .map((r) => ({ left: (r.left - pr.left) / s.scale, top: (r.top - pr.top) / s.scale, width: r.width / s.scale, height: r.height / s.scale }));
      if (!local.length) return;
      const g = s.geoms[index];
      s.addAnnotation(index, {
        id: uid('annot'),
        type: kind,
        color: st.color,
        opacity: st.opacity,
        author: s.author,
        createdAt: Date.now(),
        rects: mergeLineRects(local).map((v) => viewRectToPdf(g, v)),
        rot: g.rotation,
        text,
      });
    });
    sel.removeAllRanges();
  };

  // Hand tool: drag to pan.
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (tool !== 'hand' && e.button !== 1) return;
    const el = ref.current!;
    pan.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pan.current) return;
    const el = ref.current!;
    el.scrollLeft = pan.current.left - (e.clientX - pan.current.x);
    el.scrollTop = pan.current.top - (e.clientY - pan.current.y);
  };
  const endPan = () => (pan.current = null);

  return (
    <div
      ref={ref}
      className={`viewer tool-${tool} ${dragOver ? 'drag-over' : ''}`}
      onScroll={onScroll}
      onMouseUp={onMouseUp}
      onCopy={(e) => {
        if (can('copy')) return;
        e.preventDefault();
        useStore.getState().notify('Copying is not allowed by this document’s security settings.', 'error');
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        openDropped(e.dataTransfer);
      }}
    >
      {/* A different document gets fresh page views, so nothing of the previous one can linger. */}
      {/* Only pages near the viewport are mounted; the rest is empty space of the right height. */}
      <div className="pages" key={docSession} style={{ height: layout.total, minWidth: layout.maxWidth + PAD * 2 }}>
        {pageSlots(range, layout).map((i) => (
          <div key={i} className="page-slot" style={{ top: layout.tops[i], width: layout.widths[i] }}>
            <PageView index={i} visible={i >= range.r0 && i <= range.r1} />
          </div>
        ))}
      </div>
    </div>
  );
}
