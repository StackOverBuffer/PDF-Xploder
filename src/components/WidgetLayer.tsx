import { memo, useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { pdfRectToView } from '../lib/geometry';
import { resolveDest, type PDFDocumentProxy } from '../lib/pdfjs';
import type { FieldInfo, FieldValue } from '../lib/pdfOps';
import type { PageGeom, Rect } from '../lib/types';
import { fieldValue } from './FormsPanel';

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
    if (confirm(`Open this link in a new tab?\n\n${url}`)) window.open(url, '_blank', 'noopener,noreferrer');
    return;
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
  const editable = useStore((s) => s.editable);
  const highlight = useStore((s) => s.highlightFields);
  const [items, setItems] = useState<AnnotData[]>([]);

  useEffect(() => {
    let live = true;
    if (pdf) pageAnnotations(pdf, index).then((a) => live && setItems(a.filter((x) => !x.hidden && (x.subtype === 'Link' || x.subtype === 'Widget'))));
    return () => {
      live = false;
    };
  }, [pdf, index]);

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
              title={target ?? 'Go to destination'}
              onClick={(e) => {
                e.preventDefault();
                followLink(a);
              }}
            />
          );
        }
        const f = a.fieldName ? byName.get(a.fieldName) : undefined;
        if (!f || a.pushButton || a.fieldType === 'Sig') return null;
        return <Widget key={a.id} a={a} f={f} value={fieldValue(f, edits)} disabled={!editable || !!a.readOnly || f.readOnly} style={style} scale={scale} />;
      })}
    </div>
  );
});

function Widget({ a, f, value, disabled, style, scale }: { a: AnnotData; f: FieldInfo; value: FieldValue | undefined; disabled: boolean; style: React.CSSProperties; scale: number }) {
  const set = (v: FieldValue, history = true) => useStore.getState().setFormValue(f.name, v, { history });
  const checkpoint = () => useStore.getState().checkpoint();
  const h = Number(style.height);
  // Font size 0 in the field's default appearance means "auto".
  const da = a.defaultAppearanceData?.fontSize;
  const fontSize = da ? da * scale : Math.max(8 * scale, Math.min(h * 0.65, 12 * scale));
  const textStyle: React.CSSProperties = { ...style, fontSize, textAlign: (['left', 'center', 'right'] as const)[a.textAlignment ?? 0] };
  const common = { className: 'widget', disabled, title: f.name, onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };

  if (f.kind === 'text') {
    return a.multiLine ? (
      <textarea {...common} style={textStyle} value={String(value ?? '')} maxLength={a.maxLen || undefined} onFocus={checkpoint} onChange={(e) => set(e.target.value, false)} />
    ) : (
      <input {...common} style={textStyle} value={String(value ?? '')} maxLength={a.maxLen || undefined} onFocus={checkpoint} onChange={(e) => set(e.target.value, false)} />
    );
  }
  if (f.kind === 'checkbox') {
    return (
      <label className="widget widget-check" style={style} title={f.name} onPointerDown={(e) => e.stopPropagation()}>
        <input type="checkbox" disabled={disabled} checked={value === true} onChange={(e) => set(e.target.checked)} />
      </label>
    );
  }
  if (f.kind === 'radio') {
    const on = a.buttonValue ?? a.exportValue ?? '';
    return (
      <label className="widget widget-check radio" style={style} title={`${f.name}: ${on}`} onPointerDown={(e) => e.stopPropagation()}>
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
