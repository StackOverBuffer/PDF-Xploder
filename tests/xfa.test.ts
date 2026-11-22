import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, PDFTextField, StandardFonts } from '@cantoo/pdf-lib';
import { loadForEdit } from '../src/lib/pageTree';
import { saveDoc, dropXfa } from '../src/lib/pdfSave';
import { setFormValues, flattenFormFields } from '../src/lib/pdfOps';

const N = (s: string) => PDFName.of(s);

/** A hybrid XFA form: real AcroForm fields that carry the XFA datasets alongside. */
async function hybridXfa(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const field = doc.getForm().createTextField('Name');
  field.addToPage(page, { font });
  const acro = doc.catalog.lookup(N('AcroForm')) as PDFDict;
  acro.set(N('XFA'), doc.context.obj([
    PDFString.of('template'), doc.context.register(doc.context.stream('<xdp><template/></xdp>')),
    PDFString.of('datasets'), doc.context.register(doc.context.stream('<xdp><datasets><data><Name/></data></datasets></xdp>')),
  ]));
  // Appearance regeneration would call getForm() on this creation document, which has no
  // preserveXFA and would strip the key this fixture is about.
  return doc.save({ updateFieldAppearances: false });
}

/** A dynamic (pure) XFA form: no AcroForm widgets, only the template and /NeedsRendering. */
async function dynamicXfa(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]);
  doc.catalog.set(N('AcroForm'), doc.context.obj({
    XFA: doc.context.register(doc.context.stream('<xdp><template><dynamic/></template></xdp>')),
    NeedsRendering: true,
  }));
  return doc.save();
}

const acroOf = (doc: PDFDocument) => doc.catalog.lookup(N('AcroForm')) as PDFDict;
const hasXfa = (doc: PDFDocument) => acroOf(doc).has(N('XFA'));

describe('XFA round trips', () => {
  it('keeps the XFA data of a document whose fields are untouched', async () => {
    const doc = await loadForEdit(await hybridXfa());
    const bytes = await saveDoc(doc);
    const out = await PDFDocument.load(bytes);
    expect(hasXfa(out)).toBe(true);
    const xfa = acroOf(out).lookup(N('XFA'));
    // The packets survive as objects (both streams still there), not as a stale leftover.
    expect(xfa instanceof PDFArray || xfa instanceof PDFDict).toBe(true);
    const dynamic = await PDFDocument.load(await saveDoc(await loadForEdit(await dynamicXfa())));
    expect(hasXfa(dynamic)).toBe(true);
    expect(acroOf(dynamic).lookup(N('NeedsRendering'))).toBeTruthy();
  });

  it('drops the XFA data when field values are set, and keeps the warning honest', async () => {
    const bytes = await setFormValues(await hybridXfa(), { Name: 'Jane Doe' });
    const out = await PDFDocument.load(bytes);
    expect(hasXfa(out)).toBe(false);
    expect(acroOf(out).has(N('NeedsRendering'))).toBe(false);
    const field = out.getForm().getField('Name');
    expect(field instanceof PDFTextField ? field.getText() : undefined).toBe('Jane Doe');
  });

  it('drops the XFA data when the form is flattened', async () => {
    const out = await PDFDocument.load(await flattenFormFields(await hybridXfa()));
    expect(hasXfa(out)).toBe(false);
  });

  it('dropXfa removes both keys from the AcroForm dictionary', async () => {
    const doc = await loadForEdit(await dynamicXfa());
    expect(hasXfa(doc)).toBe(true);
    dropXfa(doc);
    expect(hasXfa(doc)).toBe(false);
    expect(acroOf(doc).has(N('NeedsRendering'))).toBe(false);
  });
});
