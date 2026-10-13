import { Trash2 } from 'lucide-react';
import { useStore, type ToolStyle } from '../store/store';
import { useCan } from '../store/permissions';
import { ANNOT_LABELS } from '../lib/annotGeom';
import { FieldProperties } from './FieldProperties';
import type { Annotation } from '../lib/types';

export const STAMPS = ['Approved', 'Not Approved', 'Draft', 'Final', 'Confidential', 'For Comment', 'Void', 'Received', 'Reviewed', 'Rejected'];

const SWATCHES = ['#ffeb3b', '#ff9800', '#e53935', '#d81b60', '#8e24aa', '#1e88e5', '#00acc1', '#43a047', '#111111', '#757575', '#ffffff'];

function ColorRow({ value, onChange, allowNone, label }: { value: string | null; onChange: (c: string | null) => void; allowNone?: boolean; label: string }) {
  return (
    <div className="prop">
      <span className="prop-label">{label}</span>
      <div className="swatches">
        {allowNone && <button className={`swatch-btn none ${value === null ? 'active' : ''}`} title="None" onClick={() => onChange(null)} />}
        {SWATCHES.map((c) => (
          <button key={c} className={`swatch-btn ${value === c ? 'active' : ''}`} style={{ background: c }} title={c} onClick={() => onChange(c)} />
        ))}
        <input type="color" value={value ?? '#ffffff'} onChange={(e) => onChange(e.target.value)} title="Custom colour" />
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="prop">
      <span className="prop-label">{label} <span className="muted">{fmt ? fmt(value) : value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

type Fields = { color?: boolean; fill?: boolean; width?: boolean; opacity?: boolean; fontSize?: boolean; stamp?: boolean };

function fieldsFor(type: string): Fields {
  switch (type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return { color: true, opacity: true };
    case 'ink':
    case 'line':
    case 'arrow':
      return { color: true, width: true, opacity: true };
    case 'rect':
    case 'ellipse':
      return { color: true, fill: true, width: true, opacity: true };
    case 'text':
      return { color: true, fontSize: true, opacity: true };
    case 'note':
      return { color: true };
    case 'stamp':
      return { color: true, opacity: true, stamp: true };
    case 'image':
      return { opacity: true };
    default:
      return {};
  }
}

function StyleEditor({ type, style, onChange }: { type: string; style: Partial<ToolStyle>; onChange: (p: Partial<ToolStyle>) => void }) {
  const f = fieldsFor(type);
  return (
    <>
      {f.color && <ColorRow label={type === 'rect' || type === 'ellipse' ? 'Stroke' : 'Colour'} value={style.color ?? null} onChange={(c) => c && onChange({ color: c })} />}
      {f.fill && <ColorRow label="Fill" allowNone value={style.fill ?? null} onChange={(c) => onChange({ fill: c })} />}
      {f.width && <Slider label="Thickness" value={style.width ?? 1} min={0.5} max={20} step={0.5} onChange={(width) => onChange({ width })} fmt={(v) => `${v} pt`} />}
      {f.fontSize && <Slider label="Font size" value={style.fontSize ?? 12} min={6} max={72} step={1} onChange={(fontSize) => onChange({ fontSize })} fmt={(v) => `${v} pt`} />}
      {f.opacity && <Slider label="Opacity" value={style.opacity ?? 1} min={0.1} max={1} step={0.05} onChange={(opacity) => onChange({ opacity })} fmt={(v) => `${Math.round(v * 100)}%`} />}
      {f.stamp && (
        <label className="prop">
          <span className="prop-label">Stamp text</span>
          <input list="stamp-list" value={style.stampLabel ?? ''} onChange={(e) => onChange({ stampLabel: e.target.value })} />
          <datalist id="stamp-list">{STAMPS.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
      )}
    </>
  );
}

function AnnotationProps({ pageId, a }: { pageId: string; a: Annotation }) {
  const update = (patch: Partial<Annotation>, history = true) => useStore.getState().updateAnnotation(pageId, a.id, patch, { history });
  const editable = useCan('annotate');
  const style: Partial<ToolStyle> = {
    color: a.color,
    opacity: a.opacity,
    fill: 'fill' in a ? a.fill : null,
    width: 'width' in a ? a.width : undefined,
    fontSize: a.type === 'text' ? a.fontSize : undefined,
    stampLabel: a.type === 'stamp' ? a.label : undefined,
  };
  const onStyle = (p: Partial<ToolStyle>) => {
    const { stampLabel, ...rest } = p;
    update((stampLabel !== undefined ? { ...rest, label: stampLabel } : rest) as Partial<Annotation>);
  };
  return (
    <fieldset disabled={!editable} className="props-body">
      <div className="props-head">
        <b>{ANNOT_LABELS[a.type]}</b>
        <span className="muted small">{a.author} · {new Date(a.createdAt).toLocaleString()}</span>
      </div>
      <StyleEditor type={a.type} style={style} onChange={onStyle} />
      {a.type === 'text' && (
        <>
          <label className="prop">
            <span className="prop-label">Text</span>
            <textarea id="prop-text" rows={4} value={a.text} onFocus={() => useStore.getState().checkpoint()} onChange={(e) => update({ text: e.target.value }, false)} />
          </label>
          <label className="prop inline"><input type="checkbox" checked={a.border} onChange={(e) => update({ border: e.target.checked })} /> Border</label>
        </>
      )}
      {a.type === 'note' && (
        <label className="prop">
          <span className="prop-label">Note</span>
          <textarea id="prop-text" rows={6} value={a.text} placeholder="Type your note…" onFocus={() => useStore.getState().checkpoint()} onChange={(e) => update({ text: e.target.value }, false)} />
        </label>
      )}
      {a.type !== 'note' && (
        <label className="prop">
          <span className="prop-label">Comment</span>
          <textarea rows={3} value={a.comment ?? ''} placeholder="Add a comment…" onFocus={() => useStore.getState().checkpoint()} onChange={(e) => update({ comment: e.target.value }, false)} />
        </label>
      )}
      {a.type === 'redact' && <p className="muted small">Redaction marks are only previews. Use <b>Protect → Apply redactions</b> to permanently remove the content underneath.</p>}
      <button className="danger" onClick={() => useStore.getState().deleteAnnotation(pageId, a.id)}><Trash2 size={14} /> Delete</button>
    </fieldset>
  );
}

const TOOL_NAMES: Record<string, string> = {
  highlight: 'Highlight', underline: 'Underline', strikeout: 'Strikeout', ink: 'Pencil', rect: 'Rectangle', ellipse: 'Ellipse',
  line: 'Line', arrow: 'Arrow', text: 'Text box', note: 'Sticky note', stamp: 'Stamp', redact: 'Redact', sign: 'Signature', fieldText: 'Text field', fieldCheckbox: 'Check box', fieldDropdown: 'Dropdown', fieldList: 'List box', fieldRadio: 'Radio button',
};

const TOOL_HINTS: Record<string, string> = {
  highlight: 'Select text on the page to highlight it.',
  underline: 'Select text on the page to underline it.',
  strikeout: 'Select text on the page to strike it out.',
  ink: 'Draw freehand on the page.',
  rect: 'Drag to draw. Hold Shift for a square.',
  ellipse: 'Drag to draw. Hold Shift for a circle.',
  line: 'Drag to draw. Hold Shift to snap to 45°.',
  arrow: 'Drag to draw. Hold Shift to snap to 45°.',
  text: 'Click or drag to place a text box, then type.',
  note: 'Click to place a sticky note.',
  stamp: 'Click or drag to place the stamp.',
  fieldText: 'Drag a box for the new text field.',
  fieldCheckbox: 'Click or drag to place a check box.',
  fieldDropdown: 'Drag a box for the new dropdown.',
  fieldList: 'Drag a box for the new list box.',
  fieldRadio: 'Click to place a radio button; add more from its properties.',
  sign: 'Drag a box where the signature should appear.',
  redact: 'Drag over content to mark it for redaction.',
};

export function PropertiesPanel() {
  const tool = useStore((s) => s.tool);
  const sel = useStore((s) => s.selected);
  const a = useStore((s) => (s.selected ? s.annotations[s.selected.pageId]?.find((x) => x.id === s.selected!.id) : undefined));
  const style = useStore((s) => s.styles[tool]);
  const author = useStore((s) => s.author);
  const field = useStore((s) => (s.selectedField ? s.fields.find((f) => f.name === s.selectedField!.name) : undefined));

  return (
    <aside className="props">
      <div className="panel-title">Properties</div>
      {field ? (
        <FieldProperties field={field} />
      ) : sel && a ? (
        <AnnotationProps pageId={sel.pageId} a={a} />
      ) : style ? (
        <div className="props-body">
          <div className="props-head"><b>{TOOL_NAMES[tool]} tool</b></div>
          <p className="muted small">{TOOL_HINTS[tool]}</p>
          <StyleEditor type={tool} style={style} onChange={(p) => useStore.getState().setStyle(tool, p)} />
        </div>
      ) : (
        <div className="props-body">
          <p className="muted small">Select an annotation to edit it, or pick a tool from the Comment tab.</p>
          <label className="prop">
            <span className="prop-label">Author name</span>
            <input value={author} onChange={(e) => useStore.getState().setAuthor(e.target.value)} />
          </label>
        </div>
      )}
    </aside>
  );
}
