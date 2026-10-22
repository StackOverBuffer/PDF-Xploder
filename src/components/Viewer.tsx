import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { styleFor, uid, useStore } from '../store/store';
import { can } from '../store/permissions';
import { pdfToView, viewRectToPdf, type VRect } from '../lib/geometry';
import { PageView } from './PageView';
import { ViewScale } from './viewScale';
import { openDropped } from '../store/commands';
import { usePrefs } from '../lib/prefs';
import { activatePane, setOtherView, usePanes, type Pane } from '../store/panes';
import { computeLayout, GAP, isContinuous, PAD, rowAtY, rowOfPage, stepPage, type Layout } from '../lib/viewLayout';
import type { TextMarkupKind } from '../lib/types';

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

/** Rows kept mounted beyond the rendered ones (scrolling back a little needs no re-render). */
const BUFFER = 3;

interface RowRange {
  /** Rendered rows (near the viewport). */
  r0: number;
  r1: number;
  /** Mounted rows (rendered plus a buffer). */
  m0: number;
  m1: number;
}

/** The mounted pages, and whether each is rendered. */
function pageSlots(r: RowRange, L: Layout): { page: number; visible: boolean }[] {
  const out: { page: number; visible: boolean }[] = [];
  for (let k = r.m0; k <= Math.min(r.m1, L.rows.length - 1); k++) for (const page of L.rows[k].pages) out.push({ page, visible: k >= r.r0 && k <= r.r1 });
  return out;
}

/** Turning the page with the wheel (single page and facing layouts) waits this long after the last turn. */
const FLIP_PAUSE = 400;

export function Viewer({ pane = 0 }: { pane?: Pane }) {
  const geoms = useStore((s) => s.geoms);
  const docSession = useStore((s) => s.docSession);
  const tool = useStore((s) => s.tool);
  const scrollRequest = useStore((s) => s.scrollRequest);
  const split = usePanes((p) => p.split);
  // The active pane uses the store's view (every command acts on it); the other one its own.
  const active = usePanes((p) => p.split === 'none' || p.active === pane);
  const scale = useStore((s) => s.scale);
  const otherScale = usePanes((p) => p.other.scale);
  const viewScale = active ? scale : otherScale;
  const storePage = useStore((s) => s.currentPage);
  const otherPage = usePanes((p) => p.other.currentPage);
  const current = active ? storePage : otherPage;
  const mode = usePrefs((p) => p.pageLayout);
  const cover = usePrefs((p) => p.coverPage);
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<RowRange>({ r0: 0, r1: 1, m0: 0, m1: 1 + BUFFER });
  const [dragOver, setDragOver] = useState(false);

  // Single page and facing pages show one row: the current page's.
  const row = isContinuous(mode) ? 0 : rowOfPage(current, mode, cover);
  const layout = useMemo(() => computeLayout(geoms, viewScale, mode, cover, row), [geoms, viewScale, mode, cover, row]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const activeRef = useRef(active);
  activeRef.current = active;

  /** This pane's view: the store's when active, else its own (see panes.ts). */
  const view = useCallback(() => {
    const s = useStore.getState();
    return activeRef.current ? { scale: s.scale, fit: s.fit, currentPage: s.currentPage } : usePanes.getState().other;
  }, []);
  const setView = useCallback((patch: { scale?: number; fit?: 'width' | 'page' | null; currentPage?: number }) => {
    if (activeRef.current) {
      const s = useStore.getState();
      if (patch.scale !== undefined) s.setScale(patch.scale, patch.fit ?? null);
      if (patch.currentPage !== undefined && s.currentPage !== patch.currentPage) s.setCurrentPage(patch.currentPage);
    } else {
      setOtherView({ ...patch, ...(patch.scale !== undefined ? { scale: Math.min(8, Math.max(0.1, patch.scale)), fit: patch.fit ?? null } : {}) });
    }
  }, []);

  const updateVisible = useCallback(() => {
    const el = ref.current;
    const L = layoutRef.current;
    if (!el || !L.rows.length) return;
    const n = L.rows.length;
    const top = el.scrollTop - el.clientHeight;
    const bottom = el.scrollTop + el.clientHeight * 2;
    let r0 = rowAtY(L, top);
    if (L.rows[r0].top + L.rows[r0].height < top) r0 = Math.min(n - 1, r0 + 1);
    const r1 = rowAtY(L, bottom);
    const next = { r0, r1, m0: Math.max(0, r0 - BUFFER), m1: Math.min(n - 1, r1 + BUFFER) };
    setRange((prev) => (prev.r0 === next.r0 && prev.r1 === next.r1 && prev.m0 === next.m0 && prev.m1 === next.m1 ? prev : next));
    // The current page: the first of the row a third down the view, unless it is in that row already.
    const pages = L.rows[rowAtY(L, el.scrollTop + el.clientHeight / 3)].pages;
    if (!pages.includes(view().currentPage)) setView({ currentPage: pages[0] });
  }, [view, setView]);

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

  // Fit-to-width / fit-to-page: the widest row, or the current one (both pages when facing).
  const applyFit = useCallback(() => {
    const el = ref.current;
    const { fit, currentPage } = view();
    const { geoms } = useStore.getState();
    const { pageLayout, coverPage } = usePrefs.getState();
    if (!el || !fit || !geoms.length) return;
    const L1 = computeLayout(geoms, 1, pageLayout, coverPage, rowOfPage(currentPage, pageLayout, coverPage));
    const k = L1.rows.findIndex((r) => r.pages.includes(currentPage));
    const r = L1.rows[Math.max(0, k)];
    const rowWidth = 2 * Math.max(...r.pages.map((p) => Math.max(-L1.lefts[p], L1.lefts[p] + L1.widths[p])));
    const availW = el.clientWidth - PAD * 2;
    const availH = el.clientHeight - PAD * 2;
    const s = fit === 'width' ? availW / L1.maxWidth : Math.min(availW / rowWidth, availH / r.height);
    setView({ scale: Math.max(0.1, s), fit });
  }, [view, setView]);

  const fit = useStore((s) => s.fit);
  const otherFit = usePanes((p) => p.other.fit);
  // Also on turning to another row: fit page fits each spread (pages may differ in size).
  useLayoutEffect(() => {
    applyFit();
  }, [active ? fit : otherFit, geoms, mode, cover, row, applyFit]);

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
    if (!r || !el || !activeRef.current) return;
    useStore.setState({ restoreScroll: null });
    requestAnimationFrame(() => {
      el.scrollTop = r.top;
      el.scrollLeft = r.left;
      updateVisible();
    });
  }, [docSession, updateVisible]);

  // Another document in the other pane (a tab switch): it starts where the active one is.
  const shownSession = useRef(docSession);
  useEffect(() => {
    if (shownSession.current === docSession) return;
    shownSession.current = docSession;
    if (!activeRef.current) {
      const s = useStore.getState();
      setOtherView({ scale: s.scale, fit: s.fit, currentPage: 0 });
      ref.current?.scrollTo({ top: 0 });
    }
  }, [docSession]);

  // Keep the same spot of the same page under the anchor (the pointer for Ctrl+wheel, else the centre) when zooming.
  const zoomAnchor = useRef<{ x: number; y: number } | null>(null);
  /** After turning to another row with the wheel: show its top, or its bottom when going back. */
  const flipTo = useRef<'top' | 'bottom' | null>(null);
  const prevLayout = useRef(layout);
  useLayoutEffect(() => {
    const el = ref.current;
    const prev = prevLayout.current;
    prevLayout.current = layout;
    const anchor = zoomAnchor.current;
    zoomAnchor.current = null;
    const flip = flipTo.current;
    flipTo.current = null;
    if (el && flip) el.scrollTop = flip === 'top' ? 0 : el.scrollHeight;
    // At the very top (e.g. right after opening) stay there unless zooming at the pointer.
    else if (el && prev !== layout && prev.scale !== layout.scale && prev.mode === layout.mode && prev.rows.length === layout.rows.length && (el.scrollTop > 0 || anchor)) {
      const ay = anchor?.y ?? el.clientHeight / 2;
      const ax = anchor?.x ?? el.clientWidth / 2;
      const docY = el.scrollTop + ay;
      const i = rowAtY(prev, docY);
      const frac = (docY - prev.rows[i].top) / Math.max(1, prev.rows[i].height);
      el.scrollTop = layout.rows[i].top + frac * layout.rows[i].height - ay;
      // Horizontally the pages are centred in a box at least as wide as the viewer.
      const boxW = (L: Layout) => Math.max(el.clientWidth, L.maxWidth + PAD * 2);
      const docX = el.scrollLeft + ax - boxW(prev) / 2;
      el.scrollLeft = docX * (layout.scale / prev.scale) + boxW(layout) / 2 - ax;
    }
    updateVisible();
  }, [layout, updateVisible]);

  // Another layout: the current page stays in view.
  const shownMode = useRef(`${mode}:${cover}`);
  useEffect(() => {
    if (shownMode.current === `${mode}:${cover}`) return;
    shownMode.current = `${mode}:${cover}`;
    const el = ref.current;
    const t = layoutRef.current.tops[view().currentPage];
    if (el && t !== undefined) el.scrollTop = Math.max(0, t - GAP / 2);
  }, [mode, cover, view]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !scrollRequest || !activeRef.current) return;
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
  // Without Ctrl in the single page and facing layouts, the wheel turns to the next row at the end of one.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let factor = 1;
    let raf = 0;
    let lastFlip = 0;
    const onWheel = (e: WheelEvent) => {
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (!e.ctrlKey && !e.metaKey) {
        const { pageLayout, coverPage } = usePrefs.getState();
        if (isContinuous(pageLayout) || !dy) return;
        const atEnd = dy > 0 ? el.scrollTop + el.clientHeight >= el.scrollHeight - 2 : el.scrollTop <= 1;
        if (!atEnd) return;
        e.preventDefault();
        if (performance.now() - lastFlip < FLIP_PAUSE) return;
        lastFlip = performance.now();
        const cur = view().currentPage;
        const next = stepPage(cur, dy > 0 ? 1 : -1, useStore.getState().pageIds.length, pageLayout, coverPage);
        if (next === cur) return;
        activatePane(pane);
        flipTo.current = dy > 0 ? 'top' : 'bottom';
        setView({ currentPage: next });
        return;
      }
      e.preventDefault();
      // Zooming a pane makes it the active one.
      activatePane(pane);
      factor *= Math.exp(-Math.max(-100, Math.min(100, dy)) * 0.0012);
      const r = el.getBoundingClientRect();
      zoomAnchor.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const f = factor;
        factor = 1;
        setView({ scale: view().scale * f });
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(raf);
    };
  }, [pane, view, setView]);

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

  // Hand tool: drag to pan. The pointer is captured only once it moves, so a plain click
  // still reaches links and form fields under it (capture would send the click to the viewer).
  const pan = useRef<{ x: number; y: number; left: number; top: number; captured: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (tool !== 'hand' && e.button !== 1) return;
    const el = ref.current!;
    pan.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, captured: false };
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pan.current) return;
    const el = ref.current!;
    if (!pan.current.captured) {
      if (Math.abs(e.clientX - pan.current.x) + Math.abs(e.clientY - pan.current.y) < 4) return;
      el.setPointerCapture(e.pointerId);
      pan.current.captured = true;
    }
    el.scrollLeft = pan.current.left - (e.clientX - pan.current.x);
    el.scrollTop = pan.current.top - (e.clientY - pan.current.y);
  };
  const endPan = () => (pan.current = null);

  return (
    <div
      ref={ref}
      className={`viewer tool-${tool} ${dragOver ? 'drag-over' : ''} ${split !== 'none' ? (active ? 'active' : 'inactive') : ''}`}
      onScroll={onScroll}
      onPointerDownCapture={() => activatePane(pane)}
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
      <ViewScale.Provider value={viewScale}>
        <div className="pages" key={docSession} style={{ height: layout.total, minWidth: layout.maxWidth + PAD * 2 }}>
          {pageSlots(range, layout).map(({ page, visible }) => (
            <div key={page} className="page-slot" style={{ top: layout.tops[page], transform: `translateX(${layout.lefts[page]}px)`, width: layout.widths[page] }}>
              <PageView index={page} visible={visible} />
            </div>
          ))}
        </div>
      </ViewScale.Provider>
    </div>
  );
}
