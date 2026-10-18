/** Dialogs of the Measure tools: the drawing scale, and calibration from a measured line. */
import { useState } from 'react';
import { Modal } from './Dialogs';
import { useStore } from '../store/store';
import { calibrateFrom, measurements, setMeasureScale } from '../store/measureCommands';
import { SCALE_PRESETS, UNITS, formatNumber, paperScale, type MeasureUnit } from '../lib/measure';
import { tf, useLang, useT } from '../lib/i18n';
import type { Annotation } from '../lib/types';

const NOFLEX = { flex: 'none' } as const;

export function ScaleDialog({ close }: { close: () => void }) {
  const t = useT();
  const lang = useLang((l) => l.lang);
  const current = useStore((s) => s.measureScale);
  const parsed = /^(?:≈ )?1:([\d.]+)$/.exec(current.label);
  const [n, setN] = useState(parsed && current.label !== '1:1' ? Number(parsed[1]) : 100);
  const [unit, setUnit] = useState<MeasureUnit>(current.label === '1:1' && current.unit === 'mm' ? 'm' : current.unit);
  const count = measurements().length;
  const [apply, setApply] = useState(count > 0);
  const valid = n > 0 && Number.isFinite(n);
  const preview = valid ? paperScale(n, unit) : null;
  const ok = () => {
    if (!preview) return;
    setMeasureScale(preview, apply);
    close();
  };
  return (
    <Modal title={t('Measurement scale')} onClose={close} footer={<><button onClick={close}>{t('Cancel')}</button><button className="primary" disabled={!valid} onClick={ok}>{t('OK')}</button></>}>
      <p className="muted small">{t('The scale the drawing was made at. To match a known length instead, measure it and choose “Set scale from this line” in its properties.')}</p>
      <label className="row">
        <span>{t('Scale')}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
          1 :
          <input type="number" min={0.001} step="any" value={n} aria-label={t('Scale')} list="scale-presets" onChange={(e) => setN(Number(e.target.value))} />
          <datalist id="scale-presets">{SCALE_PRESETS.map((p) => <option key={p} value={p} />)}</datalist>
        </span>
      </label>
      <label className="row">
        <span>{t('Unit')}</span>
        <select aria-label={t('Unit')} value={unit} onChange={(e) => setUnit(e.target.value as MeasureUnit)}>
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </label>
      {preview && (
        <p className="muted small">{tf('1 cm on paper is {v} {u} in reality.', { v: formatNumber(preview.perPoint * (72 / 2.54), lang, 3), u: unit })}</p>
      )}
      {count > 0 && (
        <label className="row"><input type="checkbox" style={NOFLEX} checked={apply} onChange={(e) => setApply(e.target.checked)} /> {tf('Also apply to the {n} existing measurement(s)', { n: count })}</label>
      )}
    </Modal>
  );
}

export function CalibrateDialog({ close, annotation }: { close: () => void; annotation: Annotation }) {
  const t = useT();
  const current = useStore((s) => s.measureScale);
  const [real, setReal] = useState('');
  const [unit, setUnit] = useState<MeasureUnit>(current.unit);
  const value = Number(real.replace(',', '.'));
  const ok = () => {
    calibrateFrom(annotation, value, unit);
    close();
  };
  return (
    <Modal title={t('Set scale from this line')} onClose={close} footer={<><button onClick={close}>{t('Cancel')}</button><button className="primary" disabled={!(value > 0)} onClick={ok}>{t('OK')}</button></>}>
      <p className="muted small">{t('Enter the real length of the measured line (for example a dimension printed on the drawing). All measurements in the document use the new scale.')}</p>
      <label className="row">
        <span>{t('Real length')}</span>
        <input autoFocus inputMode="decimal" value={real} aria-label={t('Real length')} onChange={(e) => setReal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && value > 0 && ok()} />
        <select aria-label={t('Unit')} style={NOFLEX} value={unit} onChange={(e) => setUnit(e.target.value as MeasureUnit)}>
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </label>
    </Modal>
  );
}
