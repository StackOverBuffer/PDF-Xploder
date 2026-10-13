import { memo, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { styleFor, uid, useStore } from '../store/store';
import { useCan } from '../store/permissions';
import { frameGeom, frameMatrix, pdfRectToView, pdfToView, rectFromPoints, viewRectToPdf, viewToPdf, type VRect } from '../lib/geometry';
import { hasRect, resizePatch, translatePatch, viewBounds } from '../lib/annotGeom';
import type { Annotation, PageGeom, Pt, Tool } from '../lib/types';
import { NOTE_SIZE } from '../lib/types';
import { useDialog } from './Dialogs';
import { addField } from '../store/commands';
import { snapshotRegion } from '../store/extras';
import { zoomAt, zoomToBox } from '../store/viewActions';
import { stampViewSize, usePendingStamp } from '../store/contentActions';
import { viewSize } from '../lib/geometry';
import type { NewFieldKind } from '../lib/forms';
import { useT } from '../lib/i18n';

interface Props {
  index: number;
  pageId: string;
  geom: PageGeom;
  scale: number;
  width: number;
  height: number;
}

const FIELD_TOOLS: Partial<Record<Tool, NewFieldKind>> = {
  fieldText: 'text', fieldCheckbox: 'checkbox', fieldDropdown: 'dropdown', fieldList: 'list', fieldRadio: 'radio',
};
const DRAW_TOOLS: Tool[] = ['zoom', 'snapshot', 'ink', 'rect', 'ellipse', 'line', 'arrow', 'text', 'note', 'stamp', 'redact', 'sign', ...(Object.keys(FIELD_TOOLS) as Tool[])];
const EMPTY: Annotation[] = [];

type Draft =
  | { kind: 'ink'; points: Pt[] }
  | { kind: 'box'; start: Pt; end: Pt }
  | null;

type Drag =
  | { mode: 'move'; id: string; orig: Annotation; start: Pt; moved: boolean }
  | { mode: 'resize'; id: string; orig: VRect; start: Pt; moved: boolean }
  | null;

/** SVG overlay that displays a page's annotations and handles drawing/selection. */
export const AnnotationLayer = memo(function AnnotationLayer({ index, pageId, geom, scale, width, height }: Props) {
  const annots = useStore((s) => s.annotations[pageId] ?? EMPTY);
  const tool = useStore((s) => s.tool);
  const selected = useStore((s) => (s.selected?.pageId === pageId ? s.selected.id : null));
  const editing = useStore((s) => s.editing);
  const editable = useCan('annotate');
  const canDesign = useCan('designForms');
  const canSign = useCan('fillForms');
  const canCopy = useCan('copy');
  const hits = useStore((s) => s.search.hits);
  const hitIndex = useStore((s) => s.search.index);
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const drag = useRef<Drag>(null);
  const zoomOut = useRef(false);
  const pending = usePendingStamp((x) => x.stamp);
  /** Pointer position for the stamp preview that follows the mouse. */
  const [hover, setHover] = useState<Pt | null>(null);

  const drawing = DRAW_TOOLS.includes(tool) && (FIELD_TOOLS[tool] ? canDesign : tool === 'sign' ? canSign : tool === 'snapshot' ? canCopy : tool === 'zoom' ? true : editable);

  /** Pointer position in view space (scale 1). */
  const viewPt = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  // ------------------------------------------------------------ drawing
  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (!drawing || e.button !== 0) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = viewPt(e);
    zoomOut.current = e.altKey;
    if (tool === 'stamp' && pending) {
      placePendingStamp(p);
      return;
    }
    if (tool === 'ink') setDraft({ kind: 'ink', points: [p] });
    else if (tool === 'note') createNote(p);
    else setDraft({ kind: 'box', start: p, end: p });
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (drag.current) return onDragMove(e);
    if (tool === 'stamp' && drawing) setHover(viewPt(e));
    if (!draft) return;
    const p = viewPt(e);
    if (draft.kind === 'ink') setDraft({ kind: 'ink', points: [...draft.points, p] });
    else setDraft({ ...draft, end: e.shiftKey ? constrain(draft.start, p, tool) : p });
  };

  const onPointerUp = () => {
    if (drag.current) {
      drag.current = null;
      return;
    }
    if (!draft) return;
    commitDraft(draft);
    setDraft(null);
  };

  function base(t: string) {
    const st = styleFor(t);
    return { id: uid('annot'), color: st.color, opacity: st.opacity, author: useStore.getState().author, createdAt: Date.now() };
  }

  function createNote(p: Pt) {
    const a: Annotation = { ...base('note'), type: 'note', at: viewToPdf(geom, { x: p.x - NOTE_SIZE / 2, y: p.y - NOTE_SIZE / 2 }), text: '' };
    useStore.getState().addAnnotation(index, a);
    useStore.getState().setTool('select');
    useStore.getState().select({ pageId, id: a.id });
    requestAnimationFrame(() => document.getElementById('prop-text')?.focus());
  }

  function placePendingStamp(p: Pt) {
    const s = pending!;
    const store = useStore.getState();
    const { width: w, height: h } = stampViewSize(s, viewSize(geom));
    const rect = viewRectToPdf(geom, { left: p.x - w / 2, top: p.y - h / 2, width: w, height: h });
    const a: Annotation = { id: uid('annot'), type: 'image', rect, rot: geom.rotation, src: s.src, color: '#000000', opacity: 1, author: store.author, createdAt: Date.now() };
    store.addAnnotation(index, a);
    usePendingStamp.setState({ stamp: null });
    store.setTool('select');
    store.select({ pageId, id: a.id });
    setHover(null);
  }

  function commitDraft(d: NonNullable<Draft>) {
    const store = useStore.getState();
    const st = styleFor(tool);
    if (d.kind === 'ink') {
      if (d.points.length < 2) return;
      store.addAnnotation(index, { ...base('ink'), type: 'ink', width: st.width, paths: [simplify(d.points).map((p) => viewToPdf(geom, p))] });
      return;
    }
    const dx = Math.abs(d.end.x - d.start.x);
    const dy = Math.abs(d.end.y - d.start.y);
    const click = dx < 3 && dy < 3;
    if (tool === 'line' || tool === 'arrow') {
      if (click) return;
      store.addAnnotation(index, { ...base(tool), type: tool, width: st.width, p1: viewToPdf(geom, d.start), p2: viewToPdf(geom, d.end) });
      return;
    }
    const defaults: Record<string, [number, number]> = {
      text: [200, 40], stamp: [160, 50], rect: [100, 70], ellipse: [100, 70], redact: [120, 20], sign: [200, 60],
      fieldText: [180, 22], fieldCheckbox: [14, 14], fieldRadio: [14, 14], fieldDropdown: [140, 22], fieldList: [140, 60],
    };
    if (tool === 'zoom') {
      if (click) zoomAt(index, d.start, zoomOut.current ? 1 / 1.25 : 1.25);
      else zoomToBox(index, { left: Math.min(d.start.x, d.end.x), top: Math.min(d.start.y, d.end.y), width: dx, height: dy });
      return;
    }
    if (tool === 'snapshot') {
      // The tool stays active, as in PDF-XChange, so several regions can be copied in a row.
      if (!click) snapshotRegion(index, viewRectToPdf(geom, { left: Math.min(d.start.x, d.end.x), top: Math.min(d.start.y, d.end.y), width: dx, height: dy }));
      return;
    }
    const [dw, dh] = defaults[tool] ?? [100, 70];
    const box: VRect = click
      ? tool === 'stamp'
        ? { left: d.start.x - dw / 2, top: d.start.y - dh / 2, width: dw, height: dh }
        : { left: d.start.x, top: d.start.y, width: dw, height: dh }
      : { left: Math.min(d.start.x, d.end.x), top: Math.min(d.start.y, d.end.y), width: dx, height: dy };
    const rect = viewRectToPdf(geom, box);
    const fieldKind = FIELD_TOOLS[tool];
    if (fieldKind) {
      // Check boxes and radio buttons stay square.
      const square = fieldKind === 'checkbox' || fieldKind === 'radio';
      const r = square && !click ? viewRectToPdf(geom, { ...box, width: Math.min(box.width, box.height), height: Math.min(box.width, box.height) }) : rect;
      store.setTool('select');
      addField(fieldKind, index, r);
      return;
    }
    switch (tool) {
      case 'sign':
        store.setTool('select');
        useDialog.getState().show('sign', { page: index, rect });
        break;
      case 'rect':
      case 'ellipse':
        store.addAnnotation(index, { ...base(tool), type: tool, rect, width: st.width, fill: st.fill });
        break;
      case 'redact':
        store.addAnnotation(index, { ...base(tool), type: 'redact', rect });
        break;
      case 'stamp':
        store.addAnnotation(index, { ...base(tool), type: 'stamp', rect, rot: geom.rotation, label: st.stampLabel || 'Approved' });
        break;
      case 'text': {
        const a: Annotation = { ...base(tool), type: 'text', rect, rot: geom.rotation, text: '', fontSize: st.fontSize, border: false };
        store.addAnnotation(index, a);
        store.setTool('select');
        store.select({ pageId, id: a.id });
        store.setEditing(a.id);
        break;
      }
    }
  }

  // ------------------------------------------------------------ selecting / moving
  const startDrag = (e: RPointerEvent, a: Annotation, mode: 'move' | 'resize') => {
    if (tool !== 'select' || e.button !== 0) return;
    e.stopPropagation();
    useStore.getState().select({ pageId, id: a.id });
    if (!editable || editing === a.id) return;
    e.preventDefault();
    svgRef.current?.setPointerCapture(e.pointerId);
    const start = viewPt(e);
    drag.current =
      mode === 'move'
        ? { mode, id: a.id, orig: a, start, moved: false }
        : { mode, id: a.id, orig: viewBounds(a, geom), start, moved: false };
  };

  function onDragMove(e: RPointerEvent) {
    const d = drag.current!;
    const p = viewPt(e);
    if (!d.moved) {
      if (Math.abs(p.x - d.start.x) + Math.abs(p.y - d.start.y) < 2) return;
      useStore.getState().checkpoint();
      d.moved = true;
    }
    const store = useStore.getState();
    if (d.mode === 'move') {
      const a0 = viewToPdf(geom, d.start);
      const a1 = viewToPdf(geom, p);
      store.updateAnnotation(pageId, d.id, translatePatch(d.orig, a1.x - a0.x, a1.y - a0.y), { history: false });
    } else {
      const v = { ...d.orig, width: d.orig.width + p.x - d.start.x, height: d.orig.height + p.y - d.start.y };
      store.updateAnnotation(pageId, d.id, resizePatch(geom, v), { history: false });
    }
  }

  const onDoubleClick = (a: Annotation) => {
    if (a.type === 'text' && editable) {
      useStore.getState().checkpoint();
      useStore.getState().setEditing(a.id);
    } else if (a.type === 'note') {
      useStore.getState().setSidebar(useStore.getState().sidebar);
      document.getElementById('prop-text')?.focus();
    }
  };

  // Clicking empty page space in select mode clears the selection.
  useEffect(() => {
    if (!svgRef.current) return;
    const page = svgRef.current.parentElement!;
    const onDown = (e: PointerEvent) => {
      if (useStore.getState().tool === 'select' && !(e.target as Element).closest('.annot')) {
        const s = useStore.getState();
        if (s.selected?.pageId === pageId) s.select(null);
        if (s.selectedField && !(e.target as Element).closest('.field-box')) useStore.setState({ selectedField: null });
      }
    };
    page.addEventListener('pointerdown', onDown);
    return () => page.removeEventListener('pointerdown', onDown);
  }, [pageId]);

  const pageHits = hits.map((h, i) => ({ h, i })).filter(({ h }) => h.page === index);
  const S = scale;

  return (
    <svg
      ref={svgRef}
      className={`annot-layer ${drawing ? 'drawing' : ''} tool-${tool}`}
      width={width}
      height={height}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
    >
      {pageHits.map(({ h, i }) => {
        const v = pdfRectToView(geom, h.rect);
        return <rect key={`hit${i}`} className={`search-hit ${i === hitIndex ? 'current' : ''}`} x={v.left * S} y={v.top * S} width={v.width * S} height={v.height * S} />;
      })}
      {annots.map((a) => (
        <g
          key={a.id}
          className={`annot annot-${a.type}`}
          onPointerDown={(e) => startDrag(e, a, 'move')}
          onDoubleClick={() => onDoubleClick(a)}
        >
          <AnnotShape a={a} pageId={pageId} geom={geom} scale={S} editing={editing === a.id} />
          {a.comment || a.type === 'note' ? <title>{`${a.author}: ${a.type === 'note' ? a.text : a.comment}`}</title> : null}
        </g>
      ))}
      {selected && <Selection a={annots.find((a) => a.id === selected)} geom={geom} scale={S} onResize={startDrag} />}
      {draft && <DraftShape draft={draft} tool={tool} scale={S} />}
      {tool === 'stamp' && drawing && hover && !draft && <StampPreview at={hover} scale={S} pending={pending} geom={geom} />}
    </svg>
  );
});

/** The stamp hanging on the pointer: a custom image stamp or the current text stamp. */
function StampPreview({ at, scale: S, pending, geom }: { at: Pt; scale: number; pending: ReturnType<typeof usePendingStamp.getState>['stamp']; geom: PageGeom }) {
  if (pending) {
    const { width: w, height: h } = stampViewSize(pending, viewSize(geom));
    return <image className="stamp-preview" href={pending.src} x={(at.x - w / 2) * S} y={(at.y - h / 2) * S} width={w * S} height={h * S} preserveAspectRatio="none" />;
  }
  // Same drawing as a placed stamp (see AnnotShape), at the default size.
  const st = styleFor('stamp');
  const [w, h] = [160, 50];
  const label = (st.stampLabel || 'Approved').toUpperCase();
  let size = h * 0.55;
  const est = label.length * size * 0.68;
  if (est > w * 0.9) size *= (w * 0.9) / est;
  const left = at.x - w / 2;
  const top = at.y - h / 2;
  return (
    <g className="stamp-preview" transform={`scale(${S})`}>
      <rect x={left} y={top} width={w} height={h} fill="transparent" stroke={st.color} strokeWidth={3} />
      <text x={at.x} y={at.y + size * 0.35} fill={st.color} fontSize={size} fontFamily={FONT} fontWeight="bold" textAnchor="middle">{label}</text>
    </g>
  );
}

function constrain(start: Pt, p: Pt, tool: Tool): Pt {
  const dx = p.x - start.x;
  const dy = p.y - start.y;
  if (tool === 'line' || tool === 'arrow') {
    // Snap to multiples of 45°.
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return { x: start.x + Math.cos(ang) * len, y: start.y + Math.sin(ang) * len };
  }
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: start.x + Math.sign(dx) * m, y: start.y + Math.sign(dy) * m };
}

/** Drop points closer than 1pt to their predecessor to keep ink paths small. */
function simplify(points: Pt[]): Pt[] {
  const out = [points[0]];
  for (const p of points.slice(1)) {
    const q = out[out.length - 1];
    if (Math.hypot(p.x - q.x, p.y - q.y) >= 1) out.push(p);
  }
  if (out.length === 1) out.push(points[points.length - 1]);
  return out;
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, len: number): string {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const pts = [-1, 1].map((s) => {
    const t = ang + Math.PI + s * (Math.PI / 7);
    return `${x2 + Math.cos(t) * len},${y2 + Math.sin(t) * len}`;
  });
  return `M${pts[0]} L${x2},${y2} L${pts[1]}`;
}

function DraftShape({ draft, tool, scale: S }: { draft: NonNullable<Draft>; tool: Tool; scale: number }) {
  const st = styleFor(tool);
  if (draft.kind === 'ink') {
    return <polyline className="draft" points={draft.points.map((p) => `${p.x * S},${p.y * S}`).join(' ')} fill="none" stroke={st.color} strokeWidth={st.width * S} strokeLinecap="round" strokeLinejoin="round" opacity={st.opacity} />;
  }
  const { start, end } = draft;
  if (tool === 'line' || tool === 'arrow') {
    return (
      <g className="draft" stroke={st.color} strokeWidth={st.width * S} strokeLinecap="round" fill="none">
        <line x1={start.x * S} y1={start.y * S} x2={end.x * S} y2={end.y * S} />
        {tool === 'arrow' && <path d={arrowHead(start.x * S, start.y * S, end.x * S, end.y * S, Math.max(8, st.width * 4) * S)} />}
      </g>
    );
  }
  const r = rectFromPoints(start, end);
  const props = { x: r.x * S, y: r.y * S, width: r.w * S, height: r.h * S };
  if (tool === 'ellipse') {
    return <ellipse className="draft" cx={(r.x + r.w / 2) * S} cy={(r.y + r.h / 2) * S} rx={(r.w / 2) * S} ry={(r.h / 2) * S} fill={st.fill ?? 'none'} stroke={st.color} strokeWidth={st.width * S} />;
  }
  return <rect className="draft draft-box" {...props} fill={tool === 'rect' ? st.fill ?? 'none' : 'rgba(30,136,229,0.08)'} stroke={tool === 'rect' ? st.color : '#1e88e5'} strokeWidth={tool === 'rect' ? st.width * S : 1} strokeDasharray={tool === 'rect' ? undefined : '4 3'} />;
}

function Selection({ a, geom, scale: S, onResize }: { a?: Annotation; geom: PageGeom; scale: number; onResize: (e: RPointerEvent, a: Annotation, mode: 'move' | 'resize') => void }) {
  if (!a) return null;
  const v = viewBounds(a, geom);
  const pad = 3;
  return (
    <g className="selection">
      <rect x={v.left * S - pad} y={v.top * S - pad} width={v.width * S + 2 * pad} height={v.height * S + 2 * pad} />
      {hasRect(a) && (
        <rect className="handle annot" x={(v.left + v.width) * S - 5} y={(v.top + v.height) * S - 5} width={10} height={10} onPointerDown={(e) => onResize(e, a, 'resize')} />
      )}
    </g>
  );
}

const FONT = "'Noto Sans', 'Noto Sans Symbols 2', sans-serif";

function AnnotShape({ a, pageId, geom, scale: S, editing }: { a: Annotation; pageId: string; geom: PageGeom; scale: number; editing: boolean }) {
  const view = (p: Pt) => {
    const v = pdfToView(geom, p);
    return { x: v.x * S, y: v.y * S };
  };
  switch (a.type) {
    case 'highlight':
      return (
        <g opacity={a.opacity} style={{ mixBlendMode: 'multiply' }}>
          {a.rects.map((r, i) => {
            const v = pdfRectToView(geom, r);
            return <rect key={i} x={v.left * S} y={v.top * S} width={v.width * S} height={v.height * S} fill={a.color} />;
          })}
        </g>
      );
    case 'underline':
    case 'strikeout': {
      const fg = frameGeom(geom, a.rot);
      return (
        <g opacity={a.opacity} stroke={a.color} transform={`matrix(${frameMatrix(geom, fg, S).join(' ')})`}>
          {a.rects.map((r, i) => {
            const v = pdfRectToView(fg, r);
            const y = a.type === 'underline' ? v.top + v.height * 0.94 : v.top + v.height * 0.55;
            return (
              <g key={i}>
                <rect x={v.left} y={v.top} width={v.width} height={v.height} fill="transparent" stroke="none" />
                <line x1={v.left} x2={v.left + v.width} y1={y} y2={y} strokeWidth={Math.max(0.8, v.height * 0.07)} />
              </g>
            );
          })}
        </g>
      );
    }
    case 'ink':
      return (
        <g opacity={a.opacity}>
          {a.paths.map((path, i) => (
            <polyline key={i} points={path.map((p) => { const v = view(p); return `${v.x},${v.y}`; }).join(' ')} fill="none" stroke={a.color} strokeWidth={a.width * S} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {/* Wider invisible stroke makes thin lines easier to click. */}
          {a.paths.map((path, i) => (
            <polyline key={`hit${i}`} points={path.map((p) => { const v = view(p); return `${v.x},${v.y}`; }).join(' ')} fill="none" stroke="transparent" strokeWidth={Math.max(8, a.width * S)} />
          ))}
        </g>
      );
    case 'rect':
    case 'ellipse': {
      const v = pdfRectToView(geom, a.rect);
      const common = { stroke: a.color, strokeWidth: a.width * S, fill: a.fill ?? 'transparent', opacity: a.opacity };
      return a.type === 'rect' ? (
        <rect x={v.left * S} y={v.top * S} width={v.width * S} height={v.height * S} {...common} />
      ) : (
        <ellipse cx={(v.left + v.width / 2) * S} cy={(v.top + v.height / 2) * S} rx={(v.width / 2) * S} ry={(v.height / 2) * S} {...common} />
      );
    }
    case 'line':
    case 'arrow': {
      const p1 = view(a.p1);
      const p2 = view(a.p2);
      return (
        <g stroke={a.color} strokeWidth={a.width * S} strokeLinecap="round" fill="none" opacity={a.opacity}>
          <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} />
          <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="transparent" strokeWidth={Math.max(8, a.width * S)} />
          {a.type === 'arrow' && <path d={arrowHead(p1.x, p1.y, p2.x, p2.y, Math.max(8, a.width * 4) * S)} />}
        </g>
      );
    }
    case 'text': {
      const fg = frameGeom(geom, a.rot);
      const v = pdfRectToView(fg, a.rect);
      return (
        <g transform={`matrix(${frameMatrix(geom, fg, S).join(' ')})`}>
          <foreignObject x={v.left} y={v.top} width={v.width} height={v.height} opacity={a.opacity}>
            <TextBox a={a} pageId={pageId} scale={1} editing={editing} />
          </foreignObject>
        </g>
      );
    }
    case 'note': {
      const p = view(a.at);
      const s = NOTE_SIZE * S;
      return (
        <g transform={`translate(${p.x},${p.y}) scale(${s / 24})`}>
          <path d="M3 3h18v14H8l-5 4z" fill={a.color} stroke="#5d4037" strokeWidth={1.2} strokeLinejoin="round" />
          <path d="M7 8h10M7 12h7" stroke="#5d4037" strokeWidth={1.2} />
        </g>
      );
    }
    case 'image': {
      const fg = frameGeom(geom, a.rot);
      const v = pdfRectToView(fg, a.rect);
      return (
        <g transform={`matrix(${frameMatrix(geom, fg, S).join(' ')})`}>
          <image href={a.src} x={v.left} y={v.top} width={v.width} height={v.height} preserveAspectRatio="none" opacity={a.opacity} />
        </g>
      );
    }
    case 'stamp': {
      const fg = frameGeom(geom, a.rot);
      const v = pdfRectToView(fg, a.rect);
      const label = a.label.toUpperCase();
      let size = v.height * 0.55;
      const est = label.length * size * 0.68;
      if (est > v.width * 0.9) size *= (v.width * 0.9) / est;
      return (
        <g opacity={a.opacity} transform={`matrix(${frameMatrix(geom, fg, S).join(' ')})`}>
          <rect x={v.left} y={v.top} width={v.width} height={v.height} fill="transparent" stroke={a.color} strokeWidth={3} />
          <text x={v.left + v.width / 2} y={v.top + v.height / 2 + size * 0.35} fill={a.color} fontSize={size} fontFamily={FONT} fontWeight="bold" textAnchor="middle">
            {label}
          </text>
        </g>
      );
    }
    case 'redact': {
      const v = pdfRectToView(geom, a.rect);
      return <rect className="redact-mark" x={v.left * S} y={v.top * S} width={v.width * S} height={v.height * S} />;
    }
  }
}

function TextBox({ a, pageId, scale, editing }: { a: Extract<Annotation, { type: 'text' }>; pageId: string; scale: number; editing: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const t = useT();
  const style = {
    fontSize: a.fontSize * scale,
    color: a.color,
    fontFamily: FONT,
    lineHeight: 1.2,
    padding: 4 * scale,
    border: a.border ? `${scale}px solid ${a.color}` : undefined,
  };
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  if (!editing) {
    return (
      <div className={`textbox ${a.text ? '' : 'empty'}`} style={style}>
        {a.text || t('Double-click to edit')}
      </div>
    );
  }
  const finish = () => {
    const s = useStore.getState();
    if (s.editing === a.id) s.setEditing(null);
  };
  return (
    <textarea
      ref={ref}
      className="textbox editing"
      style={style}
      value={a.text}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        useStore.getState().updateAnnotation(pageId, a.id, { text: e.target.value }, { history: false });
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
      }}
    />
  );
}
