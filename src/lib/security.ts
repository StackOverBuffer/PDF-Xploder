/** Password protection (encryption) helpers, built on @cantoo/pdf-lib. */
import { PDFDict, PDFDocument, PDFName, PDFNumber } from '@cantoo/pdf-lib';

export interface Permissions {
  printing: boolean;
  modifying: boolean;
  copying: boolean;
  annotating: boolean;
  fillingForms: boolean;
  contentAccessibility: boolean;
  documentAssembly: boolean;
}

export const ALL_PERMISSIONS: Permissions = {
  printing: true, modifying: true, copying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: true,
};

export type Algorithm = 'AES-256' | 'AES-128';

export interface SecuritySettings {
  /** Password needed to open the document ('' = opens without a password). */
  userPassword: string;
  /** Password needed to change security or lift the permission restrictions. */
  ownerPassword: string;
  permissions: Permissions;
  algorithm: Algorithm;
}

export interface EncryptionInfo {
  encrypted: boolean;
  /** Human-readable cipher, e.g. "AES-256". */
  algorithm?: string;
  permissions: Permissions;
}

/** Decode the /P permission bits (ISO 32000 table 22). */
export function decodePermissions(p: number): Permissions {
  const bit = (n: number) => (p & (1 << (n - 1))) !== 0;
  return {
    printing: bit(3),
    modifying: bit(4),
    copying: bit(5),
    annotating: bit(6),
    fillingForms: bit(9),
    contentAccessibility: bit(10),
    documentAssembly: bit(11),
  };
}

/** Whether the permissions forbid any of the editing this app does. */
export function restrictsEditing(p: Permissions): boolean {
  return !(p.modifying && p.annotating && p.fillingForms && p.documentAssembly);
}

function cipherName(enc: PDFDict): string {
  const v = (enc.lookup(PDFName.of('V')) as PDFNumber | undefined)?.asNumber() ?? 0;
  const r = (enc.lookup(PDFName.of('R')) as PDFNumber | undefined)?.asNumber() ?? 0;
  if (v >= 5 || r >= 5) return 'AES-256';
  if (v === 4) {
    const cf = enc.lookup(PDFName.of('CF'));
    const std = cf instanceof PDFDict ? cf.lookup(PDFName.of('StdCF')) : undefined;
    const cfm = std instanceof PDFDict ? std.lookup(PDFName.of('CFM'))?.toString() : undefined;
    return cfm === '/AESV2' ? 'AES-128' : 'RC4-128';
  }
  const len = (enc.lookup(PDFName.of('Length')) as PDFNumber | undefined)?.asNumber() ?? 40;
  return `RC4-${len}`;
}

/** Read the encryption dictionary without decrypting anything. */
export async function inspectEncryption(bytes: Uint8Array): Promise<EncryptionInfo> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const enc = doc.context.lookup(doc.context.trailerInfo.Encrypt);
  if (!(enc instanceof PDFDict)) return { encrypted: false, permissions: ALL_PERMISSIONS };
  const p = (enc.lookup(PDFName.of('P')) as PDFNumber | undefined)?.asNumber() ?? -1;
  return { encrypted: true, algorithm: cipherName(enc), permissions: decodePermissions(p) };
}

/** Whether `password` (user or owner) opens the document. */
export async function opensWith(bytes: Uint8Array, password: string): Promise<boolean> {
  try {
    await PDFDocument.load(bytes, { password, updateMetadata: false });
    return true;
  } catch {
    return false;
  }
}

/** Return an unencrypted copy of the document. */
export async function decrypt(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  dropEncryptionRemnants(doc);
  return doc.save({ useObjectStreams: true });
}

/**
 * After decryption the old cross-reference streams (whose dictionaries still
 * name /Encrypt) and the encryption dictionary itself linger as plain objects.
 * Remove them so no reader mistakes the result for an encrypted file.
 */
function dropEncryptionRemnants(doc: PDFDocument) {
  const ctx = doc.context;
  const encRef = ctx.trailerInfo.Encrypt;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : (obj as { dict?: unknown }).dict;
    if (dict instanceof PDFDict && dict.get(PDFName.of('Type'))?.toString() === '/XRef') ctx.delete(ref);
    else if (dict instanceof PDFDict && dict.has(PDFName.of('Filter')) && dict.has(PDFName.of('O')) && dict.has(PDFName.of('U')) && dict.has(PDFName.of('P'))) ctx.delete(ref);
  }
  if (encRef) ctx.trailerInfo.Encrypt = undefined;
}

export async function encrypt(bytes: Uint8Array, s: SecuritySettings): Promise<Uint8Array> {
  if (!s.ownerPassword && !s.userPassword) throw new Error('Set at least one password.');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  doc.encrypt({
    userPassword: s.userPassword,
    // Without an owner password anyone who can open the file could lift the restrictions.
    ownerPassword: s.ownerPassword || s.userPassword,
    permissions: { ...s.permissions, printing: s.permissions.printing ? 'highResolution' : false },
    algorithm: s.algorithm,
  });
  return doc.save({ useObjectStreams: true });
}
