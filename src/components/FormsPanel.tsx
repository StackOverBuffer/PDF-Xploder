import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import type { FieldInfo, FieldValue } from '../lib/pdfOps';
import { fillBlockers } from '../lib/forms';
import { fillForm, resetFormEdits } from '../store/commands';
import { tf, useT } from '../lib/i18n';

export function fieldValue(f: FieldInfo, edits: Record<string, FieldValue>): FieldValue | undefined {
  if (f.name in edits) return edits[f.name];
  return 'value' in f ? f.value : undefined;
}

export function FormsPanel() {
  const t = useT();
  const fields = useStore((s) => s.fields);
  const edits = useStore((s) => s.formValues);
  const editable = useCan('fillForms');
  const canFlatten = useCan('modify');
  const highlight = useStore((s) => s.highlightFields);
  const set = (name: string, v: FieldValue, history = true) => useStore.getState().setFormValue(name, v, { history });
  const checkpoint = () => useStore.getState().checkpoint();
  const pending = Object.keys(edits).length;

  return (
    <div className="panel">
      <div className="panel-title">{t('Form fields')} <span className="muted">({fields.length})</span></div>
      <label className="pad inline small">
        <input type="checkbox" checked={highlight} onChange={(e) => useStore.setState({ highlightFields: e.target.checked })} /> {t('Highlight fields on the page')}
      </label>
      {fields.length === 0 && <p className="muted pad">{t('This document has no fillable form fields.')}</p>}
      <div className="form-fields">
        {fields.map((f) => {
          const disabled = !editable || f.readOnly;
          const v = fieldValue(f, edits);
          return (
            <label key={f.name} className="field">
              <span className="field-name" title={f.name}>{f.name}{f.name in edits ? ' •' : ''}</span>
              {fillBlockers(f).length > 0 && <span className="muted small">{tf('Cannot be filled in: {reasons}.', { reasons: fillBlockers(f).map(t).join(', ') })}</span>}
              {f.kind === 'text' && (f.multiline ? (
                <textarea disabled={disabled} value={String(v ?? '')} onFocus={checkpoint} onChange={(e) => set(f.name, e.target.value, false)} />
              ) : (
                <input disabled={disabled} value={String(v ?? '')} onFocus={checkpoint} onChange={(e) => set(f.name, e.target.value, false)} />
              ))}
              {f.kind === 'checkbox' && <input type="checkbox" disabled={disabled} checked={v === true} onChange={(e) => set(f.name, e.target.checked)} />}
              {(f.kind === 'radio' || f.kind === 'dropdown') && (
                <select disabled={disabled} value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)}>
                  <option value="">—</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              {f.kind === 'list' && (
                <select multiple disabled={disabled} value={(v as string[]) ?? []} onChange={(e) => set(f.name, Array.from(e.target.selectedOptions).map((o) => o.value))}>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              {f.kind === 'other' && <span className="muted small">{t('Unsupported field type')}</span>}
            </label>
          );
        })}
      </div>
      {fields.length > 0 && (
        <div className="panel-actions">
          <span className="muted small">{pending ? tf('{n} field(s) changed — saved with the document.', { n: pending }) : t('Fill fields here or directly on the page.')}</span>
          <button disabled={!pending} onClick={resetFormEdits}>{t('Reset changes')}</button>
          <button disabled={!canFlatten} onClick={() => confirm(t('Flatten the form? Fields will no longer be editable.')) && fillForm(true)}>{t('Flatten form')}</button>
        </div>
      )}
    </div>
  );
}
