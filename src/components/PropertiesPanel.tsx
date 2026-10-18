import { useRef } from 'react';
import { formatMeasure, measuredValue } from '../lib/measure';
import { setMeasureScale } from '../store/measureCommands';
import { useDialog } from './Dialogs';
import { Trash2 } from 'lucide-react';
import { useStore, type ToolStyle } from '../store/store';
import { useCan } from '../store/permissions';
import { ANNOT_LABELS } from '../lib/annotGeom';
import { FieldProperties } from './FieldProperties';
import { ContentProperties } from './ContentProperties';
import { makeAllFieldsEditable, setAllFieldsLocked } from '../store/commands';
import { tf, useLang, useT } from '../lib/i18n';

/** `t(key)`, or `en` while `key` has no translation: for words whose plain key ("Fill") means something else in the ribbon. */
const tOr = (t: (s: string) => string, key: string, en: string) => (t(key) === key ? en : t(key));

function FormDesignHelp() {
  const fields = useStore((s) => s.fields);
  const canDesign = useCan('designForms');
  const canFill = useCan('fillForms');
  const locked = fields.filter((f) => f.props.locked).length;
  const readOnly = fields.filter((f) => f.props.readOnly).length;
  const valueLocked = fields.filter((f) => f.props.lockedContents).length;
  const t = useT();
  return (
    <div className="props-body">
      <div className="props-head"><b>{t('Edit form')}</b></div>
      <p className="muted small">{t('Click a field to change its properties; drag it to move it, or use the field tools to add new ones.')}</p>
      {!canDesign && <p className="error-text small">{t(canFill ? 'This document’s security settings do not allow changing form fields. Unlock it with the permissions password (Protect → Permissions).' : 'This document’s security settings do not allow changing form fields or filling them in. Unlock it with the permissions password (Protect → Permissions).')}</p>}
      {(locked > 0 || readOnly > 0 || valueLocked > 0) && (
        <div className="notice">
          <p className="small"><b>{t('Some fields are protected by the document:')}</b></p>
          <ul className="small">
            {readOnly > 0 && <li><b>{readOnly}</b> {t('read-only (dashed outline): cannot be filled in.')}</li>}
            {valueLocked > 0 && <li><b>{valueLocked}</b> {t('with a locked value: cannot be filled in.')}</li>}
            {locked > 0 && <li><b>{locked}</b> {t('locked (lock icon): cannot be moved, resized, deleted or changed. Filling in is not affected.')}</li>}
          </ul>
          <button disabled={!canDesign} onClick={() => makeAllFieldsEditable()}>{t('Make all fields editable')}</button>
          {locked > 0 && <button disabled={!canDesign} onClick={() => setAllFieldsLocked(false)}>{t('Only unlock (keep read-only)')}</button>}
        </div>
      )}
    </div>
  );
}

function ContentToolHelp() {
  const tool = useStore((s) => s.tool);
  const filter = useStore((s) => s.contentFilter);
  const style = useStore((s) => (s.tool === 'contentText' ? s.styles.text : s.styles.rect));
  const t = useT();
  const hint: Record<string, string> = {
    content: 'Click an object on the page to select it, or drag around several. Double-click text to edit it.',
    contentText: 'Click on the page where the new text should start, type, then press Enter.',
    contentRect: 'Drag to draw a rectangle into the page content.',
    contentEllipse: 'Drag to draw an ellipse into the page content.',
    contentLine: 'Drag to draw a line into the page content.',
  };
  return (
    <div className="props-body">
      <div className="props-head"><b>{t('Edit page content')}</b></div>
      <p className="muted small">{hint[tool] && t(hint[tool])}</p>
      {tool === 'content' && (
        <label className="prop">
          <span className="prop-label">{t('Select')}</span>
          <select value={filter} onChange={(e) => useStore.setState({ contentFilter: e.target.value as typeof filter, contentSelection: null })}>
            <option value="all">{t('All content')}</option><option value="text">{t('Text only')}</option><option value="image">{t('Images only')}</option><option value="shape">{t('Shapes only')}</option>
          </select>
        </label>
      )}
      {tool !== 'content' && (
        <StyleEditor type={tool === 'contentText' ? 'text' : 'rect'} style={style} onChange={(p) => useStore.getState().setStyle(tool === 'contentText' ? 'text' : 'rect', p)} />
      )}
      <p className="muted small">{t('Changes are made to the page itself (not as comments) and can be undone with Ctrl+Z.')}</p>
    </div>
  );
}
import type { Annotation } from '../lib/types';

export const STAMPS = ['Approved', 'Not Approved', 'Draft', 'Final', 'Confidential', 'For Comment', 'Void', 'Received', 'Reviewed', 'Rejected'];

const SWATCHES = ['#ffeb3b', '#ff9800', '#e53935', '#d81b60', '#8e24aa', '#1e88e5', '#00acc1', '#43a047', '#111111', '#757575', '#ffffff'];

function ColorRow({ value, onChange, allowNone, label }: { value: string | null; onChange: (c: string | null) => void; allowNone?: boolean; label: string }) {
  const t = useT();
  return (
    <div className="prop">
      <span className="prop-label">{label}</span>
      <div className="swatches">
        {allowNone && <button className={`swatch-btn none ${value === null ? 'active' : ''}`} title={t('None')} onClick={() => onChange(null)} />}
        {SWATCHES.map((c) => (
          <button key={c} className={`swatch-btn ${value === c ? 'active' : ''}`} style={{ background: c }} title={c} onClick={() => onChange(c)} />
        ))}
        <input type="color" value={value ?? '#ffffff'} onChange={(e) => onChange(e.target.value)} title={t('Custom colour')} />
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
    case 'polygon':
    case 'polyline':
    case 'cloud':
      return { color: true, fill: true, width: true, opacity: true };
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
  const t = useT();
  return (
    <>
      {f.color && <ColorRow label={t(type === 'rect' || type === 'ellipse' ? 'Stroke' : 'Colour')} value={style.color ?? null} onChange={(c) => c && onChange({ color: c })} />}
      {f.fill && <ColorRow label={tOr(t, 'Fill colour', 'Fill')} allowNone value={style.fill ?? null} onChange={(c) => onChange({ fill: c })} />}
      {f.width && <Slider label={t('Thickness')} value={style.width ?? 1} min={0.5} max={20} step={0.5} onChange={(width) => onChange({ width })} fmt={(v) => `${v} pt`} />}
      {f.fontSize && <Slider label={t('Font size')} value={style.fontSize ?? 12} min={6} max={72} step={1} onChange={(fontSize) => onChange({ fontSize })} fmt={(v) => `${v} pt`} />}
      {f.opacity && <Slider label={t('Opacity')} value={style.opacity ?? 1} min={0.1} max={1} step={0.05} onChange={(opacity) => onChange({ opacity })} fmt={(v) => `${Math.round(v * 100)}%`} />}
      {f.stamp && (
        <label className="prop">
          <span className="prop-label">{t('Stamp text')}</span>
          <input list="stamp-list" value={style.stampLabel ?? ''} onChange={(e) => onChange({ stampLabel: e.target.value })} />
          <datalist id="stamp-list">{STAMPS.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
      )}
    </>
  );
}

const MEASURE_LABELS = { distance: 'Distance', perimeter: 'Perimeter', area: 'Area' } as const;
const measureOf = (a: Annotation) => ('measure' in a ? a.measure : undefined);

/** A measurement's value and scale, with calibration. */
function MeasureInfo({ a }: { a: Annotation }) {
  const t = useT();
  const lang = useLang((l) => l.lang);
  const current = useStore((s) => s.measureScale);
  const show = useDialog((d) => d.show);
  const m = measureOf(a)!;
  const pts = 'p1' in a ? [a.p1, a.p2] : 'vertices' in a ? a.vertices : [];
  const value = formatMeasure(m.kind, measuredValue(m.kind, pts, m.scale), m.scale.unit, lang);
  return (
    <div className="prop-group">
      <div className="prop"><span className="prop-label">{t('Value')}</span><b className="measure-value">{value}</b></div>
      <div className="prop"><span className="prop-label">{t('Scale')}</span><span>{m.scale.label} ({m.scale.unit})</span></div>
      {m.kind === 'distance' && <button onClick={() => show('calibrate', a)}>{t('Set scale from this line…')}</button>}
      {(m.scale.perPoint !== current.perPoint || m.scale.unit !== current.unit) && (
        <button onClick={() => setMeasureScale(current, true)}>{tf('Use the current scale ({s}) for all', { s: current.label })}</button>
      )}
    </div>
  );
}

function AnnotationProps({ pageId, a }: { pageId: string; a: Annotation }) {
  const update = (patch: Partial<Annotation>, history = true) => useStore.getState().updateAnnotation(pageId, a.id, patch, { history });
  const editable = useCan('annotate');
  const t = useT();
  const style: Partial<ToolStyle> = {
    color: a.color,
    opacity: a.opacity,
    fill: 'fill' in a ? a.fill : null,
    width: 'width' in a ? a.width : undefined,
    fontSize: a.type === 'text' ? a.fontSize : undefined,
    stampLabel: a.type === 'stamp' ? a.label : undefined,
  };
  // Dragging a slider or colour picker sends a stream of changes: one undo step for the lot.
  const lastStyle = useRef(0);
  const onStyle = (p: Partial<ToolStyle>) => {
    const { stampLabel, ...rest } = p;
    const now = Date.now();
    const history = now - lastStyle.current > 800;
    lastStyle.current = now;
    update((stampLabel !== undefined ? { ...rest, label: stampLabel } : rest) as Partial<Annotation>, history);
  };
  return (
    <fieldset disabled={!editable} className="props-body">
      <div className="props-head">
        <b>{t(measureOf(a) ? MEASURE_LABELS[measureOf(a)!.kind] : ANNOT_LABELS[a.type])}</b>
        <span className="muted small">{a.author} · {new Date(a.createdAt).toLocaleString()}</span>
      </div>
      <StyleEditor type={a.type} style={style} onChange={onStyle} />
      {measureOf(a) && <MeasureInfo a={a} />}
      {a.type === 'text' && (
        <>
          <label className="prop">
            <span className="prop-label">{t('Text')}</span>
            <textarea id="prop-text" rows={4} value={a.text} onFocus={() => useStore.getState().armCheckpoint()} onChange={(e) => update({ text: e.target.value }, false)} />
          </label>
          <label className="prop inline"><input type="checkbox" checked={a.border} onChange={(e) => update({ border: e.target.checked })} /> {t('Border')}</label>
        </>
      )}
      {a.type === 'note' && (
        <label className="prop">
          <span className="prop-label">{t('Note')}</span>
          <textarea id="prop-text" rows={6} value={a.text} placeholder={t('Type your note…')} onFocus={() => useStore.getState().armCheckpoint()} onChange={(e) => update({ text: e.target.value }, false)} />
        </label>
      )}
      {a.type !== 'note' && (
        <label className="prop">
          <span className="prop-label">{tOr(t, 'Comment text', 'Comment')}</span>
          <textarea rows={3} value={a.comment ?? ''} placeholder={t('Add a comment…')} onFocus={() => useStore.getState().armCheckpoint()} onChange={(e) => update({ comment: e.target.value }, false)} />
        </label>
      )}
      {a.type === 'redact' && <p className="muted small">{t('Redaction marks are only previews. Use')} <b>{t('Protect → Apply redactions')}</b> {t('to permanently remove the content underneath.')}</p>}
      <button className="danger" onClick={() => useStore.getState().deleteAnnotation(pageId, a.id)}><Trash2 size={14} /> {t('Delete')}</button>
    </fieldset>
  );
}

const TOOL_NAMES: Record<string, string> = {
  highlight: 'Highlight', underline: 'Underline', strikeout: 'Strikeout', ink: 'Pencil', rect: 'Rectangle', ellipse: 'Ellipse',
  line: 'Line', arrow: 'Arrow', polygon: 'Polygon', polyline: 'Polyline', cloud: 'Cloud', text: 'Text box', note: 'Sticky note', stamp: 'Stamp', redact: 'Redact', sign: 'Signature', fieldText: 'Text field', fieldCheckbox: 'Check box', fieldDropdown: 'Dropdown', fieldList: 'List box', fieldRadio: 'Radio button',
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
  polygon: 'Click the corners; double-click the last one to close the polygon. Escape cancels.',
  polyline: 'Click the points; double-click the last one to finish the line. Escape cancels.',
  cloud: 'Click the corners; double-click the last one to close the cloud. Escape cancels.',
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
  const contentSel = useStore((s) => s.contentSelection);
  const formDesign = useStore((s) => s.formDesign);
  const field = useStore((s) => (s.selectedField ? s.fields.find((f) => f.name === s.selectedField!.name) : undefined));
  const t = useT();

  return (
    <aside className="props">
      <div className="panel-title">{t('Properties')}</div>
      {contentSel && tool === 'content' ? (
        <ContentProperties />
      ) : tool.startsWith('content') ? (
        <ContentToolHelp />
      ) : field ? (
        <FieldProperties field={field} />
      ) : formDesign ? (
        <FormDesignHelp />
      ) : sel && a ? (
        <AnnotationProps pageId={sel.pageId} a={a} />
      ) : style ? (
        <div className="props-body">
          <div className="props-head"><b>{t(`${TOOL_NAMES[tool]} tool`)}</b></div>
          <p className="muted small">{TOOL_HINTS[tool] && t(TOOL_HINTS[tool])}</p>
          <StyleEditor type={tool} style={style} onChange={(p) => useStore.getState().setStyle(tool, p)} />
        </div>
      ) : (
        <div className="props-body">
          <p className="muted small">{t('Select an annotation to edit it, or pick a tool from the Comment tab.')}</p>
          <label className="prop">
            <span className="prop-label">{t('Author name')}</span>
            <input value={author} onChange={(e) => useStore.getState().setAuthor(e.target.value)} />
          </label>
        </div>
      )}
    </aside>
  );
}
