import { describe, expect, it } from 'vitest';
import { decodePDFRawStream, PDFArray, PDFDict, PDFRawStream, PDFDocument, PDFHexString, PDFName, PDFString } from '@cantoo/pdf-lib';
import * as ops from '../src/lib/pdfOps';

const N = (s: string) => PDFName.of(s);

/** Annotations from another program, with keys our model does not hold. */
async function foreignDoc(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;
  const M = PDFString.of('D:20200101120000Z');
  const ap = (bbox: number[]) => ctx.register(ctx.stream('0 0 1 rg 0 0 5 5 re f', { Type: 'XObject', Subtype: 'Form', BBox: bbox }));
  const annots = [
    ctx.obj({ Type: 'Annot', Subtype: 'Squiggly', Rect: [10, 10, 60, 20], QuadPoints: [10, 20, 60, 20, 10, 10, 60, 10], C: [1, 0, 0], M, NM: PDFHexString.fromText('sq'), T: PDFHexString.fromText('Ann'), AP: { N: ap([10, 10, 60, 20]) } }),
    ctx.obj({ Type: 'Annot', Subtype: 'Line', Rect: [100, 100, 200, 200], L: [100, 100, 200, 200], LE: ['ClosedArrow', 'ClosedArrow'], BS: { W: 2, S: 'D', D: [3, 2] }, C: [0, 0, 1], M, NM: PDFHexString.fromText('ln'), T: PDFHexString.fromText('Ann'), AP: { N: ap([100, 100, 200, 200]) } }),
    ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [300, 300, 320, 320], Name: 'Help', Contents: PDFHexString.fromText('why?'), C: [1, 1, 0], M, NM: PDFHexString.fromText('nt'), T: PDFHexString.fromText('Ann'), AP: { N: ap([300, 300, 320, 320]) } }),
    ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [20, 200, 80, 260], BE: { S: 'Cloudy', I: 2 }, C: [0, 1, 0], M, Custom: 'Kept', RC: PDFString.of('<body>x</body>'), NM: PDFHexString.fromText('cl'), T: PDFHexString.fromText('Ann'), AP: { N: ap([20, 200, 80, 260]) } }),
  ].map((d) => ctx.register(d));
  page.node.set(N('Annots'), ctx.obj(annots));
  return doc.save();
}

async function dicts(bytes: Uint8Array): Promise<Map<string, PDFDict>> {
  const doc = await PDFDocument.load(bytes);
  const out = new Map<string, PDFDict>();
  for (const r of doc.getPage(0).node.Annots()?.asArray() ?? []) {
    const d = doc.context.lookup(r) as PDFDict;
    const nm = d.lookup(N('NM'));
    if (nm instanceof PDFHexString || nm instanceof PDFString) out.set(nm.decodeText(), d);
  }
  return out;
}

const str = (d: PDFDict, k: string) => d.lookup(N(k))?.toString();

describe("other programs' annotations", () => {
  it('are written back as they were when nobody edited them', async () => {
    const opened = await ops.importForEditing(await foreignDoc());
    expect(opened.count).toBe(4);
    const out = await ops.exportWithAnnotations(opened.bytes, opened.annotations, { author: 'Me' });
    const d = await dicts(out);
    expect(str(d.get('sq')!, 'Subtype')).toBe('/Squiggly');
    expect(str(d.get('ln')!, 'LE')).toBe('[ /ClosedArrow /ClosedArrow ]');
    expect((d.get('ln')!.lookup(N('BS')) as PDFDict).lookup(N('S'))?.toString()).toBe('/D');
    expect(str(d.get('nt')!, 'Name')).toBe('/Help');
    expect(str(d.get('cl')!, 'BE')).toContain('/Cloudy');
    expect(str(d.get('cl')!, 'Custom')).toBe('/Kept');
    expect(str(d.get('cl')!, 'RC')).toBe('(<body>x</body>)');
    // Modification dates stay: nothing was modified.
    for (const x of d.values()) expect(str(x, 'M')).toBe('(D:20200101120000Z)');
    // The squiggle keeps its own drawing, in its own place.
    const rect = (d.get('sq')!.lookup(N('Rect')) as PDFArray).asArray().map(String);
    expect(rect).toEqual(['10', '10', '60', '20']);
  });

  it('take our keys once edited, keeping only what does not describe the old drawing', async () => {
    const opened = await ops.importForEditing(await foreignDoc());
    const edited = opened.annotations.map((l) => l.map((a) => (a.id === 'cl' ? { ...a, color: '#ff00ff' } : a)));
    const d = await dicts(await ops.exportWithAnnotations(opened.bytes, edited, { author: 'Me' }));
    const cl = d.get('cl')!;
    expect(str(cl, 'C')).toBe('[ 1 0 1 ]');
    expect(str(cl, 'Custom')).toBe('/Kept');
    expect(cl.has(N('RC'))).toBe(false);
    expect(cl.has(N('BE'))).toBe(false);
    expect(str(cl, 'M')).not.toBe('(D:20200101120000Z)');
    // The others are still untouched.
    expect(str(d.get('sq')!, 'Subtype')).toBe('/Squiggly');
  });

  it('survive a second open and save', async () => {
    const first = await ops.importForEditing(await foreignDoc());
    const saved = await ops.exportWithAnnotations(first.bytes, first.annotations, { author: 'Me' });
    const again = await ops.importForEditing(saved);
    const d = await dicts(await ops.exportWithAnnotations(again.bytes, again.annotations, { author: 'Me' }));
    expect(str(d.get('ln')!, 'LE')).toBe('[ /ClosedArrow /ClosedArrow ]');
    expect(str(d.get('nt')!, 'Name')).toBe('/Help');
    // Still the other program's drawing (embedded), not our underline.
    const doc = await PDFDocument.load(await ops.exportWithAnnotations(again.bytes, again.annotations, { author: 'Me' }));
    const sq = doc.getPage(0).node.Annots()!.asArray().map((r) => doc.context.lookup(r) as PDFDict).find((x) => x.lookup(N('Subtype'))?.toString() === '/Squiggly')!;
    const n = (sq.lookup(N('AP')) as PDFDict).lookup(N('N')) as PDFRawStream;
    expect(Buffer.from(decodePDFRawStream(n).decode()).toString('latin1')).toMatch(/\/Ap\d+ Do/);
  });
});

describe('after Sanitize', () => {
  it('saves comments with standard keys only, and Sanitize strips ours from the file', async () => {
    const { sanitizeDocument } = await import('../src/lib/sanitize');
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    const rect = { id: 'r1', type: 'rect', rect: { x: 10, y: 10, w: 50, h: 50 }, width: 2, color: '#ff0000', opacity: 1, author: 'Jo', createdAt: 0 } as never;
    const hasPrivate = async (b: Uint8Array) => {
      const d = await PDFDocument.load(b);
      return (d.getPage(0).node.Annots()?.asArray() ?? []).some((r) => (d.context.lookup(r) as PDFDict).has(N('AwesomePDF')));
    };
    const withPrivate = await ops.exportWithAnnotations(await doc.save(), [[rect]]);
    expect(await hasPrivate(withPrivate)).toBe(true);
    const loaded = await PDFDocument.load(withPrivate);
    const report = sanitizeDocument(loaded, { hiddenData: true });
    expect(report.hiddenData).toBe(1);
    expect(await hasPrivate(await loaded.save())).toBe(false);
    const plain = await ops.exportWithAnnotations(await doc.save(), [[rect]], { privateData: false });
    expect(await hasPrivate(plain)).toBe(false);
    expect((await ops.importForEditing(plain)).annotations[0][0]).toMatchObject({ type: 'rect', author: 'Jo' });
  });
});
