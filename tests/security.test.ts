import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFString, StandardFonts } from '@cantoo/pdf-lib';
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

describe('/Extensions and AES-256', () => {
  const settings = (algorithm: sec.Algorithm): sec.SecuritySettings => ({
    userPassword: 'open', ownerPassword: 'owner', algorithm, permissions: sec.ALL_PERMISSIONS,
  });
  const extensionsOf = async (b: Uint8Array) =>
    (await PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false })).catalog.lookup(PDFName.of('Extensions'), PDFDict);

  it('merges the Adobe entry into a /Extensions dictionary the file already declares', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([200, 200]).drawText('Secret text', { x: 20, y: 100, size: 12, font });
    // A developer extension declaration, as PDF/A-producing tools write one.
    doc.catalog.set(PDFName.of('Extensions'), doc.context.obj({ ISO_19005_1: { BaseVersion: '1.4', ExtensionLevel: 1, Conformance: 'B' } }));
    const enc = await sec.encrypt(await doc.save(), settings('AES-256'));

    const ext = await extensionsOf(enc);
    const iso = ext.lookup(PDFName.of('ISO_19005_1'), PDFDict);
    expect(iso.lookup(PDFName.of('BaseVersion'))?.toString()).toBe('/1.4');
    expect(iso.lookup(PDFName.of('Conformance'))?.toString()).toBe('/B');
    expect(iso.lookup(PDFName.of('ExtensionLevel'))?.toString()).toBe('1');
    const adbe = ext.lookup(PDFName.of('ADBE'), PDFDict);
    expect(adbe.lookup(PDFName.of('BaseVersion'))?.toString()).toBe('/1.7');
    expect((adbe.lookup(PDFName.of('ExtensionLevel')) as PDFNumber).asNumber()).toBe(8);
    // Still there after decryption, where the catalog is written out plain again.
    expect((await extensionsOf(await sec.decrypt(enc, 'open'))).has(PDFName.of('ISO_19005_1'))).toBe(true);
  });

  it('files without /Extensions still declare the Adobe extension level', async () => {
    const ext = await extensionsOf(await sec.encrypt(await plainDoc(), settings('AES-256')));
    expect(ext.lookup(PDFName.of('ADBE'), PDFDict).lookup(PDFName.of('BaseVersion'))?.toString()).toBe('/1.7');
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

describe('strings in encrypted files', () => {
  async function withStrings(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.setTitle('Quarterly report');
    doc.catalog.set(PDFName.of('Lang'), PDFString.of('en-GB'));
    // Without object streams every object is written on its own (the PDF/A-1 case).
    return doc.save({ useObjectStreams: false });
  }

  for (const algorithm of ['AES-256', 'AES-128'] as const) {
    it(`encrypts strings outside object streams too (${algorithm})`, async () => {
      const enc = await sec.encrypt(await withStrings(), { userPassword: 'u', ownerPassword: 'o', permissions: sec.ALL_PERMISSIONS, algorithm });
      const raw = new TextDecoder('latin1').decode(enc);
      expect(raw).not.toContain('en-GB');
      expect(raw).not.toContain('Quarterly');
      const plain = await PDFDocument.load(await sec.decrypt(enc, 'u'));
      expect((plain.catalog.lookup(PDFName.of('Lang')) as PDFString).decodeText()).toBe('en-GB');
      expect(plain.getTitle()).toBe('Quarterly report');
    });
  }

  it('re-encrypting writes a dictionary that matches the cipher used', async () => {
    const enc = await sec.encrypt(await withStrings(), { userPassword: 'u', ownerPassword: 'o', permissions: sec.ALL_PERMISSIONS, algorithm: 'AES-128' });
    // Another program's variant: strings with RC4 under V 4.
    const doc = await PDFDocument.load(enc, { ignoreEncryption: true, updateMetadata: false });
    const dict = doc.context.lookup(doc.context.trailerInfo.Encrypt) as PDFDict;
    dict.set(PDFName.of('StrF'), PDFName.of('Identity'));
    dict.set(PDFName.of('EFF'), PDFName.of('Identity'));
    const variant = await doc.save({ useObjectStreams: false });
    const again = await sec.reencryptLike(await PDFDocument.create().then(async (d) => { d.addPage(); d.setTitle('Edited'); return d.save(); }), variant, 'u');
    const out = await PDFDocument.load(again, { ignoreEncryption: true, updateMetadata: false });
    const written = out.context.lookup(out.context.trailerInfo.Encrypt) as PDFDict;
    expect(written.lookup(PDFName.of('StrF'))?.toString()).toBe('/StdCF');
    expect(written.has(PDFName.of('EFF'))).toBe(false);
    const plain = await PDFDocument.load(await sec.decrypt(again, 'u'));
    expect(plain.getTitle()).toBe('Edited');
  });
});
