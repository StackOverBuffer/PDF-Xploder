import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from '@cantoo/pdf-lib';
import * as ops from '../src/lib/pdfOps';

/** All decoded stream contents of a file, as text. */
async function streamText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let out = '';
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        out += new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode());
      } catch {
        /* image or unsupported filter */
      }
    }
  }
  return out;
}

async function secretDoc() {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 300]).drawText('PUBLIC', { x: 20, y: 200, font: f });
  doc.addPage([300, 300]).drawText('TOPSECRET', { x: 20, y: 200, font: f });
  return doc.save();
}
// pdf-lib writes standard-font text as hex strings.
const hex = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');

describe('saving leaves out unreachable objects', () => {
  it('a deleted page leaves nothing behind', async () => {
    const bytes = await secretDoc();
    expect(await streamText(bytes)).toContain(hex('TOPSECRET'));
    const out = await ops.deletePages(bytes, [1]);
    const text = await streamText(out);
    expect(text).toContain(hex('PUBLIC'));
    expect(text).not.toContain(hex('TOPSECRET'));
  });

  it('a redacted page keeps only its image', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
    const { bytes } = await ops.replacePagesWithImages(await secretDoc(), [{ index: 1, png }]);
    expect(await streamText(bytes)).not.toContain(hex('TOPSECRET'));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });
});

describe('saving files pdf-lib would refuse', () => {
  it('saves PDF/A-1 files without object streams instead of failing', async () => {
    const { PDFName } = await import('@cantoo/pdf-lib');
    const { saveDoc, isPdfA1 } = await import('../src/lib/pdfSave');
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" pdfaid:part="1" pdfaid:conformance="B"/></rdf:RDF></x:xmpmeta>';
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' })));
    const loaded = await PDFDocument.load(await doc.save({ useObjectStreams: false }));
    expect(isPdfA1(loaded)).toBe(true);
    const out = await ops.rotatePages(await saveDoc(loaded), [0], 90);
    expect(new TextDecoder('latin1').decode(out)).not.toContain('/ObjStm');
    expect((await PDFDocument.load(out)).getPage(0).getRotation().angle).toBe(90);
  });

  it('adds Document Properties the XMP does not have yet, so PDF/A files stay consistent', async () => {
    const { PDFName } = await import('@cantoo/pdf-lib');
    const { saveDoc } = await import('../src/lib/pdfSave');
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" pdfaid:part="2" pdfaid:conformance="B"/></rdf:RDF></x:xmpmeta>';
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' })));
    doc.setTitle('Plan & <Budget>');
    doc.setAuthor('Jo');
    doc.setCreator('Writer');
    const text = await streamText(await saveDoc(doc));
    expect(text).toContain('<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Plan &amp; &lt;Budget&gt;</rdf:li></rdf:Alt></dc:title>');
    expect(text).toContain('<dc:creator><rdf:Seq><rdf:li>Jo</rdf:li></rdf:Seq></dc:creator>');
    expect(text).toContain('<xmp:CreatorTool>Writer</xmp:CreatorTool>');
    expect(text).toContain('pdfaid:part="2"');
  });

  it('fills forms whose widgets have a broken appearance (/AP << /N 0 0 R >>)', async () => {
    const { PDFName, PDFRef } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const form = doc.getForm();
    form.createTextField('broken').addToPage(page, { x: 20, y: 200, width: 200, height: 20 });
    form.createTextField('fine').addToPage(page, { x: 20, y: 150, width: 200, height: 20 });
    const loaded = await PDFDocument.load(await doc.save());
    const widget = loaded.getForm().getTextField('broken').acroField.getWidgets()[0];
    widget.dict.set(PDFName.of('AP'), loaded.context.obj({ N: PDFRef.of(0) }));
    const bytes = await loaded.save({ updateFieldAppearances: false });
    // Filling another field makes pdf-lib check every field's appearance on save.
    const out = await ops.setFormValues(bytes, { fine: 'World' });
    expect((await PDFDocument.load(out)).getForm().getTextField('fine').getText()).toBe('World');
    const out2 = await ops.setFormValues(out, { broken: 'Hello' });
    expect((await PDFDocument.load(out2)).getForm().getTextField('broken').getText()).toBe('Hello');
  });
});
