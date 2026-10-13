import { useEffect, useState } from 'react';
import { Lock, Trash2, Plus } from 'lucide-react';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import { addRadioButton, deleteField, updateFieldProps } from '../store/commands';
import type { Alignment, FieldInfo, FieldPatch, Visibility } from '../lib/forms';
import { tf, useT } from '../lib/i18n';

/** English labels (translation keys). */
export const KIND_LABEL: Record<FieldInfo['kind'], string> = {
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
  const t = useT();
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
        <b>{t(KIND_LABEL[field.kind])}</b>
        <span className="muted small">{tf('{n} widget(s)', { n: field.widgets.length })}{field.widgets[0] ? ` · ${tf('page {n}', { n: field.widgets[0].page + 1 })}` : ''}</span>
      </div>
      {!canDesign && <p className="muted small">{t('This document’s security settings do not allow changing form fields.')}</p>}

      <div className="prop-group">
        <Check label={t('Locked')} checked={p.locked} disabled={!canDesign} onChange={(locked) => set({ locked })} hint={t('The field cannot be moved, resized, deleted or changed until it is unlocked')} />
        {p.locked && <p className="muted small"><Lock size={11} /> {t('This field has the PDF “Locked” flag: it cannot be moved, resized, deleted or changed until you untick Locked (or use Form → Unlock all). Filling it in still works.')}</p>}
      </div>

      <Committed label={t('Name')} value={shortName} disabled={disabled} onCommit={(name) => set({ name })} />
      <Committed label={t('Tooltip')} value={p.tooltip} disabled={disabled} onCommit={(tooltip) => set({ tooltip })} placeholder={t('Shown when hovering the field')} />

      <div className="prop-group">
        <span className="prop-label">{t('Behaviour')}</span>
        <Check label={t('Read only')} checked={p.readOnly} disabled={disabled} onChange={(readOnly) => set({ readOnly })} hint={t('The value cannot be changed when filling in the form')} />
        <Check label={t('Required')} checked={p.required} disabled={disabled} onChange={(required) => set({ required })} />
        <Check label={t('Value locked')} checked={p.lockedContents} disabled={disabled} onChange={(lockedContents) => set({ lockedContents })} hint={t("The field's value cannot be changed (annotation flag LockedContents)")} />
        <Check label={t('Exclude from export')} checked={p.noExport} disabled={disabled} onChange={(noExport) => set({ noExport })} hint={t('Not included when the form data is submitted or exported')} />
      </div>

      <label className="prop">
        <span className="prop-label">{t('Visibility')}</span>
        <select value={p.visibility} disabled={disabled} onChange={(e) => set({ visibility: e.target.value as Visibility })}>
          <option value="visible">{t('Visible')}</option>
          <option value="hidden">{t('Hidden')}</option>
          <option value="noPrint">{t('Visible but doesn’t print')}</option>
          <option value="printOnly">{t('Hidden but printable')}</option>
        </select>
      </label>

      {field.kind === 'text' && (
        <div className="prop-group">
          <span className="prop-label">{t('Text options')}</span>
          <label className="prop">
            <span className="prop-label">{t('Alignment')}</span>
            <select value={p.alignment} disabled={disabled} onChange={(e) => set({ alignment: e.target.value as Alignment })}>
              <option value="left">{t('Left')}</option><option value="center">{t('Centre')}</option><option value="right">{t('Right')}</option>
            </select>
          </label>
          <Committed label={t('Font size (0 = auto)')} type="number" value={String(p.fontSize ?? 0)} disabled={disabled} onCommit={(v) => set({ fontSize: Number(v) || 0 })} />
          <Committed label={t('Maximum length (empty = none)')} type="number" value={p.maxLength ? String(p.maxLength) : ''} disabled={disabled} onCommit={(v) => set({ maxLength: Number(v) || 0 })} />
          <Check label={t('Multi-line')} checked={!!p.multiline} disabled={disabled || !!p.comb} onChange={(multiline) => set({ multiline })} />
          <Check label={t('Password (hide characters)')} checked={!!p.password} disabled={disabled} onChange={(password) => set({ password })} />
          <Check label={t('Comb of characters')} checked={!!p.comb} disabled={disabled || !p.maxLength} onChange={(comb) => set({ comb })} hint={t('Needs a maximum length')} />
          <Check label={t('Scroll long text')} checked={!!p.scroll} disabled={disabled} onChange={(scroll) => set({ scroll })} />
          <Check label={t('Check spelling')} checked={!!p.spellcheck} disabled={disabled} onChange={(spellcheck) => set({ spellcheck })} />
        </div>
      )}

      {(field.kind === 'dropdown' || field.kind === 'list') && (
        <div className="prop-group">
          <label className="prop">
            <span className="prop-label">{t('Options (one per line)')}</span>
            <textarea rows={5} value={optionsText} disabled={disabled} onChange={(e) => setOptionsText(e.target.value)} onBlur={() => optionsText !== (p.options ?? []).join('\n') && set({ options: optionsText.split('\n') })} />
          </label>
          {field.kind === 'dropdown' && <Check label={t('Allow custom text')} checked={!!p.editable} disabled={disabled} onChange={(editable) => set({ editable })} />}
          <Check label={t('Sort options')} checked={!!p.sort} disabled={disabled} onChange={(sort) => set({ sort })} />
          {field.kind === 'list' && <Check label={t('Multiple selection')} checked={!!p.multiselect} disabled={disabled} onChange={(multiselect) => set({ multiselect })} />}
          <Committed label={t('Font size (0 = auto)')} type="number" value={String(p.fontSize ?? 0)} disabled={disabled} onCommit={(v) => set({ fontSize: Number(v) || 0 })} />
        </div>
      )}

      {field.kind === 'radio' && (
        <div className="prop-group">
          <span className="prop-label">{t('Buttons:')} {(p.options ?? []).join(', ')}</span>
          <button disabled={disabled} onClick={() => addRadioButton(field.name)}><Plus size={14} /> {t('Add button')}</button>
        </div>
      )}

      <button className="danger" disabled={disabled} onClick={() => deleteField(field.name)}><Trash2 size={14} /> {t('Delete field')}</button>
      <button onClick={() => useStore.setState({ selectedField: null })}>{t('Done')}</button>
    </div>
  );
}
