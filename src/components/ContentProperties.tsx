import { useEffect, useState, useRef } from 'react';
import {
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, BringToFront, SendToBack, ArrowUp, ArrowDown,
  RotateCcw, RotateCw, FlipHorizontal2, FlipVertical2, Copy, Trash2, ImageUp, Download, Scissors,
} from 'lucide-react';
import { useStore } from '../store/store';
import { applyContentEdits, exportRegionAsImage, imageBytes, pageObjects } from '../store/content';
import { useCan } from '../store/permissions';
import { normaliseImage } from '../store/commands';
import { pickFile, readAsDataUrl } from '../lib/download';
import { about, rotate, scale as scaleM, translate, type M } from '../lib/content/matrix';
import type { ContentEdit, FontChoice, ObjectInfo } from '../lib/content/page';
import type { Rect } from '../lib/types';
import { pdfRectToView } from '../lib/geometry';
import { toUser } from './ContentLayer';
import { tf, useT } from '../lib/i18n';

/** `t(key)`, or `en` while `key` has no translation: for words whose plain key ("Fill") means something else in the ribbon. */
const tOr = (t: (s: string) => string, key: string, en: string) => (t(key) === key ? en : t(key));

/** English labels (translation keys); the lower-case form also names exported files. */
const KIND: Record<ObjectInfo['kind'], string> = { text: 'Text', path: 'Shape', image: 'Image', form: 'Form XObject', shading: 'Shading' };
const FONTS: [FontChoice, string][] = [
  ['NotoSans', 'Noto Sans'], ['NotoSans-Bold', 'Noto Sans Bold'], ['Helvetica', 'Helvetica'], ['Helvetica-Bold', 'Helvetica Bold'],
  ['Times-Roman', 'Times'], ['Times-Bold', 'Times Bold'], ['Courier', 'Courier'],
];

function NumberField({ label, value, onCommit, step = 1, disabled, suffix }: { label: string; value: number; onCommit: (v: number) => void; step?: number; disabled?: boolean; suffix?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(Math.round(value * 100) / 100)), [value]);
  const commit = () => {
    const n = Number(v);
    if (Number.isFinite(n) && Math.abs(n - value) > 1e-6) onCommit(n);
  };
  return (
    <label className="prop num-prop">
      <span className="prop-label">{label}{suffix && <span className="muted"> {suffix}</span>}</span>
      {/* Enter commits by leaving the field, so the change is applied once (not again on blur). */}
      <input type="number" step={step} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
    </label>
  );
}

function ColorField({ label, value, onChange, allowNone, disabled }: { label: string; value?: string; onChange: (c: string | null) => void; allowNone?: boolean; disabled?: boolean }) {
  const t = useT();
  return (
    <div className="prop">
      <span className="prop-label">{label}</span>
      <div className="swatches">
        {allowNone && <button disabled={disabled} className={`swatch-btn none ${!value ? 'active' : ''}`} title={t('None')} onClick={() => onChange(null)} />}
        {['#000000', '#ffffff', '#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#757575'].map((c) => (
          <button key={c} disabled={disabled} className={`swatch-btn ${value === c ? 'active' : ''}`} style={{ background: c }} onClick={() => onChange(c)} />
        ))}
        <PickedColor disabled={disabled} value={value ?? '#000000'} onPick={onChange} />
      </div>
    </div>
  );
}

/**
 * Colour input that applies the colour once it is chosen (the native change event),
 * not for every step while the picker is dragged: each change rewrites the page.
 */
function PickedColor({ value, onPick, disabled }: { value: string; onPick: (c: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const el = ref.current!;
    const onChange = () => pick.current(el.value);
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);
  return <input ref={ref} type="color" disabled={disabled} value={v} onChange={(e) => setV(e.target.value)} />;
}

const union = (rs: Rect[]): Rect => {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};

export function ContentProperties() {
  const sel = useStore((s) => s.contentSelection);
  const docVersion = useStore((s) => s.docVersion);
  const geoms = useStore((s) => s.geoms);
  const canEdit = useCan('modify');
  const [objects, setObjects] = useState<ObjectInfo[]>([]);
  const t = useT();

  useEffect(() => {
    let live = true;
    if (sel) pageObjects(sel.page).then((o) => live && setObjects(o));
    return () => {
      live = false;
    };
  }, [sel?.page, docVersion]);

  if (!sel) return null;
  const chosen = objects.filter((o) => sel.ids.includes(o.id));
  if (!chosen.length) return <div className="props-body"><p className="muted small">{t('Loading…')}</p></div>;
  const page = sel.page;
  const g = geoms[page];
  const box = union(chosen.map((o) => o.bbox));
  const edit = (...edits: ContentEdit[]) => applyContentEdits(page, edits);
  const ids = sel.ids;
  const one = chosen.length === 1 ? chosen[0] : undefined;
  const texts = chosen.filter((o) => o.kind === 'text');
  const paths = chosen.filter((o) => o.kind === 'path');
  // Rotation and flips act as seen on screen, about the selection's centre.
  const viewTransform = (m: M) => {
    const v = pdfRectToView(g, box);
    return toUser(g, about(m, v.left + v.width / 2, v.top + v.height / 2));
  };

  /** Align each object's edge or centre to the selection's (or the page's, for one object). */
  const align = (how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => {
    const ref = one ? { x: g.view[0], y: g.view[1], w: g.view[2] - g.view[0], h: g.view[3] - g.view[1] } : box;
    edit(...chosen.map((o): ContentEdit => {
      const b = o.bbox;
      const dx = how === 'left' ? ref.x - b.x : how === 'right' ? ref.x + ref.w - (b.x + b.w) : how === 'hcenter' ? ref.x + ref.w / 2 - (b.x + b.w / 2) : 0;
      const dy = how === 'bottom' ? ref.y - b.y : how === 'top' ? ref.y + ref.h - (b.y + b.h) : how === 'vcenter' ? ref.y + ref.h / 2 - (b.y + b.h / 2) : 0;
      return { type: 'transform', ids: [o.id], m: translate(dx, dy) };
    }));
  };

  const distribute = (axis: 'x' | 'y') => {
    const sorted = [...chosen].sort((a, b) => (axis === 'x' ? a.bbox.x - b.bbox.x : a.bbox.y - b.bbox.y));
    const size = (o: ObjectInfo) => (axis === 'x' ? o.bbox.w : o.bbox.h);
    const start = axis === 'x' ? box.x : box.y;
    const total = sorted.reduce((n, o) => n + size(o), 0);
    const gap = ((axis === 'x' ? box.w : box.h) - total) / (sorted.length - 1);
    let at = start;
    edit(...sorted.map((o): ContentEdit => {
      const d = at - (axis === 'x' ? o.bbox.x : o.bbox.y);
      at += size(o) + gap;
      return { type: 'transform', ids: [o.id], m: axis === 'x' ? translate(d, 0) : translate(0, d) };
    }));
  };

  const sameSize = (dim: 'w' | 'h') => {
    const target = chosen[0].bbox[dim];
    edit(...chosen.slice(1).map((o): ContentEdit => {
      const k = target / (o.bbox[dim] || 1);
      return { type: 'transform', ids: [o.id], m: about(dim === 'w' ? scaleM(k, 1) : scaleM(1, k), o.bbox.x, o.bbox.y) };
    }));
  };

  const replaceImage = async () => {
    const [f] = await pickFile('image/*');
    if (!f || !one) return;
    const img = await normaliseImage(await readAsDataUrl(f));
    edit({ type: 'replaceImage', id: one.id, image: imageBytes(img.src) });
  };

  return (
    <fieldset className="props-body" disabled={!canEdit}>
      <div className="props-head">
        <b>{one ? t(KIND[one.kind]) : tf('{n} objects', { n: chosen.length })}</b>
        <span className="muted small">{tf('Page {n}', { n: page + 1 })}{one?.fontName ? ` · ${one.fontName}` : ''}{chosen.some((o) => o.clipped) ? ` · ${t('clipped')}` : ''}</span>
      </div>
      {!canEdit && <p className="muted small">{t('This document’s security settings do not allow changing it.')}</p>}

      <div className="prop-grid">
        <NumberField label="X" suffix="pt" value={box.x} onCommit={(v) => edit({ type: 'transform', ids, m: translate(v - box.x, 0) })} />
        <NumberField label="Y" suffix="pt" value={box.y} onCommit={(v) => edit({ type: 'transform', ids, m: translate(0, v - box.y) })} />
        <NumberField label={t('Width')} suffix="pt" value={box.w} onCommit={(v) => box.w && edit({ type: 'transform', ids, m: about(scaleM(v / box.w, 1), box.x, box.y) })} />
        <NumberField label={t('Height')} suffix="pt" value={box.h} onCommit={(v) => box.h && edit({ type: 'transform', ids, m: about(scaleM(1, v / box.h), box.x, box.y) })} />
      </div>
      <NumberField label={t('Rotate by')} suffix="°" value={0} onCommit={(v) => edit({ type: 'transform', ids, m: viewTransform(rotate(v)) })} />

      <div className="icon-row">
        <button title={t('Rotate left')} onClick={() => edit({ type: 'transform', ids, m: viewTransform(rotate(-90)) })}><RotateCcw size={15} /></button>
        <button title={t('Rotate right')} onClick={() => edit({ type: 'transform', ids, m: viewTransform(rotate(90)) })}><RotateCw size={15} /></button>
        <button title={t('Flip horizontally')} onClick={() => edit({ type: 'transform', ids, m: viewTransform(scaleM(-1, 1)) })}><FlipHorizontal2 size={15} /></button>
        <button title={t('Flip vertically')} onClick={() => edit({ type: 'transform', ids, m: viewTransform(scaleM(1, -1)) })}><FlipVertical2 size={15} /></button>
        <span className="spacer" />
        <button title={t('Bring to front')} onClick={() => edit({ type: 'arrange', ids, to: 'front' })}><BringToFront size={15} /></button>
        <button title={t('Bring forward')} onClick={() => edit({ type: 'arrange', ids, to: 'forward' })}><ArrowUp size={15} /></button>
        <button title={t('Send backward')} onClick={() => edit({ type: 'arrange', ids, to: 'backward' })}><ArrowDown size={15} /></button>
        <button title={t('Send to back')} onClick={() => edit({ type: 'arrange', ids, to: 'back' })}><SendToBack size={15} /></button>
      </div>

      <div className="prop">
        <span className="prop-label">{t(one ? 'Align to page' : 'Align to selection')}</span>
        <div className="icon-row">
          <button title={t('Align left')} onClick={() => align('left')}><AlignStartVertical size={15} /></button>
          <button title={t('Align centre')} onClick={() => align('hcenter')}><AlignCenterVertical size={15} /></button>
          <button title={t('Align right')} onClick={() => align('right')}><AlignEndVertical size={15} /></button>
          <button title={t('Align top')} onClick={() => align('top')}><AlignStartHorizontal size={15} /></button>
          <button title={t('Align middle')} onClick={() => align('vcenter')}><AlignCenterHorizontal size={15} /></button>
          <button title={t('Align bottom')} onClick={() => align('bottom')}><AlignEndHorizontal size={15} /></button>
          {chosen.length > 2 && <button title={t('Distribute horizontally')} onClick={() => distribute('x')}><AlignHorizontalDistributeCenter size={15} /></button>}
          {chosen.length > 2 && <button title={t('Distribute vertically')} onClick={() => distribute('y')}><AlignVerticalDistributeCenter size={15} /></button>}
        </div>
        {chosen.length > 1 && (
          <div className="chips">
            <button onClick={() => sameSize('w')}>{t('Same width')}</button>
            <button onClick={() => sameSize('h')}>{t('Same height')}</button>
          </div>
        )}
      </div>

      {texts.length > 0 && (
        <div className="prop-group">
          <span className="prop-label">{t('Text')}</span>
          {one?.kind === 'text' && <TextValue key={`${docVersion}:${one.id}`} value={one.text ?? ''} onCommit={(text) => edit({ type: 'text', id: one.id, text })} />}
          <label className="prop">
            <span className="prop-label">{t('Font')}</span>
            <select value="" onChange={(e) => e.target.value && edit({ type: 'textStyle', ids: texts.map((t) => t.id), font: e.target.value as FontChoice })}>
              <option value="">{one?.fontName ?? t('Change font…')}</option>
              {FONTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <div className="prop-grid">
            <NumberField label={t('Size')} suffix="pt" step={0.5} value={texts[0].fontSize ?? 12} onCommit={(size) => edit({ type: 'textStyle', ids: texts.map((t) => t.id), size })} />
            <NumberField label={t('Horizontal scale')} suffix="%" value={texts[0].Tz ?? 100} onCommit={(Tz) => edit({ type: 'textStyle', ids: texts.map((t) => t.id), Tz })} />
            <NumberField label={t('Char spacing')} step={0.1} value={texts[0].Tc ?? 0} onCommit={(Tc) => edit({ type: 'textStyle', ids: texts.map((t) => t.id), Tc })} />
            <NumberField label={t('Word spacing')} step={0.1} value={texts[0].Tw ?? 0} onCommit={(Tw) => edit({ type: 'textStyle', ids: texts.map((t) => t.id), Tw })} />
            <NumberField label={t('Baseline shift')} step={0.5} value={texts[0].Ts ?? 0} onCommit={(Ts) => edit({ type: 'textStyle', ids: texts.map((t) => t.id), Ts })} />
          </div>
          <ColorField label={t('Colour')} value={texts[0].fill} onChange={(c) => c && edit({ type: 'fill', ids: texts.map((t) => t.id), color: c })} />
        </div>
      )}

      {paths.length > 0 && (
        <div className="prop-group">
          <span className="prop-label">{t('Shape')}</span>
          <ColorField label={tOr(t, 'Fill colour', 'Fill')} allowNone value={paths[0].fill} onChange={(color) => edit({ type: 'fill', ids: paths.map((p) => p.id), color })} />
          <ColorField label={t('Stroke')} allowNone value={paths[0].stroke} onChange={(color) => edit({ type: 'stroke', ids: paths.map((p) => p.id), color })} />
          <NumberField label={t('Line width')} suffix="pt" step={0.25} value={paths[0].lineWidth ?? 1} onCommit={(width) => edit({ type: 'stroke', ids: paths.map((p) => p.id), color: paths[0].stroke ?? '#000000', width })} />
        </div>
      )}

      {one?.kind === 'image' && (
        <div className="icon-row wide">
          <button onClick={replaceImage}><ImageUp size={15} /> {t('Replace image…')}</button>
        </div>
      )}

      <div className="icon-row wide">
        <button onClick={() => exportRegionAsImage(page, box, one ? KIND[one.kind].toLowerCase() : 'selection')}><Download size={15} /> {t('Export as PNG')}</button>
        {chosen.some((o) => o.clipped) && <button title={t('Remove the clipping path')} onClick={() => edit({ type: 'removeClip', ids })}><Scissors size={15} /> {t('Remove clip')}</button>}
      </div>
      <div className="icon-row wide">
        <button onClick={() => edit({ type: 'duplicate', ids, dx: 10, dy: -10 })}><Copy size={15} /> {t('Duplicate')}</button>
        <button className="danger" onClick={() => edit({ type: 'delete', ids })}><Trash2 size={15} /> {t('Delete')}</button>
      </div>
      <p className="muted small">{t('Drag to move, drag the handles to resize or rotate (Shift: keep proportions / 15° steps). Double-click text to edit it. Arrow keys nudge.')}</p>
    </fieldset>
  );
}

function TextValue({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  const t = useT();
  return (
    <label className="prop">
      <span className="prop-label">{t('Content')}</span>
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
    </label>
  );
}
