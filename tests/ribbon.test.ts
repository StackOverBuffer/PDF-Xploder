import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { addAttachment, listAttachments, readAttachment, removeAttachment } from '../src/lib/attachments';
import { applyAccessibilityFix, checkAccessibility } from '../src/lib/accessibility';
import { formatPercent, parsePercent, translate } from '../src/lib/i18n';
import { frameGeom, pageGeom, pageRot, pdfToView, viewSize, withViewRotation } from '../src/lib/geometry';

async function blank(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  return doc.save();
}

describe('attachments', () => {
  it('adds, lists, reads and removes embedded files with unique keys', async () => {
    const data = new TextEncoder().encode('hello, attachment');
    let bytes = await addAttachment(await blank(), { name: 'notes.txt', type: 'text/plain', bytes: data }, 'Some notes');
    bytes = await addAttachment(bytes, { name: 'notes.txt', type: 'text/plain', bytes: new Uint8Array([1, 2, 3]) });
    const list = await listAttachments(bytes);
    // The name tree is kept sorted, so compare as a set.
    expect(list.map((a) => a.key).sort()).toEqual(['notes (2).txt', 'notes.txt']);
    expect(list.find((a) => a.key === 'notes.txt')).toMatchObject({ fileName: 'notes.txt', description: 'Some notes', size: data.length, mimeType: 'text/plain' });
    expect(new TextDecoder().decode(await readAttachment(bytes, 'notes.txt'))).toBe('hello, attachment');
    bytes = await removeAttachment(bytes, 'notes.txt');
    expect((await listAttachments(bytes)).map((a) => a.key)).toEqual(['notes (2).txt']);
    expect(Array.from(await readAttachment(bytes, 'notes (2).txt'))).toEqual([1, 2, 3]);
  });

  it('lists nothing for a document without attachments', async () => {
    expect(await listAttachments(await blank())).toEqual([]);
  });
});

describe('accessibility check', () => {
  it('reports missing structure and fixes language, title and title display', async () => {
    let bytes = await blank();
    const before = await checkAccessibility(bytes, [0], [], true);
    const status = (r: typeof before) => Object.fromEntries(r.map((x) => [x.id, x.status]));
    expect(status(before)).toMatchObject({ tagged: 'fail', lang: 'fail', title: 'fail', displayTitle: 'warn', text: 'warn', security: 'pass' });
    bytes = await applyAccessibilityFix(bytes, 'lang', 'de-DE');
    bytes = await applyAccessibilityFix(bytes, 'title', 'Bericht');
    const after = await checkAccessibility(bytes, [12], [], false);
    expect(status(after)).toMatchObject({ lang: 'pass', title: 'pass', displayTitle: 'pass', text: 'pass', security: 'fail' });
    expect(after.find((r) => r.id === 'lang')!.detail).toContain('de-DE');
  });
});

describe('ribbon helpers', () => {
  it('translates and formats zoom levels per language', () => {
    expect(translate('de', 'Select Text')).toBe('Textauswahl');
    expect(translate('de', 'No such label')).toBe('No such label');
    expect(translate('en', 'Select Text')).toBe('Select Text');
    expect(formatPercent('de', 1.5814)).toBe('158,14%');
    expect(formatPercent('en', 1.5814)).toBe('158.14%');
    expect(parsePercent('158,14 %')).toBeCloseTo(1.5814);
    expect(parsePercent('75')).toBe(0.75);
    expect(parsePercent('abc')).toBeNull();
    expect(parsePercent('0')).toBeNull();
  });

  it('rotates the view without changing the page rotation', () => {
    const [g] = withViewRotation([{ view: [0, 0, 400, 300], rotation: 90 }], 90);
    expect(g).toEqual({ view: [0, 0, 400, 300], rotation: 180, pageRotation: 90 });
    expect(pageRot(g)).toBe(90);
    expect(pageGeom(g)).toEqual({ view: [0, 0, 400, 300], rotation: 90 });
    expect(viewSize(g)).toEqual({ width: 400, height: 300 });
    // Rotating back restores the original geometry.
    expect(withViewRotation([g], 0)[0]).toEqual({ view: [0, 0, 400, 300], rotation: 90 });
    // Comments without a frame are drawn in the page's own orientation.
    expect(frameGeom(g, undefined)).toEqual(pageGeom(g));
    // The top-left corner in user space moves to the bottom-right when turned by 180°.
    const [h] = withViewRotation([{ view: [0, 0, 400, 300], rotation: 0 }], 180);
    expect(pdfToView(h, { x: 0, y: 300 })).toEqual({ x: 400, y: 300 });
  });
});
