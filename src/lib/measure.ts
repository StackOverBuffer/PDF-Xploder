/**
 * Measurements (distance, perimeter, area) on scaled drawings, as in PDF-XChange's
 * Measure tools. Each measurement keeps the scale it was made with; lengths in PDF
 * user space are points (1/72 in on paper), converted with that scale.
 */
import type { Pt } from './types';

export type MeasureKind = 'distance' | 'perimeter' | 'area';
export type MeasureUnit = 'mm' | 'cm' | 'm' | 'km' | 'in' | 'ft' | 'yd' | 'mi';

export interface MeasureScale {
  /** Real-world units per PDF point. */
  perPoint: number;
  unit: MeasureUnit;
  /** How the scale is described, e.g. "1:100". */
  label: string;
}

export interface Measure {
  kind: MeasureKind;
  scale: MeasureScale;
}

export const UNITS: MeasureUnit[] = ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi'];
const MM: Record<MeasureUnit, number> = { mm: 1, cm: 10, m: 1000, km: 1e6, in: 25.4, ft: 304.8, yd: 914.4, mi: 1609344 };
/** One point on paper, in millimetres. */
const POINT_MM = 25.4 / 72;

export const SCALE_PRESETS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];

/** A drawing scale 1:n with results in `unit`. */
export function paperScale(n: number, unit: MeasureUnit): MeasureScale {
  return { perPoint: (POINT_MM * n) / MM[unit], unit, label: `1:${+n.toPrecision(6)}` };
}

export const DEFAULT_SCALE: MeasureScale = paperScale(1, 'mm');

/** The scale at which a line of `points` length measures `real` units (calibration). */
export function calibratedScale(points: number, real: number, unit: MeasureUnit): MeasureScale {
  const perPoint = real / points;
  const n = (perPoint * MM[unit]) / POINT_MM;
  return { perPoint, unit, label: `≈ 1:${n < 10 ? n.toFixed(2) : Math.round(n)}` };
}

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

/** Length of an open path, in points. */
export function pathLength(points: Pt[], closed = false): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += dist(points[i - 1], points[i]);
  if (closed && points.length > 2) n += dist(points[points.length - 1], points[0]);
  return n;
}

/** Area of a polygon (shoelace formula), in square points. */
export function polygonArea(points: Pt[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** The measured value in real units (square units for an area). */
export function measuredValue(kind: MeasureKind, points: Pt[], scale: MeasureScale): number {
  if (kind === 'area') return polygonArea(points) * scale.perPoint * scale.perPoint;
  return pathLength(points, false) * scale.perPoint;
}

export function formatNumber(v: number, lang: string, digits = 2): string {
  return v.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** "12.35 m" or "48.20 m²". */
export function formatMeasure(kind: MeasureKind, value: number, unit: MeasureUnit, lang: string): string {
  return `${formatNumber(value, lang)} ${unit}${kind === 'area' ? '²' : ''}`;
}

/** The centre of a polygon's area (where an area label goes). */
export function centroid(points: Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = points.length || 1;
    return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Where a measurement's label sits: mid-line, the end of a path, the middle of an area. */
export function labelAnchor(kind: MeasureKind, points: Pt[]): Pt {
  if (kind === 'area') return centroid(points);
  if (kind === 'distance' && points.length >= 2) return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  return points[points.length - 1] ?? { x: 0, y: 0 };
}

/** A plain number for spreadsheets: no thousands separators, the language's decimal mark. */
const csvNumber = (v: number, lang: string) => (lang === 'de' ? v.toFixed(4).replace('.', ',') : v.toFixed(4));

/** Measurements as CSV (semicolon-separated in German, as spreadsheets there expect). */
export function measurementsCsv(rows: { page: number; kind: MeasureKind; value: number; unit: MeasureUnit; scale: string; author: string; comment?: string }[], lang: string): string {
  const sep = lang === 'de' ? ';' : ',';
  const esc = (s: string) => (s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = ['Page', 'Type', 'Value', 'Unit', 'Scale', 'Author', 'Comment'];
  const lines = rows.map((r) => [String(r.page + 1), r.kind, csvNumber(r.value, lang), r.kind === 'area' ? `${r.unit}²` : r.unit, r.scale, r.author, r.comment ?? ''].map(esc).join(sep));
  return [head.join(sep), ...lines].join('\r\n');
}
