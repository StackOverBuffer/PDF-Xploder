/** Password protection (encryption) helpers, built on @cantoo/pdf-lib. */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFSecurity, PDFString } from '@cantoo/pdf-lib';
import { CipherTransformFactory } from 'pdf-lib-internal/crypto';
import { saveDoc } from './pdfSave';

export interface Permissions {
  printing: boolean;
  /** Print at full quality; when false (and printing allowed) only low-resolution printing. */
  highResPrinting: boolean;
  modifying: boolean;
  copying: boolean;
  annotating: boolean;
  fillingForms: boolean;
  contentAccessibility: boolean;
  documentAssembly: boolean;
}

export const ALL_PERMISSIONS: Permissions = {
  printing: true, highResPrinting: true, modifying: true, copying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: true,
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
    // Revision 2 handlers have no separate quality bit: printing means full quality.
    highResPrinting: bit(3) && (bit(12) || (p & 0xf00) === 0),
    modifying: bit(4),
    copying: bit(5),
    annotating: bit(6),
    fillingForms: bit(9),
    contentAccessibility: bit(10),
    documentAssembly: bit(11),
  };
}

export function allPermissionsGranted(p: Permissions): boolean {
  return Object.values(p).every(Boolean);
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
  // The trailer is never compressed: without an /Encrypt key anywhere the file is not encrypted,
  // and the (slow, for big files) full parse can be skipped.
  if (!containsAscii(bytes, '/Encrypt')) return { encrypted: false, permissions: ALL_PERMISSIONS };
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const enc = doc.context.lookup(doc.context.trailerInfo.Encrypt);
  if (!(enc instanceof PDFDict)) return { encrypted: false, permissions: ALL_PERMISSIONS };
  const p = (enc.lookup(PDFName.of('P')) as PDFNumber | undefined)?.asNumber() ?? -1;
  return { encrypted: true, algorithm: cipherName(enc), permissions: decodePermissions(p) };
}

export function containsAscii(bytes: Uint8Array, word: string): boolean {
  const codes = [...word].map((c) => c.charCodeAt(0));
  const first = codes[0];
  for (let i = bytes.indexOf(first); i >= 0 && i <= bytes.length - codes.length; i = bytes.indexOf(first, i + 1)) {
    let k = 1;
    while (k < codes.length && bytes[i + k] === codes[k]) k++;
    if (k === codes.length) return true;
  }
  return false;
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
/** Load with a password, working around the fork dropping the trailer's /Info link when decrypting. */
export async function loadDecrypted(bytes: Uint8Array, password: string): Promise<PDFDocument> {
  const doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  if (!doc.context.trailerInfo.Info) {
    const raw = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const info = raw.context.trailerInfo.Info;
    if (info instanceof PDFRef && doc.context.lookup(info) instanceof PDFDict) doc.context.trailerInfo.Info = info;
  }
  return doc;
}

export async function decrypt(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const doc = await loadDecrypted(bytes, password);
  dropEncryptionRemnants(doc);
  return saveDoc(doc);
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
    permissions: { ...s.permissions, printing: s.permissions.printing ? (s.permissions.highResPrinting ? 'highResolution' : 'lowResolution') : false },
    algorithm: s.algorithm,
  });
  return saveDoc(doc);
}

/**
 * Encrypt `plain` exactly like `original`: same /Encrypt dictionary, file ID
 * and file key, derived from `password` (the open password suffices). Both
 * passwords and all permissions of the original keep working, which is how a
 * restricted document can be saved without knowing its owner password.
 */
export async function reencryptLike(plain: Uint8Array, original: Uint8Array, password: string): Promise<Uint8Array> {
  const src = await PDFDocument.load(original, { ignoreEncryption: true, updateMetadata: false });
  const enc = src.context.lookup(src.context.trailerInfo.Encrypt);
  const ids = src.context.lookup(src.context.trailerInfo.ID);
  if (!(enc instanceof PDFDict) || !(ids instanceof PDFArray)) throw new Error('The original document is not encrypted.');
  const id0 = ids.get(0);
  if (!(id0 instanceof PDFHexString || id0 instanceof PDFString)) throw new Error('The original document has no file identifier.');
  const key = new CipherTransformFactory(enc, id0.asBytes(), password).encryptionKey;
  const V = (enc.lookup(PDFName.of('V')) as PDFNumber | undefined)?.asNumber() ?? 0;
  const length = (enc.lookup(PDFName.of('Length')) as PDFNumber | undefined)?.asNumber();

  const doc = await PDFDocument.load(plain, { updateMetadata: false });
  const ctx = doc.context;
  ctx.trailerInfo.Encrypt = ctx.register(enc.clone(ctx));
  ctx.trailerInfo.ID = ctx.obj([ids.get(0), ids.get(1) ?? ids.get(0)]);
  // A PDFSecurity carrying the existing key instead of a freshly generated one.
  const security = Object.create(PDFSecurity.prototype) as PDFSecurity;
  Object.assign(security, { context: ctx, encryption: { V }, encryptionKey: key, keyBits: V >= 5 ? 256 : length ?? 40 });
  ctx.security = security;
  // Object streams are required: strings are only encrypted as part of them.
  return saveDoc(doc);
}
