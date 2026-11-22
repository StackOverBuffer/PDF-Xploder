/** Password protection (encryption) helpers, built on @cantoo/pdf-lib. */
import { PDFArray, PDFDict, PDFDocument, PDFHeader, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRawStream, PDFRef, PDFSecurity, PDFString, type PDFObject } from '@cantoo/pdf-lib';
import { CipherTransformFactory } from 'pdf-lib-internal/crypto';
import { saveDoc } from './pdfSave';
import { loadForEdit } from './pageTree';
import { installStringEncryption, type EncryptionScope } from './encryptStrings';

// Strings in objects outside object streams are encrypted too (see encryptStrings.ts).
installStringEncryption();

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
  // The native string search over latin-1 chunks is far faster than a byte loop
  // ('/' starts every PDF name, so a first-byte scan stops everywhere).
  const CHUNK = 4 * 1024 * 1024;
  const dec = new TextDecoder('latin1');
  for (let at = 0; at < bytes.length; at += CHUNK) {
    // Overlap the chunks so a word across a boundary is found.
    const end = Math.min(bytes.length, at + CHUNK + word.length - 1);
    if (dec.decode(bytes.subarray(at, end)).includes(word)) return true;
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
  const doc = await loadForEdit(bytes, { password });
  if (!doc.context.trailerInfo.Info) {
    const raw = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const info = raw.context.trailerInfo.Info;
    if (info instanceof PDFRef && doc.context.lookup(info) instanceof PDFDict) doc.context.trailerInfo.Info = info;
  }
  return doc;
}

export async function decrypt(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const doc = await loadDecrypted(bytes, password);
  await applyCryptFilters(doc, bytes, password);
  dropEncryptionRemnants(doc);
  return saveDoc(doc);
}

/**
 * pdf-lib decrypts every stream with the document's string filter (/StrF). Where the default
 * stream filter (/StmF) differs, where a stream names its own crypt filter (/Filter /Crypt,
 * often /Identity: not encrypted at all), and for embedded files under a different /EFF or
 * unencrypted metadata, the streams come out as garbage, and /Crypt stays in the filter list,
 * where readers refuse it. Decrypt those streams again from the original bytes with the right
 * filter and drop /Crypt.
 */
async function applyCryptFilters(doc: PDFDocument, bytes: Uint8Array, password: string): Promise<void> {
  const raw = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const enc = raw.context.lookup(raw.context.trailerInfo.Encrypt);
  const ids = raw.context.lookup(raw.context.trailerInfo.ID);
  if (!(enc instanceof PDFDict) || ((enc.lookup(PDFName.of('V')) as PDFNumber | undefined)?.asNumber() ?? 0) < 4) return;
  const id0 = ids instanceof PDFArray ? ids.lookup(0) : undefined;
  const factory = new CipherTransformFactory(enc, id0 instanceof PDFHexString || id0 instanceof PDFString ? id0.asBytes() : new Uint8Array(), password);
  const identity = PDFName.of('Identity');
  const nameOf = (key: string, fallback: PDFName) => {
    const v = enc.lookup(PDFName.of(key));
    return v instanceof PDFName ? v : fallback;
  };
  const strf = nameOf('StrF', identity);
  const stmf = nameOf('StmF', identity);
  const eff = nameOf('EFF', stmf);
  const encryptMetadata = enc.lookup(PDFName.of('EncryptMetadata'))?.toString() !== 'false';
  const decryptWith = (name: PDFName, ref: PDFRef, data: Uint8Array) => {
    if (name === identity) return data;
    const f = factory as unknown as { strf: PDFName };
    const before = f.strf;
    f.strf = name;
    try {
      return factory.createCipherTransform(ref.objectNumber, ref.generationNumber).decryptBytes(data);
    } finally {
      f.strf = before;
    }
  };

  for (const [ref, obj] of raw.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const target = doc.context.lookup(ref);
    if (!(target instanceof PDFRawStream)) continue;
    const type = obj.dict.lookup(PDFName.of('Type'));
    if (type === PDFName.of('XRef')) continue;
    const filter = obj.dict.lookup(PDFName.of('Filter'));
    const filters: PDFObject[] = filter instanceof PDFArray ? filter.asArray() : filter ? [filter] : [];
    const at = filters.findIndex((f) => f === PDFName.of('Crypt'));
    let name: PDFName;
    if (at === 0) {
      const parms = obj.dict.lookup(PDFName.of('DecodeParms'));
      const p = parms instanceof PDFArray ? parms.lookup(0) : parms;
      const n = p instanceof PDFDict ? p.lookup(PDFName.of('Name')) : undefined;
      name = n instanceof PDFName ? n : identity;
    } else if (type === PDFName.of('EmbeddedFile')) name = eff;
    else if (type === PDFName.of('Metadata') && !encryptMetadata) name = identity;
    else name = stmf;
    // What pdf-lib did already.
    if (at !== 0 && name === strf) continue;
    const dict = target.dict.clone(doc.context);
    if (at === 0) {
      const rest = filters.slice(1);
      const parms = dict.lookup(PDFName.of('DecodeParms'));
      const restParms = parms instanceof PDFArray ? parms.asArray().slice(1) : [];
      if (rest.length) dict.set(PDFName.of('Filter'), rest.length === 1 ? rest[0] : doc.context.obj(rest));
      else dict.delete(PDFName.of('Filter'));
      if (restParms.length && restParms.some((x) => x !== PDFNull)) dict.set(PDFName.of('DecodeParms'), restParms.length === 1 ? restParms[0] : doc.context.obj(restParms));
      else dict.delete(PDFName.of('DecodeParms'));
    }
    const data = decryptWith(name, ref, obj.contents);
    dict.set(PDFName.of('Length'), PDFNumber.of(data.length));
    doc.context.assign(ref, PDFRawStream.of(dict, data));
  }
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
  if (s.algorithm === 'AES-256') markAes256(doc);
  return saveDoc(doc);
}

/**
 * AES-256 (security handler revision 6) is a PDF 2.0 / Adobe extension level 8 feature:
 * declare it, as Acrobat does, so readers that check the version know what to expect.
 * A dictionary the file already declares keeps its entries (a developer extension such as
 * a PDF/A conformance must survive); only /ADBE is added or refreshed. AES-256 needs no
 * Adobe extension on a PDF 2.0 file — there it is part of the base standard.
 */
function markAes256(doc: PDFDocument) {
  const extensions = PDFName.of('Extensions');
  const v = doc.context.header.toString().match(/%PDF-(\d+)\.(\d+)/);
  const adbe = doc.context.obj({ BaseVersion: PDFName.of('1.7'), ExtensionLevel: 8 });
  const current = doc.catalog.lookup(extensions);
  if (current instanceof PDFDict) {
    // PDF 2.0 has AES-256 in the base standard: no Adobe extension to declare there.
    if (!(v && Number(v[1]) >= 2)) current.set(PDFName.of('ADBE'), adbe);
  } else {
    // No /Extensions (or a broken one, which no reader could make sense of anyway).
    doc.catalog.set(extensions, doc.context.obj({ ADBE: adbe }));
  }
  if (!v || Number(v[1]) * 10 + Number(v[2]) < 17) doc.context.header = PDFHeader.forVersion(1, 7);
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
  const dict = enc.clone(ctx);
  // The writer encrypts with what V says (V 4: AES-128 for everything). Crypt filters can
  // say otherwise (RC4 under V 4, Identity for streams or strings, plain metadata), and a
  // file that declares one cipher and contains another opens as garbage: the dictionary
  // is made to say exactly what is written. The file key, O, U and P stay as they are
  // (crypt filters are not part of the key), so both passwords keep working.
  const scope: EncryptionScope = { streams: true, strings: true, metadata: dict.lookup(PDFName.of('EncryptMetadata'))?.toString() !== 'false' };
  let writeV = V;
  if (V === 4) {
    const std = dict.lookupMaybe(PDFName.of('CF'), PDFDict)?.lookupMaybe(PDFName.of('StdCF'), PDFDict);
    const rc4 = std?.lookup(PDFName.of('CFM'))?.toString() === '/V2';
    // RC4 inside V 4 is the V 2 algorithm; anything else is written as AES-128.
    if (rc4) writeV = 2;
    dict.set(PDFName.of('CF'), ctx.obj({ StdCF: { Type: 'CryptFilter', CFM: rc4 ? 'V2' : 'AESV2', AuthEvent: 'DocOpen', Length: rc4 ? key.length : 16 } }));
    dict.set(PDFName.of('StmF'), PDFName.of('StdCF'));
    dict.set(PDFName.of('StrF'), PDFName.of('StdCF'));
    dict.delete(PDFName.of('EFF'));
  }
  ctx.trailerInfo.Encrypt = ctx.register(dict);
  ctx.trailerInfo.ID = ctx.obj([ids.get(0), ids.get(1) ?? ids.get(0)]);
  // A PDFSecurity carrying the existing key instead of a freshly generated one.
  const security = Object.create(PDFSecurity.prototype) as PDFSecurity;
  Object.assign(security, { context: ctx, encryption: { V: writeV }, encryptionKey: key, keyBits: V >= 5 ? 256 : length ?? 40, xploder: scope });
  ctx.security = security;
  if (V >= 5) markAes256(doc);
  return saveDoc(doc);
}
