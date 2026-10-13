import { useEffect, useState } from 'react';
import { Lock, Trash2, Plus } from 'lucide-react';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import { addRadioButton, deleteField, updateFieldProps } from '../store/commands';
import type { Alignment, FieldInfo, FieldPatch, Visibility } from '../lib/forms';

const KIND_LABEL: Record<FieldInfo['kind'], string> = {
  text: 'Text field', checkbox: 'Check box', radio: 'Radio buttons', dropdown: 'Dropdown', list: 'List box',
  signature: 'Signature field', button: 'Button', other: 'Field',
};

function Check({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className="prop inline" title={hint}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

/** Text input that commits on blur/Enter, so typing does not rewrite the PDF per keystroke. */
function Committed({ label, value, onCommit, disabled, type = 'text', placeholder }: { label: string; value: string; onCommit: (v: string) => void; disabled?: boolean; type?: string; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onCommit(v);
  return (
    <label className="prop">
      <span className="prop-label">{label}</span>
      <input type={type} value={v} disabled={disabled} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </label>
  );
}

export function FieldProperties({ field }: { field: FieldInfo }) {
  const canDesign = useCan('designForms');
  const p = field.props;
  const set = (patch: FieldPatch) => updateFieldProps(field.name, patch);
  // A locked field accepts no changes except unlocking it.
  const disabled = !canDesign || p.locked;
  const shortName = field.name.includes('.') ? field.name.slice(field.name.lastIndexOf('.') + 1) : field.name;
  const [optionsText, setOptionsText] = useState((p.options ?? []).join('\n'));
  useEffect(() => setOptionsText((p.options ?? []).join('\n')), [p.options]);

  return (
    <div className="props-body">
      <div className="props-head">
        <b>{KIND_LABEL[field.kind]}</b>
        <span className="muted small">{field.widgets.length} widget(s){field.widgets[0] ? ` · page ${field.widgets[0].page + 1}` : ''}</span>
      </div>
      {!canDesign && <p className="muted small">This document’s security settings do not allow changing form fields.</p>}

      <div className="prop-group">
        <Check label="Locked" checked={p.locked} disabled={!canDesign} onChange={(locked) => set({ locked })} hint="The field cannot be moved, resized, deleted or changed until it is unlocked" />
        {p.locked && <p className="muted small"><Lock size={11} /> This field has the PDF “Locked” flag: it cannot be moved, resized, deleted or changed until you untick Locked (or use Form → Unlock all). Filling it in still works.</p>}
      </div>

      <Committed label="Name" value={shortName} disabled={disabled} onCommit={(name) => set({ name })} />
      <Committed label="Tooltip" value={p.tooltip} disabled={disabled} onCommit={(tooltip) => set({ tooltip })} placeholder="Shown when hovering the field" />

      <div className="prop-group">
        <span className="prop-label">Behaviour</span>
        <Check label="Read only" checked={p.readOnly} disabled={disabled} onChange={(readOnly) => set({ readOnly })} hint="The value cannot be changed when filling in the form" />
        <Check label="Required" checked={p.required} disabled={disabled} onChange={(required) => set({ required })} />
        <Check label="Value locked" checked={p.lockedContents} disabled={disabled} onChange={(lockedContents) => set({ lockedContents })} hint="The field's value cannot be changed (annotation flag LockedContents)" />
        <Check label="Exclude from export" checked={p.noExport} disabled={disabled} onChange={(noExport) => set({ noExport })} hint="Not included when the form data is submitted or exported" />
      </div>

      <label className="prop">
        <span className="prop-label">Visibility</span>
        <select value={p.visibility} disabled={disabled} onChange={(e) => set({ visibility: e.target.value as Visibility })}>
          <option value="visible">Visible</option>
          <option value="hidden">Hidden</option>
          <option value="noPrint">Visible but doesn’t print</option>
          <option value="printOnly">Hidden but printable</option>
        </select>
      </label>

      {field.kind === 'text' && (
        <div className="prop-group">
          <span className="prop-label">Text options</span>
          <label className="prop">
            <span className="prop-label">Alignment</span>
            <select value={p.alignment} disabled={disabled} onChange={(e) => set({ alignment: e.target.value as Alignment })}>
              <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option>
            </select>
          </label>
          <Committed label="Font size (0 = auto)" type="number" value={String(p.fontSize ?? 0)} disabled={disabled} onCommit={(v) => set({ fontSize: Number(v) || 0 })} />
          <Committed label="Maximum length (empty = none)" type="number" value={p.maxLength ? String(p.maxLength) : ''} disabled={disabled} onCommit={(v) => set({ maxLength: Number(v) || 0 })} />
          <Check label="Multi-line" checked={!!p.multiline} disabled={disabled || !!p.comb} onChange={(multiline) => set({ multiline })} />
          <Check label="Password (hide characters)" checked={!!p.password} disabled={disabled} onChange={(password) => set({ password })} />
          <Check label="Comb of characters" checked={!!p.comb} disabled={disabled || !p.maxLength} onChange={(comb) => set({ comb })} hint="Needs a maximum length" />
          <Check label="Scroll long text" checked={!!p.scroll} disabled={disabled} onChange={(scroll) => set({ scroll })} />
          <Check label="Check spelling" checked={!!p.spellcheck} disabled={disabled} onChange={(spellcheck) => set({ spellcheck })} />
        </div>
      )}

      {(field.kind === 'dropdown' || field.kind === 'list') && (
        <div className="prop-group">
          <label className="prop">
            <span className="prop-label">Options (one per line)</span>
            <textarea rows={5} value={optionsText} disabled={disabled} onChange={(e) => setOptionsText(e.target.value)} onBlur={() => optionsText !== (p.options ?? []).join('\n') && set({ options: optionsText.split('\n') })} />
          </label>
          {field.kind === 'dropdown' && <Check label="Allow custom text" checked={!!p.editable} disabled={disabled} onChange={(editable) => set({ editable })} />}
          <Check label="Sort options" checked={!!p.sort} disabled={disabled} onChange={(sort) => set({ sort })} />
          {field.kind === 'list' && <Check label="Multiple selection" checked={!!p.multiselect} disabled={disabled} onChange={(multiselect) => set({ multiselect })} />}
          <Committed label="Font size (0 = auto)" type="number" value={String(p.fontSize ?? 0)} disabled={disabled} onCommit={(v) => set({ fontSize: Number(v) || 0 })} />
        </div>
      )}

      {field.kind === 'radio' && (
        <div className="prop-group">
          <span className="prop-label">Buttons: {(p.options ?? []).join(', ')}</span>
          <button disabled={disabled} onClick={() => addRadioButton(field.name)}><Plus size={14} /> Add button</button>
        </div>
      )}

      <button className="danger" disabled={disabled} onClick={() => deleteField(field.name)}><Trash2 size={14} /> Delete field</button>
      <button onClick={() => useStore.setState({ selectedField: null })}>Done</button>
    </div>
  );
}
