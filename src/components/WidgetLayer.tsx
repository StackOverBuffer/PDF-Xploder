import { memo, useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import { pdfRectToView, viewRectToPdf, type VRect } from '../lib/geometry';
import { Lock } from 'lucide-react';
import { moveFieldWidget } from '../store/commands';
import { resolveDest, type PDFDocumentProxy } from '../lib/pdfjs';
import type { FieldInfo, FieldValue } from '../lib/pdfOps';
import type { PageGeom, Rect } from '../lib/types';
import { fieldValue } from './FormsPanel';
import { fillBlockers } from '../lib/forms';
import { tf, useT } from '../lib/i18n';
import { KIND_LABEL } from './FieldProperties';
import { openLinkAfterAsking } from '../lib/ask';

/** The subset of pdf.js annotation data used here. */
interface AnnotData {
  id: string;
  subtype: string;
  rect: [number, number, number, number];
  hidden?: boolean;
  // widgets
  fieldName?: string;
  fieldType?: 'Tx' | 'Btn' | 'Ch' | 'Sig';
  readOnly?: boolean;
  multiLine?: boolean;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  buttonValue?: string;
  exportValue?: string;
  combo?: boolean;
  multiSelect?: boolean;
  maxLen?: number;
  textAlignment?: number;
  defaultAppearanceData?: { fontSize?: number };
  // links
  url?: string;
  unsafeUrl?: string;
  dest?: unknown;
  action?: string;
}

const cache = new WeakMap<PDFDocumentProxy, Map<number, Promise<AnnotData[]>>>();

function pageAnnotations(pdf: PDFDocumentProxy, index: number): Promise<AnnotData[]> {
  let m = cache.get(pdf);
  if (!m) cache.set(pdf, (m = new Map()));
  let p = m.get(index);
  if (!p) {
    p = pdf.getPage(index + 1).then((pg) => pg.getAnnotations({ intent: 'display' }) as Promise<AnnotData[]>).catch(() => []);
    m.set(index, p);
  }
  return p;
}

const toRect = (r: AnnotData['rect']): Rect => ({ x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1]) });

async function followLink(a: AnnotData) {
  const s = useStore.getState();
  const url = a.url ?? a.unsafeUrl;
  if (url) {
    return openLinkAfterAsking(url);
  }
  if (a.dest !== undefined && s.pdf) {
    const r = await resolveDest(s.pdf, a.dest);
    if (r) s.goToPage(r.page, r.y);
    return;
  }
  const named: Record<string, number> = { FirstPage: 0, LastPage: s.pageIds.length - 1, NextPage: s.currentPage + 1, PrevPage: s.currentPage - 1 };
  if (a.action && a.action in named) s.goToPage(named[a.action]);
}

interface Props {
  index: number;
  geom: PageGeom;
  scale: number;
}

/** Interactive overlay for form fields and links, drawn above the page canvas. */
export const WidgetLayer = memo(function WidgetLayer({ index, geom, scale }: Props) {
  const pdf = useStore((s) => s.pdf);
  const fields = useStore((s) => s.fields);
  const edits = useStore((s) => s.formValues);
  const editable = useCan('fillForms');
  const highlight = useStore((s) => s.highlightFields);
  const [items, setItems] = useState<AnnotData[]>([]);
  const t = useT();

  useEffect(() => {
    let live = true;
    if (pdf) pageAnnotations(pdf, index).then((a) => live && setItems(a.filter((x) => !x.hidden && (x.subtype === 'Link' || x.subtype === 'Widget'))));
    return () => {
      live = false;
    };
  }, [pdf, index]);

  const design = useStore((s) => s.formDesign);
  if (design) return <DesignLayer index={index} geom={geom} scale={scale} />;
  if (!items.length) return null;
  const byName = new Map(fields.map((f) => [f.name, f]));

  return (
    <div className={`widget-layer ${highlight ? 'highlight-fields' : ''}`}>
      {items.map((a) => {
        const v = pdfRectToView(geom, toRect(a.rect));
        const style = { left: v.left * scale, top: v.top * scale, width: v.width * scale, height: v.height * scale };
        if (a.subtype === 'Link') {
          const target = a.url ?? a.unsafeUrl;
          return (
            <a
              key={a.id}
              className="pdf-link"
              style={style}
              href={target ?? '#'}
              title={target ?? t('Go to destination')}
              onClick={(e) => {
                e.preventDefault();
                followLink(a);
              }}
            />
          );
        }
        const f = a.fieldName ? byName.get(a.fieldName) : undefined;
        if (!f || a.pushButton || a.fieldType === 'Sig') return null;
        const why = [...(editable ? [] : ['the document’s security settings do not allow filling in forms']), ...fillBlockers(f), ...(a.readOnly && !f.props.readOnly ? ['it is marked read-only'] : [])];
        return <Widget key={a.id} a={a} f={f} value={fieldValue(f, edits)} disabled={why.length > 0} reason={why.length ? tf('{name}: cannot be filled in because {reasons}.', { name: f.name, reasons: why.map(t).join(` ${t('and')} `) }) : undefined} style={style} scale={scale} />;
      })}
    </div>
  );
});

function Widget({ a, f, value, disabled, reason, style, scale }: { a: AnnotData; f: FieldInfo; value: FieldValue | undefined; disabled: boolean; reason?: string; style: React.CSSProperties; scale: number }) {
  const set = (v: FieldValue, history = true) => useStore.getState().setFormValue(f.name, v, { history });
  const checkpoint = () => useStore.getState().armCheckpoint();
  const h = Number(style.height);
  // Font size 0 in the field's default appearance means "auto".
  const da = a.defaultAppearanceData?.fontSize;
  const fontSize = da ? da * scale : Math.max(8 * scale, Math.min(h * 0.65, 12 * scale));
  const textStyle: React.CSSProperties = { ...style, fontSize, textAlign: (['left', 'center', 'right'] as const)[a.textAlignment ?? 0] };
  const common = { className: 'widget', disabled, title: reason ?? f.name, onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };

  if (f.kind === 'text') {
    return a.multiLine ? (
      <textarea {...common} style={textStyle} value={String(value ?? '')} maxLength={a.maxLen || undefined} onFocus={checkpoint} onChange={(e) => set(e.target.value, false)} />
    ) : (
      <input {...common} style={textStyle} value={String(value ?? '')} maxLength={a.maxLen || undefined} onFocus={checkpoint} onChange={(e) => set(e.target.value, false)} />
    );
  }
  if (f.kind === 'checkbox') {
    return (
      <label className="widget widget-check" style={style} title={reason ?? f.name} onPointerDown={(e) => e.stopPropagation()}>
        <input type="checkbox" disabled={disabled} checked={value === true} onChange={(e) => set(e.target.checked)} />
      </label>
    );
  }
  if (f.kind === 'radio') {
    const on = a.buttonValue ?? a.exportValue ?? '';
    return (
      <label className="widget widget-check radio" style={style} title={reason ?? `${f.name}: ${on}`} onPointerDown={(e) => e.stopPropagation()}>
        <input type="radio" name={`radio-${f.name}`} disabled={disabled} checked={value === on} onChange={() => set(on)} />
      </label>
    );
  }
  if (f.kind === 'dropdown') {
    return (
      <select {...common} style={textStyle} value={String(value ?? '')} onChange={(e) => set(e.target.value)}>
        <option value="" />
        {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (f.kind === 'list') {
    return (
      <select {...common} multiple style={{ ...textStyle, fontSize: Math.min(fontSize, 12 * scale) }} value={(value as string[]) ?? []} onChange={(e) => set(Array.from(e.target.selectedOptions).map((o) => o.value))}>
        {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return null;
}

type DragState = { name: string; widget: number; mode: 'move' | 'resize'; x: number; y: number; orig: VRect; dx: number; dy: number; moved: boolean };

/** Form design: every field widget on the page as a selectable, movable box. */
function DesignLayer({ index, geom, scale }: Props) {
  const fields = useStore((s) => s.fields);
  const selected = useStore((s) => s.selectedField);
  const canDesign = useCan('designForms');
  const [drag, setDrag] = useState<DragState | null>(null);
  const t = useT();

  const boxes = fields.flatMap((f) => f.widgets.map((w, i) => ({ f, i, w })).filter(({ w }) => w.page === index));

  const start = (e: React.PointerEvent, name: string, widget: number, orig: VRect, mode: 'move' | 'resize', locked: boolean) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    useStore.setState({ selectedField: { name, widget }, selected: null });
    if (!canDesign || locked) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ name, widget, mode, x: e.clientX, y: e.clientY, orig, dx: 0, dy: 0, moved: false });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / scale;
    const dy = (e.clientY - drag.y) / scale;
    setDrag({ ...drag, dx, dy, moved: drag.moved || Math.abs(dx) + Math.abs(dy) > 1 });
  };
  const end = () => {
    if (!drag) return;
    setDrag(null);
    if (!drag.moved) return;
    const v = rectAfter(drag);
    moveFieldWidget(drag.name, drag.widget, viewRectToPdf(geom, v));
  };

  return (
    <div className="widget-layer design" onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)}>
      {boxes.map(({ f, i, w }) => {
        const base = pdfRectToView(geom, w.rect);
        const live = drag && drag.name === f.name && drag.widget === i ? rectAfter(drag) : base;
        const isSel = selected?.name === f.name;
        const locked = f.props.locked;
        return (
          <div
            key={`${f.name}#${i}`}
            className={`field-box kind-${f.kind} ${isSel ? 'selected' : ''} ${locked ? 'locked' : ''} ${f.readOnly ? 'readonly' : ''}`}
            style={{ left: live.left * scale, top: live.top * scale, width: live.width * scale, height: live.height * scale }}
            title={`${f.name} (${t(KIND_LABEL[f.kind])})${locked ? ` · ${t('locked')}` : ''}${f.props.readOnly ? ` · ${t('read-only')}` : ''}${f.props.required ? ` · ${t('required')}` : ''}`}
            onPointerDown={(e) => start(e, f.name, i, base, 'move', locked)}
          >
            <span className="field-label">{locked && <Lock size={9} />}{f.name}{f.props.required ? ' *' : ''}</span>
            {isSel && canDesign && !locked && (
              <span className="field-handle" onPointerDown={(e) => start(e, f.name, i, base, 'resize', locked)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function rectAfter(d: DragState): VRect {
  return d.mode === 'move'
    ? { ...d.orig, left: d.orig.left + d.dx, top: d.orig.top + d.dy }
    : { ...d.orig, width: Math.max(6, d.orig.width + d.dx), height: Math.max(6, d.orig.height + d.dy) };
}
