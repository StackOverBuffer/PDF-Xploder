import { memo, useEffect, useRef } from 'react';
import { AnnotationMode, TextLayer } from 'pdfjs-dist';
import { useStore } from '../store/store';
import { viewSize } from '../lib/geometry';
import { AnnotationLayer } from './AnnotationLayer';
import { WidgetLayer } from './WidgetLayer';
import { ContentLayer } from './ContentLayer';
import { registerTextLayer } from '../lib/textSelection';
import { TextBoxLayer } from './TextBoxSelect';
import { useContextMenu } from './Menu';
import { pageMenu } from './contextMenus';

/** Upper bound for a page canvas, as in pdf.js's viewer (2^24 pixels). */
const MAX_CANVAS_PIXELS = 16777216;

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
  const rendered = useRef<string>('');

  useEffect(() => registerTextLayer(textRef.current!), []);

  const { width, height } = viewSize(geom);
  const w = Math.floor(width * scale);
  const h = Math.floor(height * scale);

  useEffect(() => {
    if (!visible || !pdf || opening) return;
    const key = `${docVersion}:${scale}:${geom.rotation}`;
    if (rendered.current === key) return;
    let cancelled = false;
    let renderTask: { cancel(): void } | null = null;
    let textLayer: TextLayer | null = null;
    (async () => {
      try {
        // Re-rendering an already drawn page (zoom, edits): wait until the zoom settles;
        // the old canvas is stretched meanwhile.
        if (rendered.current) {
          await new Promise((r) => setTimeout(r, 120));
          if (cancelled) return;
        }
        const page = await pdf.getPage(index + 1);
        if (cancelled) return;
        // Like pdf.js's viewer, limit the canvas size: huge canvases (high zoom on a
        // high-density screen) are slow to draw and can exhaust the browser's memory.
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const css = page.getViewport({ scale, rotation: geom.rotation });
        const outScale = Math.max(0.5, Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / (css.width * css.height))));
        const viewport = page.getViewport({ scale: scale * outScale, rotation: geom.rotation });
        // Render into a fresh canvas and swap it in when done, so zooming does not flash white.
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.className = 'page-canvas';
        // Form fields are drawn as live HTML controls by WidgetLayer, so leave them off the canvas.
        const task = page.render({ canvasContext: canvas.getContext('2d')!, viewport, annotationMode: AnnotationMode.ENABLE_FORMS });
        renderTask = task;
        await task.promise;
        if (cancelled) return;
        canvasHost.current?.replaceChildren(canvas);
        rendered.current = key;

        const textDiv = textRef.current;
        if (!textDiv) return;
        textDiv.replaceChildren();
        textDiv.style.setProperty('--scale-factor', String(scale));
        textLayer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container: textDiv,
          viewport: page.getViewport({ scale, rotation: geom.rotation }),
        });
        await textLayer.render();
        const end = document.createElement('div');
        end.className = 'endOfContent';
        textDiv.append(end);
      } catch (e) {
        if ((e as Error)?.name !== 'RenderingCancelledException' && !cancelled) console.error(e);
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, docVersion, index, scale, visible, geom.rotation, opening]);

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
