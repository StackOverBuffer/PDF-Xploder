import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { getFormFields, type FieldInfo, type FieldValue } from '../lib/pdfOps';
import { fillForm } from '../store/commands';

export function FormsPanel() {
  const bytes = useStore((s) => s.bytes);
  const editable = useStore((s) => s.editable);
  const [fields, setFields] = useState<FieldInfo[] | null>(null);
  const [values, setValues] = useState<Record<string, FieldValue>>({});

  useEffect(() => {
    let live = true;
    setFields(null);
    setValues({});
    if (bytes) getFormFields(bytes).then((f) => live && setFields(f)).catch(() => live && setFields([]));
    return () => {
      live = false;
    };
  }, [bytes]);

  if (fields === null) return <div className="panel"><div className="panel-title">Form fields</div><p className="muted pad">Loading…</p></div>;

  const val = <T extends FieldValue>(f: FieldInfo, fallback: T): T => (f.name in values ? (values[f.name] as T) : fallback);
  const set = (name: string, v: FieldValue) => setValues({ ...values, [name]: v });
  const changed = Object.keys(values).length > 0;

  return (
    <div className="panel">
      <div className="panel-title">Form fields <span className="muted">({fields.length})</span></div>
      {fields.length === 0 && <p className="muted pad">This document has no fillable form fields.</p>}
      <div className="form-fields">
        {fields.map((f) => {
          const disabled = !editable || f.readOnly;
          return (
            <label key={f.name} className="field">
              <span className="field-name" title={f.name}>{f.name}</span>
              {f.kind === 'text' && (f.multiline ? (
                <textarea disabled={disabled} value={val(f, f.value)} onChange={(e) => set(f.name, e.target.value)} />
              ) : (
                <input disabled={disabled} value={val(f, f.value)} onChange={(e) => set(f.name, e.target.value)} />
              ))}
              {f.kind === 'checkbox' && <input type="checkbox" disabled={disabled} checked={val(f, f.value)} onChange={(e) => set(f.name, e.target.checked)} />}
              {(f.kind === 'radio' || f.kind === 'dropdown') && (
                <select disabled={disabled} value={val(f, f.value)} onChange={(e) => set(f.name, e.target.value)}>
                  <option value="">—</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              {f.kind === 'list' && (
                <select multiple disabled={disabled} value={val(f, f.value)} onChange={(e) => set(f.name, Array.from(e.target.selectedOptions).map((o) => o.value))}>
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
          <button className="primary" disabled={!editable || !changed} onClick={() => fillForm(values)}>Apply values</button>
          <button disabled={!editable} onClick={() => confirm('Flatten the form? Fields will no longer be editable.') && fillForm(values, true)}>Flatten form</button>
        </div>
      )}
    </div>
  );
}
