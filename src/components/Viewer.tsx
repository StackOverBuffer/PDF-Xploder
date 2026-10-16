import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { styleFor, uid, useStore } from '../store/store';
import { can } from '../store/permissions';
import { pdfToView, viewRectToPdf, viewSize, type VRect } from '../lib/geometry';
import { PageView } from './PageView';
import { openDropped } from '../store/commands';
import type { TextMarkupKind } from '../lib/types';

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

export function Viewer() {
  const geoms = useStore((s) => s.geoms);
  const docSession = useStore((s) => s.docSession);
  const scale = useStore((s) => s.scale);
  const fit = useStore((s) => s.fit);
  const tool = useStore((s) => s.tool);
  const scrollRequest = useStore((s) => s.scrollRequest);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<Set<number>>(new Set([0, 1]));
  const [dragOver, setDragOver] = useState(false);

  // Page offsets, computed from geometry so we never need to measure the DOM.
  const tops: number[] = [];
  let y = PAD;
  for (const g of geoms) {
    tops.push(y);
    y += Math.floor(viewSize(g).height * scale) + GAP;
  }

  const updateVisible = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { geoms, scale } = useStore.getState();
    const top = el.scrollTop - el.clientHeight;
    const bottom = el.scrollTop + el.clientHeight * 2;
    const vis = new Set<number>();
    let yy = PAD;
    let current = 0;
    const probe = el.scrollTop + el.clientHeight / 3;
    geoms.forEach((g, i) => {
      const h = Math.floor(viewSize(g).height * scale);
      if (yy + h >= top && yy <= bottom) vis.add(i);
      if (yy <= probe) current = i;
      yy += h + GAP;
    });
    setVisible((prev) => (prev.size === vis.size && [...vis].every((v) => prev.has(v)) ? prev : vis));
    if (useStore.getState().currentPage !== current) useStore.getState().setCurrentPage(current);
  }, []);

  // Fit-to-width / fit-to-page.
  const applyFit = useCallback(() => {
    const el = ref.current;
    const { fit, geoms, currentPage, setScale } = useStore.getState();
    if (!el || !fit || !geoms.length) return;
    const g = geoms[currentPage] ?? geoms[0];
    const { width, height } = viewSize(g);
    const maxW = Math.max(...geoms.map((x) => viewSize(x).width));
    const availW = el.clientWidth - PAD * 2;
    const availH = el.clientHeight - PAD * 2;
    const s = fit === 'width' ? availW / maxW : Math.min(availW / width, availH / height);
    setScale(Math.max(0.1, s), fit);
  }, []);

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

  // Keep the same document position when zooming.
  const prevScale = useRef(scale);
  useLayoutEffect(() => {
    const el = ref.current;
    // At the very top (e.g. right after opening) stay there instead of anchoring on the centre.
    if (el && prevScale.current !== scale && el.scrollTop > 0) {
      const ratio = scale / prevScale.current;
      el.scrollTop = (el.scrollTop + el.clientHeight / 2) * ratio - el.clientHeight / 2;
      el.scrollLeft = (el.scrollLeft + el.clientWidth / 2) * ratio - el.clientWidth / 2;
    }
    prevScale.current = scale;
    updateVisible();
  }, [scale, geoms, updateVisible]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !scrollRequest) return;
    const { page, y: uy } = scrollRequest;
    let target = tops[page] ?? 0;
    if (uy !== undefined && geoms[page]) {
      const v = pdfToView(geoms[page], { x: geoms[page].view[0], y: uy });
      target += v.y * scale - el.clientHeight / 3;
    } else {
      target -= GAP / 2;
    }
    el.scrollTo({ top: Math.max(0, target) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest]);

  // Ctrl + wheel zooms.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const s = useStore.getState();
      s.setScale(s.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
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

  const maxWidth = Math.max(0, ...geoms.map((g) => Math.floor(viewSize(g).width * scale)));

  return (
    <div
      ref={ref}
      className={`viewer tool-${tool} ${dragOver ? 'drag-over' : ''}`}
      onScroll={updateVisible}
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
      <div className="pages" key={docSession} style={{ height: y + PAD - GAP, minWidth: maxWidth + PAD * 2 }}>
        {geoms.map((g, i) => (
          <div key={i} className="page-slot" style={{ top: tops[i], width: Math.floor(viewSize(g).width * scale) }}>
            <PageView index={i} visible={visible.has(i)} />
          </div>
        ))}
      </div>
    </div>
  );
}
