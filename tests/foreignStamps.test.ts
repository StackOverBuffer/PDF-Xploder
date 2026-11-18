import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFHexString, PDFName, PDFDict, PDFArray } from '@cantoo/pdf-lib';
import { exportWithAnnotations, importForEditing } from '../src/lib/pdfOps';
import type { Annotation } from '../src/lib/types';

/** A page with another program's stamp (own drawing), a reply to it, and a reply to the reply. */
async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;
  // The drawing: a red cross in a 0..40 box, moved by /Matrix as PDF-XChange does.
  const ap = ctx.register(ctx.formXObject([], { BBox: [100, 100, 140, 140], Matrix: [1, 0, 0, 1, -100, -100] }));
  (ctx.lookup(ap) as { contents?: Uint8Array }).contents = new TextEncoder().encode('1 0 0 RG 4 w 100 100 m 140 140 l S 100 140 m 140 100 l S');
  const stamp = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Stamp', Rect: [50, 300, 90, 340], AP: { N: ap }, Name: 'SB#2CCool',
    Subj: PDFHexString.fromText('Accesspoint'), Contents: PDFHexString.fromText('Hello'), T: PDFHexString.fromText('Jo'),
    NM: PDFHexString.fromText('stamp-1'), CreationDate: 'D:20261021211802Z', F: 4, C: [1, 0, 0],
  }));
  const reply = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [50, 322, 70, 340], IRT: stamp, Contents: PDFHexString.fromText('An answer'),
    T: PDFHexString.fromText('Ann'), NM: PDFHexString.fromText('reply-1'), CreationDate: 'D:20261021211900Z', F: 28,
  }));
  const reply2 = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [50, 322, 70, 340], IRT: reply, Contents: PDFHexString.fromText('Answer to the answer'),
    T: PDFHexString.fromText('Jo'), NM: PDFHexString.fromText('reply-2'), CreationDate: 'D:20261021212000Z', F: 28,
  }));
  page.node.set(PDFName.of('Annots'), ctx.obj([stamp, reply, reply2]));
  return doc.save();
}

const stampOf = (a: Annotation[][]) => a[0].find((x) => x.type === 'stamp') as Extract<Annotation, { type: 'stamp' }>;

describe('stamps from other programs and replies', () => {
  it('imports the stamp with its drawing, comment, subject and thread', async () => {
    const r = await importForEditing(await sample());
    expect(r.count).toBe(1);
    expect(r.annotations[0]).toHaveLength(1);
    const s = stampOf(r.annotations);
    expect(s).toMatchObject({ comment: 'Hello', subject: 'Accesspoint', label: 'Accesspoint', author: 'Jo', rect: { x: 50, y: 300, w: 40, h: 40 } });
    expect(s.appearance).toBeTruthy();
    // The drawing is a one-page PDF of the stamp's size.
    const ap = await PDFDocument.load(Uint8Array.from(atob(s.appearance!), (c) => c.charCodeAt(0)));
    expect(ap.getPage(0).getSize()).toEqual({ width: 40, height: 40 });
    expect(s.replies?.map((x) => `${x.author}: ${x.text}`)).toEqual(['Ann: An answer', 'Jo: Answer to the answer']);
    // Nothing of it is left in the page (it would be drawn twice).
    const doc = await PDFDocument.load(r.bytes);
    expect(doc.getPage(0).node.Annots()).toBeUndefined();
  });

  it('saves them so other programs see the stamp, comment, subject and replies, and reads them back', async () => {
    const r = await importForEditing(await sample());
    const out = await exportWithAnnotations(r.bytes, r.annotations);
    const doc = await PDFDocument.load(out);
    const annots = (doc.getPage(0).node.Annots() as PDFArray).asArray().map((x) => doc.context.lookup(x) as PDFDict);
    const stamp = annots.find((d) => d.get(PDFName.of('Subtype')) === PDFName.of('Stamp'))!;
    expect((stamp.lookup(PDFName.of('Subj')) as PDFHexString).decodeText()).toBe('Accesspoint');
    expect((stamp.lookup(PDFName.of('Name')) as PDFName).decodeText()).toBe('SB,Cool');
    const replies = annots.filter((d) => d.get(PDFName.of('IRT')));
    expect(replies).toHaveLength(2);
    expect(replies.every((d) => d.lookup(PDFName.of('IRT')) === stamp)).toBe(true);
    const again = await importForEditing(out);
    const s = stampOf(again.annotations);
    expect(s).toMatchObject({ comment: 'Hello', subject: 'Accesspoint' });
    expect(s.appearance).toBe(stampOf(r.annotations).appearance);
    expect(s.replies?.map((x) => x.text)).toEqual(['An answer', 'Answer to the answer']);
  });
});

/** A page with another program's text box: Times, drawn by its own appearance stream. */
async function textBoxSample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Times-Roman' }));
  const ap = ctx.register(ctx.formXObject([], { BBox: [0, 0, 200, 30], Resources: { Font: { TiRo: font } } }));
  (ctx.lookup(ap) as { contents?: Uint8Array }).contents = new TextEncoder().encode('BT /TiRo 12 Tf 0 0 1 rg 2 10 Td (Times text, as drawn) Tj ET');
  const box = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'FreeText', Rect: [50, 300, 250, 330], AP: { N: ap }, DA: PDFHexString.fromText('/TimesNewRomanPSMT 12 Tf 0 0 1 rg'),
    Contents: PDFHexString.fromText('Times text, as drawn'), T: PDFHexString.fromText('Jo'), NM: PDFHexString.fromText('box-1'), F: 4,
  }));
  page.node.set(PDFName.of('Annots'), ctx.obj([box]));
  return doc.save();
}

/** Font names used by the appearance of the page's FreeText (through embedded pages, too). */
function appearanceFonts(doc: PDFDocument): string[] {
  const annots = (doc.getPage(0).node.Annots() as PDFArray).asArray().map((x) => doc.context.lookup(x) as PDFDict);
  const box = annots.find((d) => d.get(PDFName.of('Subtype')) === PDFName.of('FreeText'))!;
  const names: string[] = [];
  const seen = new Set<unknown>();
  const walk = (o: unknown) => {
    if (seen.has(o)) return;
    seen.add(o);
    if (o instanceof PDFDict || (o && typeof o === 'object' && 'dict' in o)) {
      const d = o instanceof PDFDict ? o : (o as { dict: PDFDict }).dict;
      if (d.get(PDFName.of('Type')) === PDFName.of('Font')) names.push(String(d.get(PDFName.of('BaseFont'))));
      for (const [, v] of d.entries()) walk(doc.context.lookup(v as never) ?? v);
    } else if (o instanceof PDFArray) for (const v of o.asArray()) walk(doc.context.lookup(v as never) ?? v);
  };
  walk((box.lookup(PDFName.of('AP')) as PDFDict).lookup(PDFName.of('N')));
  return names;
}

describe('text boxes from other programs', () => {
  it('keep their own drawing while unchanged, also after saving and reopening', async () => {
    const r = await importForEditing(await textBoxSample());
    const box = r.annotations[0][0] as Extract<Annotation, { type: 'text' }>;
    expect(box).toMatchObject({ type: 'text', text: 'Times text, as drawn' });
    expect(box.appearance).toBeTruthy();
    const out = await exportWithAnnotations(r.bytes, r.annotations);
    expect(appearanceFonts(await PDFDocument.load(out))).toEqual(['/Times-Roman']);
    // Reopened in PDF-Xploder and saved again: still the original drawing.
    const again = await importForEditing(out);
    const out2 = await exportWithAnnotations(again.bytes, again.annotations);
    expect(appearanceFonts(await PDFDocument.load(out2))).toEqual(['/Times-Roman']);
  });

  it('are drawn anew once edited', async () => {
    const r = await importForEditing(await textBoxSample());
    const box = r.annotations[0][0] as Extract<Annotation, { type: 'text' }>;
    const edited = [[{ ...box, text: 'Changed text' }]];
    const out = await exportWithAnnotations(r.bytes, edited);
    const fonts = appearanceFonts(await PDFDocument.load(out));
    expect(fonts).not.toContain('/Times-Roman');
    expect(fonts.length).toBeGreaterThan(0);
    // The old drawing is not carried along any more.
    const again = await importForEditing(out);
    expect((again.annotations[0][0] as Extract<Annotation, { type: 'text' }>).appearance).toBeUndefined();
  });
});
