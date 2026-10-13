import { useStore } from '../store/store';
import type { FieldInfo, FieldValue } from '../lib/pdfOps';
import { fillForm, resetFormEdits } from '../store/commands';

export function fieldValue(f: FieldInfo, edits: Record<string, FieldValue>): FieldValue | undefined {
  if (f.name in edits) return edits[f.name];
  return 'value' in f ? f.value : undefined;
}

export function FormsPanel() {
  const fields = useStore((s) => s.fields);
  const edits = useStore((s) => s.formValues);
  const editable = useStore((s) => s.editable);
  const highlight = useStore((s) => s.highlightFields);
  const set = (name: string, v: FieldValue, history = true) => useStore.getState().setFormValue(name, v, { history });
  const checkpoint = () => useStore.getState().checkpoint();
  const pending = Object.keys(edits).length;

  return (
    <div className="panel">
      <div className="panel-title">Form fields <span className="muted">({fields.length})</span></div>
      <label className="pad inline small">
        <input type="checkbox" checked={highlight} onChange={(e) => useStore.setState({ highlightFields: e.target.checked })} /> Highlight fields on the page
      </label>
      {fields.length === 0 && <p className="muted pad">This document has no fillable form fields.</p>}
      <div className="form-fields">
        {fields.map((f) => {
          const disabled = !editable || f.readOnly;
          const v = fieldValue(f, edits);
          return (
            <label key={f.name} className="field">
              <span className="field-name" title={f.name}>{f.name}{f.name in edits ? ' •' : ''}</span>
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
              {f.kind === 'other' && <span className="muted small">Unsupported field type</span>}
            </label>
          );
        })}
      </div>
      {fields.length > 0 && (
        <div className="panel-actions">
          <span className="muted small">{pending ? `${pending} field(s) changed — saved with the document.` : 'Fill fields here or directly on the page.'}</span>
          <button disabled={!pending} onClick={resetFormEdits}>Reset changes</button>
          <button disabled={!editable} onClick={() => confirm('Flatten the form? Fields will no longer be editable.') && fillForm(true)}>Flatten form</button>
        </div>
      )}
    </div>
  );
}
