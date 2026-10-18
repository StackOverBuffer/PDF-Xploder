import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFDict } from '@cantoo/pdf-lib';
import { calibratedScale, centroid, formatMeasure, measuredValue, measurementsCsv, paperScale, pathLength, polygonArea } from '../src/lib/measure';
import { code128Widths, ean13CheckDigit, ean13Digits, ean13Widths, qrModules } from '../src/lib/barcode';
import * as ops from '../src/lib/pdfOps';
import type { Annotation, LineAnnot, PolygonAnnot } from '../src/lib/types';

const MM = 72 / 25.4; // points per millimetre

describe('measurement scales', () => {
  it('converts paper points to real units', () => {
    // 1:100 in metres: 1 cm on paper is 1 m.
    const s = paperScale(100, 'm');
    expect(s.label).toBe('1:100');
    expect(10 * MM * s.perPoint).toBeCloseTo(1);
    // 1:1 in mm: a millimetre is a millimetre.
    expect(MM * paperScale(1, 'mm').perPoint).toBeCloseTo(1);
    expect(72 * paperScale(1, 'in').perPoint).toBeCloseTo(1);
  });

  it('calibrates from a line of known length', () => {
    // A 200 pt line that is 5 m long.
    const s = calibratedScale(200, 5, 'm');
    expect(s.perPoint).toBeCloseTo(0.025);
    expect(measuredValue('distance', [{ x: 0, y: 0 }, { x: 120, y: 160 }], s)).toBeCloseTo(5);
    // 25 mm per point (0.353 mm on paper) is about 1:71.
    expect(s.label).toBe('≈ 1:71');
  });

  it('measures lengths and areas', () => {
    const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    expect(pathLength(square)).toBe(300);
    expect(pathLength(square, true)).toBe(400);
    expect(polygonArea(square)).toBe(10000);
    expect(polygonArea([...square].reverse())).toBe(10000);
    expect(centroid(square)).toEqual({ x: 50, y: 50 });
    // 1:100 in m: 100 pt is 3.528 m, so the square is 12.45 m².
    const s = paperScale(100, 'm');
    expect(measuredValue('area', square, s)).toBeCloseTo(12.445, 2);
    expect(formatMeasure('area', 12.4451, 'm', 'de')).toBe('12,45 m²');
    expect(formatMeasure('distance', 1234.5, 'mm', 'en')).toBe('1,234.50 mm');
  });

  it('exports CSV with the language’s separators', () => {
    const rows = [{ page: 0, kind: 'area' as const, value: 12.5, unit: 'm' as const, scale: '1:100', author: 'Ann', comment: 'Room; north' }];
    expect(measurementsCsv(rows, 'de').split('\r\n')[1]).toBe('1;area;12,5000;m²;1:100;Ann;"Room; north"');
    expect(measurementsCsv(rows, 'en').split('\r\n')[1]).toBe('1,area,12.5000,m²,1:100,Ann,Room; north');
  });
});

describe('barcodes', () => {
  it('encodes Code 128 symbols of 11 modules plus a 13-module stop', () => {
    const w = code128Widths('Hello 123456');
    expect(w.reduce((a, b) => a + b, 0) % 11).toBe(2);
    expect(() => code128Widths('Grüße')).toThrow(/no accents/);
  });

  it('adds and checks the EAN-13 check digit', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(ean13Digits('400638133393')).toBe('4006381333931');
    expect(() => ean13Digits('4006381333932')).toThrow(/check digit/);
    expect(() => ean13Digits('12345')).toThrow(/12 digits/);
    // 95 modules: guards 3 + 5 + 3 and 12 digits of 7.
    expect(ean13Widths('400638133393').reduce((a, b) => a + b, 0)).toBe(95);
  });

  it('makes square QR codes with finder patterns', () => {
    const m = qrModules('https://example.com', 'M');
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((r) => r.length === m.length)).toBe(true);
    // Top-left finder: a dark 7×7 ring.
    expect(m[0].slice(0, 7).every(Boolean)).toBe(true);
    expect(m[6].slice(0, 7).every(Boolean)).toBe(true);
  });
});

describe('measurements in the PDF', () => {
  it('are saved with the standard measure entries and come back as measurements', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 400]);
    const bytes = await doc.save();
    const scale = paperScale(50, 'm');
    const a: Annotation = { id: 'm1', type: 'line', color: '#1565c0', opacity: 1, author: 'Ann', createdAt: 0, width: 1, p1: { x: 100, y: 100 }, p2: { x: 300, y: 100 }, measure: { kind: 'distance', scale } };
    const area: Annotation = { id: 'm2', type: 'polygon', color: '#1565c0', opacity: 0.6, author: 'Ann', createdAt: 0, width: 1, fill: '#90caf9', vertices: [{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 150 }], measure: { kind: 'area', scale } };
    const out = await ops.exportWithAnnotations(bytes, [[a, area]]);
    const saved = await PDFDocument.load(out);
    const annots = saved.getPage(0).node.Annots()!.asArray().map((r) => saved.context.lookup(r) as PDFDict);
    expect(annots.map((d) => d.lookup(PDFName.of('IT'))?.toString())).toEqual(['/LineDimension', '/PolygonDimension']);
    const measure = annots[0].lookup(PDFName.of('Measure')) as PDFDict;
    expect(measure.lookup(PDFName.of('Subtype'))?.toString()).toBe('/RL');
    const back = await ops.importForEditing(out, () => 'x');
    const [line, poly] = back.annotations[0] as (LineAnnot | PolygonAnnot)[];
    expect(line.measure).toEqual({ kind: 'distance', scale });
    expect(poly.measure?.kind).toBe('area');
  });
});
