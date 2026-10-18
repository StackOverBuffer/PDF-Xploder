/** Measure tools: the document's scale, calibration and CSV export. */
import { calibratedScale, measuredValue, measurementsCsv, type Measure, type MeasureScale, type MeasureUnit } from '../lib/measure';
import { downloadBlob, baseName } from '../lib/download';
import { tf, tr, useLang } from '../lib/i18n';
import type { Annotation, LineAnnot, PolygonAnnot } from '../lib/types';
import { useStore } from './store';

const S = () => useStore.getState();

type Measured = (LineAnnot | PolygonAnnot) & { measure: Measure };

const isMeasured = (a: Annotation): a is Measured => 'measure' in a && !!a.measure;
const pointsOf = (a: Measured) => ('p1' in a ? [a.p1, a.p2] : a.vertices);

/** All measurements in page order. */
export function measurements(): { page: number; a: Measured }[] {
  const s = S();
  return s.pageIds.flatMap((id, page) => (s.annotations[id] ?? []).filter(isMeasured).map((a) => ({ page, a })));
}

/** Use `scale` for new measurements; optionally re-scale the existing ones too (one undo step). */
export function setMeasureScale(scale: MeasureScale, applyToExisting: boolean) {
  const s = S();
  if (!applyToExisting) return useStore.setState({ measureScale: scale });
  const list = measurements();
  if (list.length) s.checkpoint();
  const annotations = { ...s.annotations };
  for (const [id, items] of Object.entries(annotations)) {
    if (items.some(isMeasured)) annotations[id] = items.map((a) => (isMeasured(a) ? ({ ...a, measure: { ...a.measure, scale } } as Annotation) : a));
  }
  useStore.setState({ measureScale: scale, annotations, ...(list.length ? { dirty: true } : {}) });
  if (list.length) s.notify(tf('Updated {n} measurement(s) to the new scale.', { n: list.length }));
}

/** Calibrate: the measured line is `real` units long. Applies to all measurements. */
export function calibrateFrom(a: Annotation, real: number, unit: MeasureUnit) {
  if (!isMeasured(a) || a.measure.kind !== 'distance' || !(real > 0)) return;
  const [p1, p2] = pointsOf(a);
  const points = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (points < 1e-6) return;
  setMeasureScale(calibratedScale(points, real, unit), true);
}

export function exportMeasurementsCsv() {
  const list = measurements();
  if (!list.length) return S().notify(tr('There are no measurements in this document.'));
  const lang = useLang.getState().lang;
  const rows = list.map(({ page, a }) => ({
    page,
    kind: a.measure.kind,
    value: measuredValue(a.measure.kind, pointsOf(a), a.measure.scale),
    unit: a.measure.scale.unit,
    scale: a.measure.scale.label,
    author: a.author,
    comment: a.comment,
  }));
  // A byte order mark, so spreadsheet programs read the units (², …) correctly.
  const csv = '﻿' + measurementsCsv(rows, lang);
  downloadBlob(new Blob([csv], { type: 'text/csv' }), `${baseName(S().fileName || 'document')}-measurements.csv`, 'text/csv');
}
