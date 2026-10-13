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
    const [v1] = await verifySignatures(once);
    expect(v1).toMatchObject({ fieldName: 'Signature1', page: 0, status: 'valid', signer: 'Ada Lövelace', selfSigned: true, reason: 'Approval', location: 'Berlin', coversWholeDocument: true, algorithm: 'RSA with SHA-256' });

    const twice = await signPdf(once, { identity: id });
    const [a, b] = await verifySignatures(twice);
    expect(a).toMatchObject({ fieldName: 'Signature1', status: 'valid-modified', coversWholeDocument: false });
    expect(b).toMatchObject({ fieldName: 'Signature2', status: 'valid', coversWholeDocument: true });
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
});
