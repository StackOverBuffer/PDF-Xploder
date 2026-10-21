import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { applyContentEdits, matchesFilter, pageObjects } from '../store/content';
import { useCan } from '../store/permissions';
import { pdfRectToView, pdfToView, viewToPdf, type VRect } from '../lib/geometry';
import { IDENTITY, about, apply, inv, mul, rotate, scale as scaleM, translate, type M } from '../lib/content/matrix';
import type { ObjectInfo } from '../lib/content/page';
import { useContextMenu } from './Menu';
import { objectMenu } from './contextMenus';
import * as ca from '../store/contentActions';
import type { PageGeom, Pt } from '../lib/types';

interface Props {
  index: number;
  geom: PageGeom;
  scale: number;
  width: number;
  height: number;
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot';

type TransformDrag = { mode: 'move' | 'scale' | 'rotate'; start: Pt; box: VRect; handle?: Handle; t: M; moved: boolean; ghost?: string };
type AreaDrag = { mode: 'marquee' | 'draw'; start: Pt; end: Pt };
type Drag = TransformDrag | AreaDrag;
const isArea = (d: Drag): d is AreaDrag => d.mode === 'marquee' || d.mode === 'draw';

/** user → view (scale 1) matrix for a page. */
export function viewMatrix(g: PageGeom): M {
  const o = pdfToView(g, { x: 0, y: 0 });
  const ax = pdfToView(g, { x: 1, y: 0 });
  const ay = pdfToView(g, { x: 0, y: 1 });
  return [ax.x - o.x, ax.y - o.y, ay.x - o.x, ay.y - o.y, o.x, o.y];
}

/** Express a view-space transform as a user-space one. */
export function toUser(g: PageGeom, t: M): M {
  const p2v = viewMatrix(g);
  return mul(mul(p2v, t), inv(p2v) ?? IDENTITY);
}

const unionV = (rs: VRect[]): VRect => {
  const l = Math.min(...rs.map((r) => r.left));
  const t = Math.min(...rs.map((r) => r.top));
  const r = Math.max(...rs.map((v) => v.left + v.width));
  const b = Math.max(...rs.map((v) => v.top + v.height));
  return { left: l, top: t, width: r - l, height: b - t };
};

const contains = (r: VRect, p: Pt, pad = 1.5) => p.x >= r.left - pad && p.x <= r.left + r.width + pad && p.y >= r.top - pad && p.y <= r.top + r.height + pad;
const intersects = (a: VRect, b: VRect) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
function handlePos(b: VRect, h: Handle): Pt {
  const x = h.includes('w') ? b.left : h.includes('e') ? b.left + b.width : b.left + b.width / 2;
  const y = h.includes('n') ? b.top : h.includes('s') ? b.top + b.height : b.top + b.height / 2;
  return { x, y };
}
const opposite: Record<string, Handle> = { nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' };

/** Crop the rendered page canvas to a view-space box (for a drag preview). */
function snapshot(pageEl: HTMLElement | null, box: VRect, zoom: number): string | undefined {
  const canvas = pageEl?.querySelector<HTMLCanvasElement>('.canvas-host canvas');
  if (!canvas) return undefined;
  const k = canvas.width / (pageEl!.clientWidth || 1);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(box.width * zoom * k));
  out.height = Math.max(1, Math.round(box.height * zoom * k));
  out.getContext('2d')!.drawImage(canvas, box.left * zoom * k, box.top * zoom * k, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL();
}

/**
 * Arrow-key nudges are merged: holding a key would otherwise rewrite the document
 * for every repeat. The sum is applied once the keys rest for a moment.
 */
let nudge: { page: number; ids: number[]; dx: number; dy: number; geom: PageGeom } | null = null;
let nudgeTimer = 0;
function queueNudge(page: number, ids: number[], [dx, dy]: [number, number], geom: PageGeom) {
  if (nudge && (nudge.page !== page || nudge.ids.join() !== ids.join())) flushNudge();
  nudge = nudge ? { ...nudge, dx: nudge.dx + dx, dy: nudge.dy + dy } : { page, ids, dx, dy, geom };
  clearTimeout(nudgeTimer);
  nudgeTimer = window.setTimeout(flushNudge, 180);
}
function flushNudge() {
  const n = nudge;
  nudge = null;
  if (n && (n.dx || n.dy)) applyContentEdits(n.page, [{ type: 'transform', ids: n.ids, m: toUser(n.geom, translate(n.dx, n.dy)) }]);
}

export const ContentLayer = memo(function ContentLayer({ index, geom, scale: S, width, height }: Props) {
  const tool = useStore((s) => s.tool);
  const filter = useStore((s) => s.contentFilter);
  const docVersion = useStore((s) => s.docVersion);
  const selection = useStore((s) => (s.contentSelection?.page === index ? s.contentSelection.ids : null));
  const editing = useStore((s) => (s.contentEditing?.page === index ? s.contentEditing : null));
  const canEdit = useCan('modify');
  const [objects, setObjects] = useState<ObjectInfo[] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menu = useContextMenu();

  useEffect(() => {
    let live = true;
    setObjects(null);
    pageObjects(index).then((o) => live && setObjects(o)).catch(() => live && setObjects([]));
    return () => {
      live = false;
    };
  }, [index, docVersion]);

  const visible = useMemo(() => (objects ?? []).filter((o) => matchesFilter(o, filter)), [objects, filter]);
  const vbox = (o: ObjectInfo) => pdfRectToView(geom, o.bbox);
  const selected = (objects ?? []).filter((o) => selection?.includes(o.id));
  const selBox = selected.length ? unionV(selected.map(vbox)) : null;

  const pt = (e: { clientX: number; clientY: number }): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / S, y: (e.clientY - r.top) / S };
  };
  const select = (ids: number[]) => useStore.setState({ contentSelection: ids.length ? { page: index, ids } : null, selected: null });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = pt(e);
    if (tool === 'contentText') {
      if (!canEdit) return;
      // The click marks the top-left of the new line; the baseline sits one line lower.
      e.preventDefault();
      const at = viewToPdf(geom, { x: p.x, y: p.y + useStore.getState().styles.text.fontSize });
      useStore.setState({ contentEditing: { page: index, at } });
      return;
    }
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    if (tool !== 'content') {
      setDrag({ mode: 'draw', start: p, end: p });
      return;
    }
    if (!objects) return;
    const handle = (e.target as Element).getAttribute('data-handle') as Handle | null;
    if (handle && selBox && canEdit) {
      setDrag({ mode: handle === 'rot' ? 'rotate' : 'scale', start: p, box: selBox, handle, t: IDENTITY, moved: false });
      return;
    }
    const hit = [...visible].reverse().find((o) => contains(vbox(o), p));
    if (hit) {
      let ids = selection ?? [];
      if (e.shiftKey || e.ctrlKey || e.metaKey) ids = ids.includes(hit.id) ? ids.filter((i) => i !== hit.id) : [...ids, hit.id];
      else if (!ids.includes(hit.id)) ids = [hit.id];
      select(ids);
      const box = unionV((objects ?? []).filter((o) => ids.includes(o.id)).map(vbox));
      if (canEdit && ids.includes(hit.id)) setDrag({ mode: 'move', start: p, box, t: IDENTITY, moved: false });
      return;
    }
    if (!(e.shiftKey || e.ctrlKey)) select([]);
    setDrag({ mode: 'marquee', start: p, end: p });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pt(e);
    if (!drag) {
      if (tool === 'content') setHover([...visible].reverse().find((o) => contains(vbox(o), p))?.id ?? null);
      return;
    }
    if (isArea(drag)) {
      setDrag({ ...drag, end: p });
      return;
    }
    const td = drag;
    const { start, box } = td;
    let t: M = IDENTITY;
    if (td.mode === 'move') {
      let dx = p.x - start.x;
      let dy = p.y - start.y;
      if (e.shiftKey) (Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0));
      t = translate(dx, dy);
    } else if (td.mode === 'rotate') {
      const c = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      let deg = ((Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(start.y - c.y, start.x - c.x)) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      t = about(rotate(deg), c.x, c.y);
    } else {
      const h = td.handle as Exclude<Handle, 'rot'>;
      const a = handlePos(box, opposite[h]);
      const h0 = handlePos(box, h);
      let sx = h === 'n' || h === 's' ? 1 : (p.x - a.x) / (h0.x - a.x || 1);
      let sy = h === 'e' || h === 'w' ? 1 : (p.y - a.y) / (h0.y - a.y || 1);
      // Corner handles: pictures keep their proportions (Shift: freely), other objects with Shift.
      const pictures = selected.length > 0 && selected.every((o) => o.kind === 'image');
      if (h.length === 2 && pictures !== e.shiftKey) sx = sy = Math.max(Math.abs(sx), Math.abs(sy)) * Math.sign(sx || 1);
      if (Math.abs(sx) < 0.02) sx = 0.02 * Math.sign(sx || 1);
      if (Math.abs(sy) < 0.02) sy = 0.02 * Math.sign(sy || 1);
      t = about(scaleM(sx, sy), a.x, a.y);
    }
    const moved = td.moved || Math.abs(p.x - start.x) + Math.abs(p.y - start.y) > 1;
    // The picture of the objects that follows the pointer is made once the drag really starts
    // (encoding it on every click would make selecting slow).
    const ghost = td.ghost ?? (moved ? snapshot(ref.current!.parentElement, box, S) : undefined);
    setDrag({ ...td, t, moved, ghost });
  };

  const onPointerUp = () => {
    const d = drag;
    setDrag(null);
    if (!d || !objects) return;
    if (d.mode === 'marquee' && isArea(d)) {
      const box: VRect = { left: Math.min(d.start.x, d.end.x), top: Math.min(d.start.y, d.end.y), width: Math.abs(d.end.x - d.start.x), height: Math.abs(d.end.y - d.start.y) };
      if (box.width < 2 && box.height < 2) return;
      const ids = visible.filter((o) => intersects(vbox(o), box)).map((o) => o.id);
      const prev = useStore.getState().contentSelection?.page === index ? useStore.getState().contentSelection!.ids : [];
      select([...new Set([...prev, ...ids])]);
      return;
    }
    if (d.mode === 'draw' && isArea(d)) {
      if (!canEdit) return;
      const shape = tool === 'contentEllipse' ? 'ellipse' : tool === 'contentLine' ? 'line' : 'rect';
      const st = useStore.getState().styles.rect;
      let a = d.start;
      let b = d.end;
      if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) < 3) b = { x: a.x + 100, y: a.y + (shape === 'line' ? 0 : 60) };
      if (shape !== 'line') [a, b] = [{ x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) }, { x: Math.max(a.x, b.x), y: Math.min(a.y, b.y) }];
      const p1 = viewToPdf(geom, a);
      const p2 = viewToPdf(geom, b);
      const rect = shape === 'line' ? { x: p1.x, y: p1.y, w: p2.x - p1.x, h: p2.y - p1.y } : { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y) };
      useStore.getState().setTool('content');
      applyContentEdits(index, [{ type: 'addShape', shape, rect, stroke: st.color, fill: st.fill, width: st.width }]);
      return;
    }
    if (isArea(d) || !d.moved || !selection) return;
    applyContentEdits(index, [{ type: 'transform', ids: selection, m: toUser(geom, d.t) }]);
  };

  const onContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (tool !== 'content' || !objects) return;
    const p = pt(e);
    const ev = { clientX: e.clientX, clientY: e.clientY, preventDefault() {} };
    const hit = [...visible].reverse().find((o) => contains(vbox(o), p));
    let ids = selection ?? [];
    if (hit && !ids.includes(hit.id)) ids = [hit.id];
    if (!hit) ids = selBox && contains(selBox, p) ? ids : [];
    select(ids);
    const layers = await ca.documentLayers().catch(() => []);
    menu.open(ev, objectMenu(index, geom, objects.filter((o) => ids.includes(o.id)), layers, p));
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool !== 'content' || !canEdit) return;
    const p = pt(e);
    const hit = [...visible].reverse().find((o) => o.kind === 'text' && contains(vbox(o), p));
    if (hit) useStore.setState({ contentEditing: { page: index, id: hit.id }, contentSelection: { page: index, ids: [hit.id] } });
  };

  // Keyboard: nudge, delete, duplicate, select all.
  useEffect(() => {
    if (tool !== 'content') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
      const s = useStore.getState();
      const sel = s.contentSelection;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && s.currentPage === index && objects) {
        e.preventDefault();
        select(visible.map((o) => o.id));
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'v' && s.currentPage === index && ca.hasObjectClipboard()) {
        e.preventDefault();
        ca.pasteObjects(index, { inPlace: e.shiftKey });
        return;
      }
      if (!sel || sel.page !== index) return;
      if (mod && key === 'c' && !e.shiftKey && !window.getSelection()?.toString()) {
        e.preventDefault();
        ca.copyObjects();
        return;
      }
      if (!canEdit) return;
      if (mod && key === 'x') {
        e.preventDefault();
        ca.cutObjects();
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (nudge[e.key]) {
        e.preventDefault();
        queueNudge(index, sel.ids, nudge[e.key], geom);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopImmediatePropagation();
        applyContentEdits(index, [{ type: 'delete', ids: sel.ids }]);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const off = apply(toUser(geom, translate(10, 10)), 0, 0);
        const o0 = apply(toUser(geom, IDENTITY), 0, 0);
        applyContentEdits(index, [{ type: 'duplicate', ids: sel.ids, dx: off.x - o0.x, dy: off.y - o0.y }]);
      } else if (e.key === 'Escape') {
        useStore.setState({ contentSelection: null, contentEditing: null });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tool, index, objects, visible, canEdit, geom]);

  const poly = (b: VRect, t: M) =>
    [apply(t, b.left, b.top), apply(t, b.left + b.width, b.top), apply(t, b.left + b.width, b.top + b.height), apply(t, b.left, b.top + b.height)]
      .map((q) => `${q.x * S},${q.y * S}`)
      .join(' ');

  const dragT = drag && !isArea(drag) ? drag.t : IDENTITY;
  const hovered = hover !== null && !selection?.includes(hover) ? visible.find((o) => o.id === hover) : undefined;

  return (
    <div
      ref={ref}
      className={`content-layer tool-${tool}`}
      style={{ width, height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {drag && !isArea(drag) && drag.ghost && drag.moved && (
        <img
          className="content-ghost"
          src={drag.ghost}
          alt=""
          style={{
            left: drag.box.left * S,
            top: drag.box.top * S,
            width: drag.box.width * S,
            height: drag.box.height * S,
            transformOrigin: `${-drag.box.left * S}px ${-drag.box.top * S}px`,
            transform: `matrix(${dragT[0]},${dragT[1]},${dragT[2]},${dragT[3]},${dragT[4] * S},${dragT[5] * S})`,
          }}
        />
      )}
      <svg width={width} height={height}>
        {tool === 'content' && objects === null && <text x={8} y={16} className="content-loading">Reading page…</text>}
        {hovered && <polygon className="obj-hover" points={poly(vbox(hovered), IDENTITY)} />}
        {selected.map((o) => <polygon key={o.id} className="obj-selected" points={poly(vbox(o), dragT)} />)}
        {selBox && !editing && (
          <g className="sel-box">
            <polygon points={poly(selBox, dragT)} />
            {canEdit && !drag && (
              <>
                {HANDLES.map((h) => {
                  const q = handlePos(selBox, h);
                  return <rect key={h} data-handle={h} className={`handle h-${h}`} x={q.x * S - 4} y={q.y * S - 4} width={8} height={8} />;
                })}
                <line x1={(selBox.left + selBox.width / 2) * S} y1={selBox.top * S} x2={(selBox.left + selBox.width / 2) * S} y2={selBox.top * S - 22} />
                <circle data-handle="rot" className="handle rot" cx={(selBox.left + selBox.width / 2) * S} cy={selBox.top * S - 26} r={5} />
              </>
            )}
          </g>
        )}
        {drag && isArea(drag) && (
          tool === 'contentLine' ? (
            <line className="marquee" x1={drag.start.x * S} y1={drag.start.y * S} x2={drag.end.x * S} y2={drag.end.y * S} />
          ) : tool === 'contentEllipse' ? (
            <ellipse className="marquee" cx={((drag.start.x + drag.end.x) / 2) * S} cy={((drag.start.y + drag.end.y) / 2) * S} rx={(Math.abs(drag.end.x - drag.start.x) / 2) * S} ry={(Math.abs(drag.end.y - drag.start.y) / 2) * S} />
          ) : (
            <rect className="marquee" x={Math.min(drag.start.x, drag.end.x) * S} y={Math.min(drag.start.y, drag.end.y) * S} width={Math.abs(drag.end.x - drag.start.x) * S} height={Math.abs(drag.end.y - drag.start.y) * S} />
          )
        )}
      </svg>
      {editing && <InlineTextEditor index={index} geom={geom} scale={S} objects={objects ?? []} editing={editing} />}
      {menu.element}
    </div>
  );
});

function InlineTextEditor({ index, geom, scale: S, objects, editing }: { index: number; geom: PageGeom; scale: number; objects: ObjectInfo[]; editing: { id?: number; at?: Pt } }) {
  const obj = editing.id !== undefined ? objects.find((o) => o.id === editing.id) : undefined;
  const [value, setValue] = useState(obj?.text ?? '');
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const style = useStore.getState().styles.text;
  const size = obj?.fontSize ?? style.fontSize;
  const box: VRect = obj
    ? pdfRectToView(geom, obj.bbox)
    : (() => {
        const v = pdfToView(geom, editing.at!);
        return { left: v.x, top: v.y - size, width: 240, height: size * 1.3 };
      })();
  const commit = () => {
    if (done.current) return;
    done.current = true;
    useStore.setState({ contentEditing: null });
    if (obj) {
      if (value !== obj.text) applyContentEdits(index, [{ type: 'text', id: obj.id, text: value }]);
    } else if (value.trim()) {
      useStore.getState().setTool('content');
      applyContentEdits(index, [{ type: 'addText', at: editing.at!, text: value, size: style.fontSize, color: style.color, font: 'NotoSans' }]);
    }
  };
  return (
    <input
      ref={ref}
      className="content-text-editor"
      value={value}
      style={{ left: box.left * S - 2, top: box.top * S - 2, minWidth: Math.max(80, box.width * S + 24), height: Math.max(18, box.height * S + 4), fontSize: size * S * 0.92, color: obj?.fill ?? style.color }}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          done.current = true;
          useStore.setState({ contentEditing: null });
        }
      }}
      onBlur={commit}
    />
  );
}
