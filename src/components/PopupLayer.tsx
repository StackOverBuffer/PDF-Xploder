/**
 * Comment popups on the page, as in PDF-XChange: a small window with the comment's
 * author, date, text and replies, opened by double-clicking a comment. Popups keep their
 * size when zooming and may reach past the page edge.
 */
import { memo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { X } from 'lucide-react';
import { uid, useStore } from '../store/store';
import { useCan } from '../store/permissions';
import { ANNOT_LABELS, viewBounds } from '../lib/annotGeom';
import { POPUP_MIN_H, POPUP_MIN_W, popupBox, popupText, toRect } from '../lib/popups';
import { placePopup, setPopupOpen } from '../store/popups';
import { useT } from '../lib/i18n';
import type { Annotation, PageGeom } from '../lib/types';

interface Props {
  pageId: string;
  geom: PageGeom;
  scale: number;
}

const EMPTY: Annotation[] = [];

export const PopupLayer = memo(function PopupLayer({ pageId, geom, scale }: Props) {
  const annots = useStore((s) => s.annotations[pageId] ?? EMPTY);
  const selected = useStore((s) => (s.selected?.pageId === pageId ? s.selected.id : null));
  const [hover, setHover] = useState<string | null>(null);
  const open = annots.filter((a) => a.popup?.open && a.popup.rect);
  if (!open.length) return null;
  // The line from a popup to its comment, while either is in focus.
  const linked = open.find((a) => a.id === hover || a.id === selected);
  return (
    <div className="popup-layer">
      {linked && <Connector a={linked} geom={geom} scale={scale} />}
      {open.map((a) => (
        <Popup key={a.id} a={a} pageId={pageId} geom={geom} scale={scale} selected={a.id === selected} onHover={(h) => setHover(h ? a.id : null)} />
      ))}
    </div>
  );
});

function Connector({ a, geom, scale: S }: { a: Annotation; geom: PageGeom; scale: number }) {
  const b = viewBounds(a, geom);
  const p = popupBox(a.popup!.rect!, geom);
  const cx = (b.left + b.width / 2) * S;
  const cy = (b.top + b.height / 2) * S;
  // From the popup's nearer side.
  const px = p.left * S + (cx < p.left * S ? 0 : p.width);
  const py = p.top * S + 12;
  return (
    <svg className="popup-connector" aria-hidden>
      <line x1={px} y1={py} x2={cx} y2={cy} stroke={a.color} />
      <circle cx={cx} cy={cy} r={3} fill={a.color} />
    </svg>
  );
}

type Drag = { mode: 'move' | 'resize'; x: number; y: number; left: number; top: number; w: number; h: number; moved: boolean };

function Popup({ a, pageId, geom, scale: S, selected, onHover }: { a: Annotation; pageId: string; geom: PageGeom; scale: number; selected: boolean; onHover: (h: boolean) => void }) {
  const t = useT();
  const editable = useCan('annotate');
  const author = useStore((s) => s.author);
  const [reply, setReply] = useState('');
  const drag = useRef<Drag | null>(null);
  const box = popupBox(a.popup!.rect!, geom);
  const text = popupText(a);

  const select = () => {
    const s = useStore.getState();
    if (s.selected?.id !== a.id) s.select({ pageId, id: a.id });
  };
  const start = (mode: Drag['mode']) => (e: RPointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    select();
    drag.current = { mode, x: e.clientX, y: e.clientY, left: box.left, top: box.top, w: box.width, h: box.height, moved: false };
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 3) return;
      // One undo point for the whole drag.
      if (editable) useStore.getState().checkpoint();
      d.moved = true;
    }
    if (!editable) return;
    const rect =
      d.mode === 'move'
        ? toRect(geom, d.left + dx / S, d.top + dy / S, d.w, d.h)
        : toRect(geom, d.left, d.top, Math.max(POPUP_MIN_W, d.w + dx), Math.max(POPUP_MIN_H, d.h + dy));
    placePopup(pageId, a.id, rect, { history: false });
  };
  const end = () => (drag.current = null);

  const setText = (value: string) => useStore.getState().updateAnnotation(pageId, a.id, a.type === 'note' ? { text: value } : { comment: value || undefined }, { history: false });
  const send = () => {
    const body = reply.trim();
    if (!body) return;
    useStore.getState().updateAnnotation(pageId, a.id, { replies: [...(a.replies ?? []), { id: uid('reply'), author, text: body, createdAt: Date.now() }] });
    setReply('');
  };

  return (
    <div
      className={`annot-popup ${selected ? 'selected' : ''}`}
      data-id={a.id}
      style={{ left: box.left * S, top: box.top * S, width: box.width, height: box.height, ['--popup-color' as string]: a.color }}
      onPointerDown={(e) => {
        // Not the page underneath (selection, drawing, panning).
        e.stopPropagation();
        select();
      }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setPopupOpen(pageId, a.id, false);
        }
      }}
    >
      <div className="popup-head" onPointerDown={start('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <b className="popup-title">{a.subject ?? t(ANNOT_LABELS[a.type])}</b>
        <span className="popup-meta" title={new Date(a.createdAt).toLocaleString()}>{a.author || t('Unknown')} · {new Date(a.createdAt).toLocaleDateString()}</span>
        <button className="popup-close" title={t('Close popup')} aria-label={t('Close popup')} onClick={() => setPopupOpen(pageId, a.id, false)}><X size={12} /></button>
      </div>
      <textarea
        className="popup-text"
        value={text}
        readOnly={!editable}
        placeholder={editable ? t('Add a comment…') : ''}
        aria-label={t('Comment text')}
        onFocus={() => {
          select();
          useStore.getState().armCheckpoint();
        }}
        onChange={(e) => setText(e.target.value)}
      />
      {!!a.replies?.length && (
        <div className="popup-replies">
          {a.replies.map((r) => (
            <div key={r.id} className="popup-reply">
              <span className="muted small">{r.author || t('Unknown')} · {new Date(r.createdAt).toLocaleDateString()}</span>
              <div>{r.text}</div>
            </div>
          ))}
        </div>
      )}
      {editable && (
        <input
          className="popup-reply-input"
          value={reply}
          placeholder={t('Write a reply…')}
          aria-label={t('Reply')}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              send();
            }
          }}
        />
      )}
      <div className="popup-grip" onPointerDown={start('resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden />
    </div>
  );
}
