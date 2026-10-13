import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as sec from '../src/lib/security';

async function plainDoc(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([200, 200]).drawText('Secret text', { x: 20, y: 100, size: 12, font });
  doc.setTitle('Secret');
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
    // Document properties survive decryption.
    expect((await PDFDocument.load(dec)).getTitle()).toBe('Secret');
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

describe('re-encrypting like the original', () => {
  for (const algorithm of ['AES-256', 'AES-128'] as const) {
    it(`keeps both passwords and the permissions (${algorithm})`, async () => {
      const settings: sec.SecuritySettings = {
        userPassword: 'open', ownerPassword: 'owner', algorithm,
        permissions: { ...sec.ALL_PERMISSIONS, modifying: false, highResPrinting: false },
      };
      const enc = await sec.encrypt(await plainDoc(), settings);
      // Edit with only the open password…
      const doc = await PDFDocument.load(await sec.decrypt(enc, 'open'));
      doc.setTitle('Edited without the owner password');
      doc.addPage([100, 100]);
      const edited = await sec.reencryptLike(await doc.save(), enc, 'open');

      expect(await sec.opensWith(edited, 'open')).toBe(true);
      expect(await sec.opensWith(edited, 'owner')).toBe(true);
      expect(await sec.opensWith(edited, 'wrong')).toBe(false);
      const info = await sec.inspectEncryption(edited);
      expect(info).toMatchObject({ encrypted: true, algorithm });
      expect(info.permissions).toEqual({ ...sec.ALL_PERMISSIONS, modifying: false, highResPrinting: false });
      const back = await sec.loadDecrypted(edited, 'open');
      expect(back.getTitle()).toBe('Edited without the owner password');
      expect(back.getPageCount()).toBe(2);
    });
  }

  it('decodes low-resolution printing', async () => {
    const enc = await sec.encrypt(await plainDoc(), { userPassword: '', ownerPassword: 'o', algorithm: 'AES-256', permissions: { ...sec.ALL_PERMISSIONS, highResPrinting: false } });
    expect((await sec.inspectEncryption(enc)).permissions).toMatchObject({ printing: true, highResPrinting: false });
  });
});
