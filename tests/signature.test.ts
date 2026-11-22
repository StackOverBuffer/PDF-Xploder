import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { createTestCertificate, readP12, signPdf, verifySignatures } from '../src/lib/signature';

async function doc(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  d.addPage([300, 300]).drawText('Contract', { x: 20, y: 250, size: 14, font });
  d.addPage([300, 300]);
  return d.save();
}

/** Every startxref of the file points at its cross-reference section ("xref" or an xref stream). */
function xrefOffsetsValid(bytes: Uint8Array): boolean {
  const s = new TextDecoder('latin1').decode(bytes);
  const offsets = [...s.matchAll(/startxref\s+(\d+)/g)].map((m) => Number(m[1]));
  return offsets.length > 0 && offsets.every((o) => s.startsWith('xref', o) || /^\d+ \d+ obj/.test(s.slice(o, o + 20)));
}

describe('digital signatures', () => {
  let p12: Uint8Array;

  it('creates a self-signed test identity and reads it back', async () => {
    p12 = await createTestCertificate({ name: 'Ada Lövelace', email: 'ada@example.com', password: 'pw' });
    const id = await readP12(p12, 'pw');
    expect(id).toMatchObject({ name: 'Ada Lövelace', email: 'ada@example.com', issuer: 'Ada Lövelace' });
    await expect(readP12(p12, 'wrong')).rejects.toThrow('Wrong certificate password.');
  });

  it('signs visibly, verifies, and keeps the first signature intact when signing again', async () => {
    const id = await readP12(p12, 'pw');
    const original = await doc();
    const once = await signPdf(original, { identity: id, reason: 'Approval', location: 'Berlin', visible: { page: 0, rect: { x: 20, y: 20, w: 200, h: 60 } } });
    // Incremental: the original bytes are untouched.
    expect(once.subarray(0, original.length)).toEqual(original);
    // pdf-lib's output does not end in a line break; the update's offsets must still be right.
    expect(original[original.length - 1]).not.toBe(0x0a);
    expect(xrefOffsetsValid(once)).toBe(true);
    const [v1] = await verifySignatures(once);
    expect(v1).toMatchObject({ fieldName: 'Signature1', page: 0, status: 'valid', signer: 'Ada Lövelace', selfSigned: true, reason: 'Approval', location: 'Berlin', coversWholeDocument: true, algorithm: 'RSA with SHA-256' });

    const twice = await signPdf(once, { identity: id });
    const [a, b] = await verifySignatures(twice);
    expect(a).toMatchObject({ fieldName: 'Signature1', status: 'valid-modified', coversWholeDocument: false });
    expect(b).toMatchObject({ fieldName: 'Signature2', status: 'valid', coversWholeDocument: true });
    expect(xrefOffsetsValid(twice)).toBe(true);
    if (process.env.SIG_OUT) writeFileSync(process.env.SIG_OUT, twice);
  });

  it('detects tampering', async () => {
    const id = await readP12(p12, 'pw');
    const signed = await signPdf(await doc(), { identity: id });
    // Flip one byte inside the first stream's data: still parseable, but no longer what was signed.
    const at = new TextDecoder('latin1').decode(signed).indexOf('stream\n') + 12;
    const tampered = signed.slice();
    tampered[at] ^= 0xff;
    expect((await verifySignatures(tampered))[0]).toMatchObject({ status: 'invalid', detail: expect.stringContaining('altered') });
  });

  it('reports no signatures for unsigned documents', async () => {
    expect(await verifySignatures(await doc())).toEqual([]);
  });

  it('clears signatures a full rewrite breaks, leaving fields that can be signed again', async () => {
    const { dropStaleSignatures } = await import('../src/lib/pdfOps');
    const { PDFName } = await import('@cantoo/pdf-lib');
    const id = await readP12(p12, 'pw');
    const signed = await signPdf(await doc(), { identity: id, visible: { page: 0, rect: { x: 20, y: 20, w: 200, h: 60 } } });
    const rewritten = await dropStaleSignatures(signed);
    expect(await verifySignatures(rewritten)).toEqual([]);
    const d = await PDFDocument.load(rewritten);
    const field = d.getForm().getFields()[0];
    expect(field.constructor.name).toBe('PDFSignature');
    expect(field.acroField.dict.has(PDFName.of('V'))).toBe(false);
    expect(field.acroField.getWidgets()[0].dict.has(PDFName.of('AP'))).toBe(false);
    // Signing it again works and verifies.
    const again = await signPdf(rewritten, { identity: id });
    expect((await verifySignatures(again)).map((v) => v.status)).toContain('valid');
  });
});
