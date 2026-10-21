import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TextLayer } from 'pdfjs-dist';
import { useStore } from '../store/store';
import { viewSize } from '../lib/geometry';
import { AnnotationLayer } from './AnnotationLayer';
import { WidgetLayer } from './WidgetLayer';
import { ContentLayer } from './ContentLayer';
import { registerTextLayer } from '../lib/textSelection';
import { PRIORITY } from '../lib/renderQueue';
import { docKey, keepCanvas, takeCanvas } from '../lib/pageCache';
import { TextBoxLayer } from './TextBoxSelect';
import { useContextMenu } from './Menu';
import { pageMenu } from './contextMenus';
import { drawPage } from '../lib/render/draw';

/** Upper bound for a page canvas, as in pdf.js's viewer (2^24 pixels). */
const MAX_CANVAS_PIXELS = 16777216;

/** The screen's pixel ratio, updated when the window moves to another screen or the browser zoom changes. */
function useDevicePixelRatio(): number {
  const get = () => Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 3);
  const [dpr, setDpr] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const onChange = () => setDpr(get());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [dpr]);
  return dpr;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
/** Pixel budget of one sharp piece of a zoomed-in page, and how many pieces are kept. */
const DETAIL_PIXELS = 12_000_000;
const DETAIL_PIECES = 3;
const overlaps = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
const contains = (a: Box, b: Box) => b.left >= a.left - 1 && b.top >= a.top - 1 && b.left + b.width <= a.left + a.width + 1 && b.top + b.height <= a.top + a.height + 1;
function clip(b: Box, w: number, h: number): Box | null {
  const left = Math.max(0, Math.floor(b.left));
  const top = Math.max(0, Math.floor(b.top));
  const right = Math.min(w, Math.ceil(b.left + b.width));
  const bottom = Math.min(h, Math.ceil(b.top + b.height));
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

interface Props {
  index: number;
  /** Whether the page is near the viewport and should be rendered. */
  visible: boolean;
}

export const PageView = memo(function PageView({ index, visible }: Props) {
  const pdf = useStore((s) => s.pdf);
  const docVersion = useStore((s) => s.docVersion);
  const geom = useStore((s) => s.geoms[index]);
  const pageId = useStore((s) => s.pageIds[index]);
  const scale = useStore((s) => s.scale);
  // While another document is being opened, stop rendering this one (and cancel what is running).
  const opening = useStore((s) => s.opening);
  const contentTool = useStore((s) => s.tool.startsWith('content'));
  const textBoxTool = useStore((s) => s.tool === 'selectText');
  const menu = useContextMenu();
  const canvasHost = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  /** What the canvas and the text layer currently show (tracked apart: either can be cancelled). */
  const renderedCanvas = useRef('');
  const renderedText = useRef('');
  /** The canvas shown, and its key in the page cache (the host's ref is gone when unmounting). */
  const shown = useRef<{ canvas: HTMLCanvasElement; key: string } | null>(null);
  const textLayer = useRef<{ layer: TextLayer; scale: number } | null>(null);
  const dpr = useDevicePixelRatio();
  const pageRef = useRef<HTMLDivElement>(null);
  const detailHost = useRef<HTMLDivElement>(null);

  useEffect(() => registerTextLayer(textRef.current!), []);

  // An unmounted page (scrolled far away, another tab shown) keeps its canvas in the
  // page cache, which frees it when room is needed.
  useEffect(() => {
    // Mounted again with the DOM kept (React's StrictMode): the canvas is ours again.
    if (shown.current) takeCanvas(shown.current.key);
    return () => {
      if (shown.current) keepCanvas(shown.current.key, shown.current.canvas);
      textLayer.current?.layer.cancel();
    };
  }, []);

  const { width, height } = viewSize(geom);
  const w = Math.floor(width * scale);
  const h = Math.floor(height * scale);

  // Zooming: the text layer follows the new size at once (its boxes use --scale-factor).
  useLayoutEffect(() => {
    textRef.current?.style.setProperty('--scale-factor', String(scale));
  }, [scale]);

  useEffect(() => {
    if (!visible || !pdf || opening) return;
    const canvasKey = `${docVersion}:${scale}:${geom.rotation}:${dpr}`;
    const textKey = `${docVersion}:${geom.rotation}`;
    const needCanvas = renderedCanvas.current !== canvasKey;
    const needText = renderedText.current !== textKey;
    const needRescale = !needText && textLayer.current?.scale !== scale;
    if (!needCanvas && !needText && !needRescale) return;
    // Not by docVersion, which also changes on a tab switch: every content change loads a new pdf.
    const cacheKey = `${docKey(pdf)}:${index}:${scale}:${geom.rotation}:${dpr}`;
    // Show it, kept from earlier: a page drawn at this zoom.
    const swap = (canvas: HTMLCanvasElement) => {
      canvasHost.current?.replaceChildren(canvas);
      if (shown.current) keepCanvas(shown.current.key, shown.current.canvas);
      shown.current = { canvas, key: cacheKey };
      renderedCanvas.current = canvasKey;
    };
    const kept = needCanvas ? takeCanvas(cacheKey) : null;
    if (kept) swap(kept);
    const drawCanvas = needCanvas && !kept;
    let cancelled = false;
    let renderTask: { cancel(): void } | null = null;
    let building: TextLayer | null = null;
    (async () => {
      try {
        // Re-rendering an already drawn page (zoom, edits): wait until the zoom settles;
        // the old canvas is stretched meanwhile.
        if (renderedCanvas.current && drawCanvas) {
          await new Promise((r) => setTimeout(r, 120));
          if (cancelled) return;
        }
        const page = await pdf.getPage(index + 1);
        if (cancelled) return;
        if (drawCanvas) {
          // Like pdf.js's viewer, limit the canvas size: huge canvases (high zoom on a
          // high-density screen) are slow to draw and can exhaust the browser's memory.
          const css = page.getViewport({ scale, rotation: geom.rotation });
          const outScale = Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / (css.width * css.height)));
          const viewport = page.getViewport({ scale: scale * outScale, rotation: geom.rotation });
          // Render into a fresh canvas and swap it in when done, so zooming does not flash white.
          // Form fields are drawn as live HTML controls by WidgetLayer, so leave them off the canvas.
          const size = { width: Math.floor(viewport.width), height: Math.floor(viewport.height) };
          const draw = drawPage(pdf, page, { scale: scale * outScale, rotation: geom.rotation }, size, { priority: PRIORITY.page, noForms: true });
          renderTask = draw;
          const canvas = await draw.promise;
          if (cancelled || !canvas) return;
          canvas.className = 'page-canvas';
          swap(canvas);
        }
        const textDiv = textRef.current;
        if (!textDiv) return;
        const viewport = page.getViewport({ scale, rotation: geom.rotation });
        if (!needText) {
          // Only the zoom changed: re-measure the existing text boxes instead of rebuilding them.
          if (textLayer.current && textLayer.current.scale !== scale) {
            textLayer.current.layer.update({ viewport });
            textLayer.current.scale = scale;
          }
          return;
        }
        const fresh = document.createElement('div');
        building = new TextLayer({ textContentSource: page.streamTextContent(), container: fresh, viewport });
        await building.render();
        if (cancelled) return;
        const end = document.createElement('div');
        end.className = 'endOfContent';
        fresh.append(end);
        textLayer.current?.layer.cancel();
        // Swap in the finished layer's content in one go.
        textDiv.replaceChildren(...fresh.childNodes);
        textDiv.style.width = fresh.style.width;
        textDiv.style.height = fresh.style.height;
        textDiv.setAttribute('data-main-rotation', fresh.getAttribute('data-main-rotation') ?? '0');
        textLayer.current = { layer: building, scale };
        building = null;
        renderedText.current = textKey;
      } catch (e) {
        if ((e as Error)?.name !== 'RenderingCancelledException' && !cancelled) console.error(e);
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      building?.cancel();
    };
  }, [pdf, docVersion, index, scale, visible, geom.rotation, opening, dpr]);

  // Zoomed far into a big page (plans, maps): the page canvas is capped (see MAX_CANVAS_PIXELS),
  // so the area around the view gets sharp pieces of its own, as in pdf.js's viewer. Each
  // piece costs about a whole-page render for complex drawings, so pieces are large, a
  // render in progress is not given up while panning nearby, and the last few are kept.
  const capped = w * h * dpr * dpr > MAX_CANVAS_PIXELS;
  useEffect(() => {
    const host = detailHost.current;
    host?.replaceChildren();
    if (!visible || !capped || !pdf || opening || !host) return;
    const el = pageRef.current;
    const viewer = el?.closest<HTMLElement>('.viewer');
    if (!el || !viewer) return;
    let disposed = false;
    const pieces: { box: Box; canvas: HTMLCanvasElement }[] = [];
    let inFlight: { box: Box; cancel(): void } | null = null;

    const seen = () => {
      const pr = el.getBoundingClientRect();
      const vr = viewer.getBoundingClientRect();
      return clip({ left: vr.left - pr.left, top: vr.top - pr.top, width: vr.width, height: vr.height }, w, h);
    };
    /** The view plus up to half a view on every side, as far as the pixel budget allows. */
    const around = (v: Box): Box => {
      const budget = DETAIL_PIXELS / (dpr * dpr);
      let k = 0.5;
      while (k > 0.05 && (v.width * (1 + 2 * k)) * (v.height * (1 + 2 * k)) > budget) k *= 0.8;
      return clip({ left: v.left - v.width * k, top: v.top - v.height * k, width: v.width * (1 + 2 * k), height: v.height * (1 + 2 * k) }, w, h) ?? v;
    };
    const render = async (box: Box) => {
      let task: { cancel(): void } | null = null;
      let given = false;
      inFlight = { box, cancel: () => { given = true; task?.cancel(); } };
      let canvas: HTMLCanvasElement | null = null;
      try {
        const page = await pdf.getPage(index + 1);
        if (disposed || given) return;
        const k = dpr;
        const at = { scale: scale * k, rotation: geom.rotation, offsetX: -box.left * k, offsetY: -box.top * k };
        const draw = drawPage(pdf, page, at, { width: Math.ceil(box.width * k), height: Math.ceil(box.height * k) }, { priority: PRIORITY.page, noForms: true });
        task = draw;
        canvas = await draw.promise;
        if (disposed || given || !canvas) {
          if (canvas) canvas.width = canvas.height = 0;
          return;
        }
        canvas.className = 'page-detail';
        Object.assign(canvas.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
        host.appendChild(canvas);
        pieces.push({ box, canvas });
        while (pieces.length > DETAIL_PIECES) {
          const old = pieces.shift()!;
          old.canvas.remove();
          old.canvas.width = old.canvas.height = 0;
        }
      } catch (e) {
        if (canvas) canvas.width = canvas.height = 0;
        if ((e as Error)?.name !== 'RenderingCancelledException' && !disposed && !given) console.error(e);
      } finally {
        if (inFlight?.box === box) inFlight = null;
      }
      // The view may have moved on meanwhile.
      if (!disposed) check();
    };
    const check = () => {
      if (disposed) return;
      const v = seen();
      if (!v || pieces.some((p) => contains(p.box, v))) return;
      if (inFlight) {
        // Keep a render that still covers part of the view; give up one the view has left.
        if (overlaps(inFlight.box, v)) return;
        inFlight.cancel();
        inFlight = null;
      }
      void render(around(v));
    };
    let timer = 0;
    // Checked while panning (not only once it stops): sharp areas fill in as you move.
    const onScroll = () => {
      if (!timer) timer = window.setTimeout(() => ((timer = 0), check()), 80);
    };
    check();
    viewer.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      disposed = true;
      clearTimeout(timer);
      viewer.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      inFlight?.cancel();
      for (const p of pieces) p.canvas.width = p.canvas.height = 0;
      host.replaceChildren();
    };
  }, [visible, capped, pdf, opening, index, scale, geom.rotation, dpr, w, h, docVersion]);

  return (
    <div
      ref={pageRef}
      className="page"
      data-index={index}
      style={{ width: w, height: h }}
      onContextMenu={(e) => {
        // Layers with their own menus (objects, text box selection) handle it first.
        if (e.defaultPrevented || (e.target as Element).closest('input, textarea, select, .widget')) return;
        const r = e.currentTarget.getBoundingClientRect();
        menu.open(e, pageMenu(index, geom, { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }));
      }}
    >
      <div className="canvas-host" ref={canvasHost} />
      <div className="detail-host" ref={detailHost} />
      <div className="textLayer" ref={textRef} />
      {visible && <WidgetLayer index={index} geom={geom} scale={scale} />}
      {visible && pageId && <AnnotationLayer index={index} pageId={pageId} geom={geom} scale={scale} width={w} height={h} />}
      {visible && textBoxTool && <TextBoxLayer index={index} geom={geom} scale={scale} />}
      {visible && contentTool && <ContentLayer index={index} geom={geom} scale={scale} width={w} height={h} />}
      <div className="page-label">{index + 1}</div>
      {menu.element}
    </div>
  );
});
