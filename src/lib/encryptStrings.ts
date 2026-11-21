/**
 * pdf-lib's writer encrypts stream data only. Strings are protected only when their
 * object lands in an (encrypted) object stream; everything written on its own — the
 * catalog (/Lang, name trees), pages, stream dictionaries, and every object of a file
 * saved without object streams (PDF/A-1) — kept its strings in plaintext, and readers
 * then "decrypt" them into garbage. This replaces the writer's per-object hook so the
 * strings of every object written on its own are encrypted too (ISO 32000-1 7.6.2),
 * except where the standard says not to: the encryption dictionary itself and a
 * signature's /Contents.
 *
 * A security object can carry `xploder` flags to leave streams, strings or the XMP
 * metadata unencrypted, as an original file's crypt filters may require.
 */
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFRef, PDFStream, PDFString, PDFWriter, type PDFObject, type PDFSecurity } from '@cantoo/pdf-lib';

export interface EncryptionScope {
  streams: boolean;
  strings: boolean;
  /** Encrypt the XMP metadata stream (false for /EncryptMetadata false). */
  metadata: boolean;
}

type Encrypt = (bytes: Uint8Array) => Uint8Array;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function encryptIn(o: PDFObject, fn: () => Encrypt, sig: boolean, depth = 0): PDFObject | undefined {
  if (o instanceof PDFString || o instanceof PDFHexString) return PDFHexString.of(hex(fn()(o.asBytes())));
  if (depth > 64) return undefined;
  if (o instanceof PDFDict) {
    const isSig = sig || o.get(PDFName.of('Type'))?.toString() === '/Sig';
    for (const [k, v] of o.entries()) {
      // A signature's value is not encrypted (12.8.1), nor is anything behind a reference.
      if (isSig && k === PDFName.of('Contents')) continue;
      if (v instanceof PDFRef) continue;
      const r = encryptIn(v, fn, false, depth + 1);
      if (r) o.set(k, r);
    }
  } else if (o instanceof PDFArray) {
    for (let i = 0; i < o.size(); i++) {
      const v = o.get(i);
      if (v instanceof PDFRef) continue;
      const r = encryptIn(v, fn, false, depth + 1);
      if (r) o.set(i, r);
    }
  }
  return undefined;
}

let installed = false;

/** Install the hook (once). */
export function installStringEncryption() {
  if (installed) return;
  installed = true;
  const proto = PDFWriter.prototype as unknown as { encrypt(ref: PDFRef, object: PDFObject, security: PDFSecurity): void; context?: unknown };
  proto.encrypt = function encrypt(this: { context: { trailerInfo: { Encrypt?: PDFObject } } }, ref, object, security) {
    if (ref === this.context.trailerInfo.Encrypt) return;
    const scope: EncryptionScope = (security as unknown as { xploder?: EncryptionScope }).xploder ?? { streams: true, strings: true, metadata: true };
    let key: Encrypt | undefined;
    const fn = () => (key ??= security.getEncryptFn(ref.objectNumber, ref.generationNumber) as Encrypt);
    if (object instanceof PDFStream) {
      const dict = object.dict;
      const isMeta = dict.get(PDFName.of('Type'))?.toString() === '/Metadata';
      if (scope.streams && (scope.metadata || !isMeta)) object.updateContents(fn()(object.getContents()));
      if (scope.strings) encryptIn(dict, fn, false);
    } else if (scope.strings) {
      encryptIn(object, fn, false);
    }
  };
}
