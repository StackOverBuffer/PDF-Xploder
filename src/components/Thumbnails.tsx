import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { PRIORITY } from '../lib/renderQueue';
import { docKey, keepCanvas, takeCanvas } from '../lib/pageCache';
import { drawPage } from '../lib/render/draw';
import { RotateCcw, RotateCw, Trash2, FilePlus2, Copy, FileOutput } from 'lucide-react';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import * as cmd from '../store/commands';
import { PAGE_DRAG_TYPE, draggingFromOtherTab, dropPages, endPageDrag, startPageDrag } from '../store/pageTransfer';
import { viewSize } from '../lib/geometry';
import { tf, useT } from '../lib/i18n';

const THUMB_W = 130;

/** One observer for all thumbnails, relative to the thumbnail list (so the prefetch margin applies there). */
function useInView(root: HTMLElement | null, el: HTMLElement | null): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!el) return;
    const io = observerFor(root);
    callbacks.set(el, setInView);
    io.observe(el);
    return () => {
      io.unobserve(el);
      callbacks.delete(el);
    };
  }, [root, el]);
  return inView;
}

const callbacks = new WeakMap<Element, (v: boolean) => void>();
const observers = new WeakMap<object, IntersectionObserver>();
const NO_ROOT = {};
function observerFor(root: HTMLElement | null): IntersectionObserver {
  const key = root ?? NO_ROOT;
  let io = observers.get(key);
  if (!io) {
    io = new IntersectionObserver((entries) => entries.forEach((e) => callbacks.get(e.target)?.(e.isIntersecting)), { root, rootMargin: '400px 0px' });
    observers.set(key, io);
  }
  return io;
}

const Thumb = memo(function Thumb({ index, root }: { index: number; root: HTMLElement | null }) {
  const pdf = useStore((s) => s.pdf);
  const docVersion = useStore((s) => s.docVersion);
  const opening = useStore((s) => s.opening);
  const geom = useStore((s) => s.geoms[index]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const inView = useInView(root, host);
  const done = useRef('');
  /** The canvas shown and its key in the page cache (kept there when unmounted, e.g. on a tab switch). */
  const shown = useRef<{ canvas: HTMLCanvasElement; key: string } | null>(null);
  const { width, height } = viewSize(geom);
  const scale = THUMB_W / width;

  useEffect(() => {
    if (shown.current) takeCanvas(shown.current.key);
    return () => {
      if (shown.current) keepCanvas(shown.current.key, shown.current.canvas);
    };
  }, []);

  useEffect(() => {
    const key = `${docVersion}:${scale}:${geom.rotation}`;
    if (!inView || !pdf || opening || done.current === key) return;
    const cacheKey = `thumb:${docKey(pdf)}:${index}:${scale}:${geom.rotation}:${window.devicePixelRatio}`;
    const swap = (canvas: HTMLCanvasElement) => {
      hostRef.current?.replaceChildren(canvas);
      if (shown.current) keepCanvas(shown.current.key, shown.current.canvas);
      shown.current = { canvas, key: cacheKey };
      done.current = key;
    };
    const kept = takeCanvas(cacheKey);
    if (kept) return swap(kept);
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    (async () => {
      try {
        const page = await pdf.getPage(index + 1);
        if (cancelled) return;
        const at = { scale: scale * Math.min(window.devicePixelRatio || 1, 1.5), rotation: geom.rotation };
        const viewport = page.getViewport(at);
        // The pages in the main view come first.
        const draw = drawPage(pdf, page, at, { width: Math.floor(viewport.width), height: Math.floor(viewport.height) }, { priority: PRIORITY.thumbnail });
        task = draw;
        const canvas = await draw.promise;
        if (cancelled || !canvas) return;
        swap(canvas);
      } catch {
        /* cancelled */
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [inView, pdf, docVersion, index, scale, geom.rotation, opening]);

  return (
    <div
      ref={(el) => {
        hostRef.current = el;
        if (el !== host) setHost(el);
      }}
      className="thumb-canvas"
      style={{ width: THUMB_W, height: Math.round(height * scale) }}
    />
  );
});

interface ItemProps {
  index: number;
  root: HTMLElement | null;
  dropBefore: boolean;
  dropAfter: boolean;
  draggable: boolean;
  onPick: (e: React.MouseEvent, i: number) => void;
  onDragStart: (e: React.DragEvent, i: number) => void;
  onDragOver: (e: React.DragEvent, i: number) => void;
}

/** One thumbnail; subscribes only to what concerns its own page. */
const ThumbItem = memo(function ThumbItem({ index, root, dropBefore, dropAfter, draggable, onPick, onDragStart, onDragOver }: ItemProps) {
  const t = useT();
  const current = useStore((s) => s.currentPage === index);
  const selected = useStore((s) => s.selectedPages.includes(index));
  const count = useStore((s) => s.annotations[s.pageIds[index]]?.length ?? 0);
  return (
    <div
      className={`thumb ${current ? 'current' : ''} ${selected ? 'selected' : ''} ${dropBefore ? 'drop-before' : ''} ${dropAfter ? 'drop-after' : ''}`}
      draggable={draggable}
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={endPageDrag}
      onClick={(e) => onPick(e, index)}
    >
      <div className="thumb-frame">
        <Thumb index={index} root={root} />
        {count > 0 && <span className="thumb-badge" title={t('Has annotations')}>{count}</span>}
      </div>
      <div className="thumb-label">{index + 1}</div>
    </div>
  );
});

export function Thumbnails() {
  const t = useT();
  const count = useStore((s) => s.geoms.length);
  const docSession = useStore((s) => s.docSession);
  const selectedCount = useStore((s) => s.selectedPages.length);
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const canAssemble = useCan('assemble');
  const canCopy = useCan('copy');
  const [dropAt, setDropAt] = useState<number | null>(null);
  const anchor = useRef(0);

  const onClick = useCallback((e: React.MouseEvent, i: number) => {
    const s = useStore.getState();
    const selected = s.selectedPages;
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      s.setSelectedPages(Array.from({ length: b - a + 1 }, (_, k) => a + k));
    } else if (e.ctrlKey || e.metaKey) {
      s.setSelectedPages(selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i]);
      anchor.current = i;
    } else {
      s.setSelectedPages([i]);
      anchor.current = i;
    }
    s.goToPage(i);
  }, []);

  const onDragStart = useCallback((e: React.DragEvent, i: number) => {
    const s = useStore.getState();
    const selected = s.selectedPages;
    if (!selected.includes(i)) s.setSelectedPages([i]);
    const pages = selected.includes(i) ? selected : [i];
    e.dataTransfer.setData(PAGE_DRAG_TYPE, JSON.stringify(pages));
    // Move within the document; copy into another tab.
    e.dataTransfer.effectAllowed = 'copyMove';
    startPageDrag(pages);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent, i: number) => {
    if (!e.dataTransfer.types.includes(PAGE_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = draggingFromOtherTab() ? 'copy' : 'move';
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const at = e.clientY < r.top + r.height / 2 ? i : i + 1;
    setDropAt((prev) => (prev === at ? prev : at));
  }, []);

  const onDrop = (e: React.DragEvent) => {
    const to = dropAt;
    setDropAt(null);
    if (!e.dataTransfer.types.includes(PAGE_DRAG_TYPE)) return;
    e.preventDefault();
    // Pages from another tab: copy them in (below the last page when dropped on empty space).
    if (draggingFromOtherTab()) return void dropPages(to ?? undefined);
    const data = e.dataTransfer.getData(PAGE_DRAG_TYPE);
    if (data && to !== null) cmd.movePages(JSON.parse(data), to);
  };

  const n = selectedCount || 1;
  return (
    <div className="panel thumbs-panel">
      <div className="panel-toolbar">
        <button title={t('Rotate left')} disabled={!canAssemble} onClick={() => cmd.rotate(-90)}><RotateCcw size={16} /></button>
        <button title={t('Rotate right')} disabled={!canAssemble} onClick={() => cmd.rotate(90)}><RotateCw size={16} /></button>
        <button title={t('Insert blank page after')} disabled={!canAssemble} onClick={() => cmd.insertBlank()}><FilePlus2 size={16} /></button>
        <button title={t('Duplicate')} disabled={!canAssemble} onClick={() => cmd.duplicate()}><Copy size={16} /></button>
        <button title={t('Extract to new file')} disabled={!canCopy} onClick={() => cmd.extract()}><FileOutput size={16} /></button>
        <button title={t('Delete')} disabled={!canAssemble} onClick={() => cmd.deletePages()}><Trash2 size={16} /></button>
        <span className="muted small">{tf('{n} sel.', { n })}</span>
      </div>
      <div
        className="thumbs"
        key={docSession}
        ref={setList}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(PAGE_DRAG_TYPE) && draggingFromOtherTab()) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDragLeave={() => setDropAt(null)}
        onDrop={onDrop}
      >
        {Array.from({ length: count }, (_, i) => (
          <ThumbItem
            key={i}
            index={i}
            root={list}
            dropBefore={dropAt === i}
            dropAfter={dropAt === i + 1 && i === count - 1}
            draggable={canAssemble}
            onPick={onClick}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
          />
        ))}
      </div>
    </div>
  );
}
