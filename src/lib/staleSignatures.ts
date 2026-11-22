/**
 * A signed document saved as a full rewrite: its signatures no longer match the bytes.
 * Left as they are, every viewer shows them as broken (or, with a visible signature,
 * still shows "signed by …" on the page). They become empty signature fields instead,
 * which can be signed again; the certification permissions that pointed at them go.
 */
import { PDFArray, PDFDict, PDFName, PDFNumber, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib';

const N = (s: string) => PDFName.of(s);

/** Clear the signature values of `doc`; returns how many there were. */
export function clearSignatures(doc: PDFDocument): number {
  const ctx = doc.context;
  const form = doc.catalog.lookup(N('AcroForm'));
  if (!(form instanceof PDFDict)) return 0;
  let n = 0;
  const seen = new Set<PDFObject>();
  const visit = (o: PDFObject | undefined, inheritedFt: string | undefined, depth: number) => {
    const d = o ? ctx.lookup(o) : undefined;
    if (!(d instanceof PDFDict) || seen.has(d) || depth > 32) return;
    seen.add(d);
    const ft = d.lookup(N('FT'))?.toString() ?? inheritedFt;
    if (ft === '/Sig' && d.has(N('V'))) {
      d.delete(N('V'));
      d.delete(N('Lock'));
      n++;
    }
    // The widget's drawing of the old signature goes too (the field is a widget, or has some).
    if (ft === '/Sig') {
      if (d.lookup(N('Subtype'))?.toString() === '/Widget') d.delete(N('AP'));
      const kids = d.lookup(N('Kids'));
      if (kids instanceof PDFArray) for (const k of kids.asArray()) {
        const w = ctx.lookup(k);
        if (w instanceof PDFDict && !w.has(N('T')) && w.lookup(N('Subtype'))?.toString() === '/Widget') w.delete(N('AP'));
      }
    }
    const kids = d.lookup(N('Kids'));
    if (kids instanceof PDFArray) for (const k of kids.asArray()) visit(k, ft, depth + 1);
  };
  const fields = form.lookup(N('Fields'));
  if (fields instanceof PDFArray) for (const f of fields.asArray()) visit(f, undefined, 0);
  if (n) {
    doc.catalog.delete(N('Perms'));
    const flags = form.lookup(N('SigFlags'));
    if (flags instanceof PDFNumber) form.set(N('SigFlags'), PDFNumber.of(0));
  }
  return n;
}
