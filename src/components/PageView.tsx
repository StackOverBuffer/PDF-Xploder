import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnnotationMode, TextLayer } from 'pdfjs-dist';
import { useStore } from '../store/store';
import { viewSize } from '../lib/geometry';
import { AnnotationLayer } from './AnnotationLayer';
import { WidgetLayer } from './WidgetLayer';
import { ContentLayer } from './ContentLayer';
import { registerTextLayer } from '../lib/textSelection';
import { PRIORITY, renderSlot } from '../lib/renderQueue';
import { TextBoxLayer } from './TextBoxSelect';
import { useContextMenu } from './Menu';
import { pageMenu } from './contextMenus';

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
  const textLayer = useRef<{ layer: TextLayer; scale: number } | null>(null);
  const dpr = useDevicePixelRatio();

  useEffect(() => registerTextLayer(textRef.current!), []);

  // Free the canvas memory right away when the page is unmounted (scrolled far away).
  useEffect(
    () => () => {
      const c = canvasHost.current?.firstChild;
      if (c instanceof HTMLCanvasElement) c.width = c.height = 0;
      textLayer.current?.layer.cancel();
    },
    [],
  );

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
    let cancelled = false;
    let renderTask: { cancel(): void } | null = null;
    let building: TextLayer | null = null;
    let endMain = () => {};
    (async () => {
      try {
        // Re-rendering an already drawn page (zoom, edits): wait until the zoom settles;
        // the old canvas is stretched meanwhile.
        if (renderedCanvas.current && needCanvas) {
          await new Promise((r) => setTimeout(r, 120));
          if (cancelled) return;
        }
        const page = await pdf.getPage(index + 1);
        if (cancelled) return;
        if (needCanvas) {
          const slot = renderSlot(PRIORITY.page);
          endMain = slot.done;
          await slot.ready;
          if (cancelled) return;
          // Like pdf.js's viewer, limit the canvas size: huge canvases (high zoom on a
          // high-density screen) are slow to draw and can exhaust the browser's memory.
          const css = page.getViewport({ scale, rotation: geom.rotation });
          const outScale = Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / (css.width * css.height)));
          const viewport = page.getViewport({ scale: scale * outScale, rotation: geom.rotation });
          // Render into a fresh canvas and swap it in when done, so zooming does not flash white.
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = 'page-canvas';
          // Form fields are drawn as live HTML controls by WidgetLayer, so leave them off the canvas.
          const task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false })!, viewport, annotationMode: AnnotationMode.ENABLE_FORMS });
          renderTask = task;
          await task.promise;
          if (cancelled) return;
          const old = canvasHost.current?.firstChild;
          canvasHost.current?.replaceChildren(canvas);
          if (old instanceof HTMLCanvasElement) old.width = old.height = 0;
          renderedCanvas.current = canvasKey;
          endMain();
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
      } finally {
        endMain();
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      building?.cancel();
      endMain();
    };
  }, [pdf, docVersion, index, scale, visible, geom.rotation, opening, dpr]);

  return (
    <div
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
