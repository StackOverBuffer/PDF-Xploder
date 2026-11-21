import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFHexString, PDFName } from '@cantoo/pdf-lib';
import { formatSignedDate, materializeStampLabel, SIGN_MARK_NAMES } from '../src/lib/fillSign';
import { importAnnotations, writeNativeAnnotation } from '../src/lib/annotIO';
import { drawContext } from '../src/lib/pdfOps';
import type { PageGeom } from '../src/lib/types';

const day = new Date(2026, 10, 21); // months are 0-based
const g: PageGeom = { view: [0, 0, 300, 200], rotation: 0 };

describe('fill & sign helpers', () => {
  it('formats the date per language, without Intl', () => {
    expect(formatSignedDate('de', day)).toBe('21.11.2026');
    expect(formatSignedDate('en', day)).toBe('Nov 21, 2026');
    expect(formatSignedDate(undefined, day)).toBe('Nov 21, 2026');
  });

  it('materializes dynamic stamp labels, passes others through', () => {
    expect(materializeStampLabel('dynamic:Approved', 'Jane Doe', 'de', day)).toBe('Approved – Jane Doe – 21.11.2026');
    expect(materializeStampLabel('dynamic:Reviewed', 'Guest', 'en', day)).toBe('Reviewed – Guest – Nov 21, 2026');
    expect(materializeStampLabel('Approved', 'Jane Doe', 'de', day)).toBe('Approved');
  });

  it('names the marks as other editors expect', () => {
    expect(SIGN_MARK_NAMES).toEqual({ check: 'Checkmark', cross: 'Cross' });
  });

  it('writes a check as a named stamp and reads it back as a stamp kind', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 200]);
    const ctx = await drawContext(doc);
    const a = { id: 'x1', type: 'stamp', kind: 'check', rect: { x: 40, y: 80, w: 18, h: 18 }, label: 'Check', color: '#2e7d32', opacity: 1, author: 'A', createdAt: 0, rot: 0 } as const;
    await writeNativeAnnotation(ctx, doc.getPages()[0], g, a);
    const bytes = await doc.save();
    const back = await PDFDocument.load(bytes);
    const res = await importAnnotations(back, [g], () => 'n1');
    expect(res.count).toBe(1);
    expect(res.annotations[0][0]).toMatchObject({ type: 'stamp', kind: 'check', name: 'Checkmark' });
  });

  it('maps another program\'s Checkmark stamp without an appearance to a check', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    page.node.set(PDFName.of('Annots'), doc.context.obj([
      doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [10, 10, 28, 28], Name: 'Checkmark', T: PDFHexString.fromText('B'), F: 4 })),
    ]));
    const res = await importAnnotations(doc, [g], () => 'n2');
    expect(res.annotations[0][0]).toMatchObject({ type: 'stamp', kind: 'check' });
  });
});
