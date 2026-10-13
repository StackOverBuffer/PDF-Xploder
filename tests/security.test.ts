import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as sec from '../src/lib/security';

async function plainDoc(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([200, 200]).drawText('Secret text', { x: 20, y: 100, size: 12, font });
  return doc.save();
}

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('security', () => {
  it('encrypts with AES-256 and decrypts with either password', async () => {
    const plain = await plainDoc();
    const settings: sec.SecuritySettings = {
      userPassword: 'open', ownerPassword: 'owner', algorithm: 'AES-256',
      permissions: { ...sec.ALL_PERMISSIONS, modifying: false, copying: false },
    };
    const enc = await sec.encrypt(plain, settings);
    expect(latin1(enc)).toContain('/Encrypt');
    const info = await sec.inspectEncryption(enc);
    expect(info).toMatchObject({ encrypted: true, algorithm: 'AES-256' });
    expect(info.permissions).toMatchObject({ modifying: false, copying: false, printing: true, annotating: true });
    expect(sec.restrictsEditing(info.permissions)).toBe(true);

    expect(await sec.opensWith(enc, 'open')).toBe(true);
    expect(await sec.opensWith(enc, 'owner')).toBe(true);
    expect(await sec.opensWith(enc, 'nope')).toBe(false);
    expect(await sec.opensWith(enc, '')).toBe(false);

    const dec = await sec.decrypt(enc, 'open');
    expect((await sec.inspectEncryption(dec)).encrypted).toBe(false);
    expect((await PDFDocument.load(dec)).getPageCount()).toBe(1);
  });

  it('supports owner-only protection (opens without a password)', async () => {
    const enc = await sec.encrypt(await plainDoc(), {
      userPassword: '', ownerPassword: 'owner', algorithm: 'AES-128', permissions: { ...sec.ALL_PERMISSIONS, annotating: false },
    });
    expect(await sec.inspectEncryption(enc)).toMatchObject({ encrypted: true, algorithm: 'AES-128' });
    expect(await sec.opensWith(enc, '')).toBe(true);
    expect(await sec.opensWith(enc, 'owner')).toBe(true);
    expect(await sec.opensWith(enc, 'other')).toBe(false);
  });

  it('reports unencrypted documents', async () => {
    expect(await sec.inspectEncryption(await plainDoc())).toEqual({ encrypted: false, permissions: sec.ALL_PERMISSIONS });
  });
});
