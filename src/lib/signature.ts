/**
 * Certificate-based digital signatures (PAdES-style detached PKCS#7).
 *
 * Signing appends an incremental update with a signature field, so earlier
 * signatures stay intact. The CMS structure is produced by node-forge from a
 * PKCS#12 (.p12/.pfx) identity. Verification uses a small DER reader and the
 * Web Crypto API (RSA PKCS#1 v1.5 and ECDSA); forge's own RSA verification is
 * deliberately not used (GHSA-86w9-cpqp-85rv).
 */
import type forgeType from 'node-forge';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from '@cantoo/pdf-lib';
import { Canvas, wrapLines } from './appearance';
import { createTextEngine } from './fonts';
import { frameGeom, pdfRectToView, viewToPdf } from './geometry';
import * as der from './der';
import type { PageGeom, Rect } from './types';
import { normRot } from './geometry';

/** Bytes reserved in the file for the PKCS#7 blob. */
const SIGNATURE_SPACE = 16384;
const BYTE_RANGE_PLACEHOLDER = '**********';

type Forge = typeof forgeType;
// node-forge is only needed to sign, so load it on demand.
let forgePromise: Promise<Forge> | null = null;
const loadForge = () => (forgePromise ??= import('node-forge').then((m) => (m.default ?? m) as Forge));

const toBinary = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};
const fromBinary = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const latin1 = new TextDecoder('latin1');

// ---------------------------------------------------------------- identities

export interface Identity {
  key: forgeType.pki.rsa.PrivateKey;
  cert: forgeType.pki.Certificate;
  chain: forgeType.pki.Certificate[];
  name: string;
  email?: string;
  issuer: string;
  notBefore: Date;
  notAfter: Date;
}

const attr = (forge: Forge, c: forgeType.pki.Certificate, field: 'subject' | 'issuer', short: string) => {
  const v = c[field].getField(short)?.value as string | undefined;
  if (!v) return undefined;
  try {
    return forge.util.decodeUtf8(v);
  } catch {
    return v;
  }
};

/** Open a PKCS#12 file. Throws a readable error for a wrong password or unsupported keys. */
export async function readP12(bytes: Uint8Array, password: string): Promise<Identity> {
  const forge = await loadForge();
  let p12: forgeType.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(toBinary(bytes)), password);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (/MAC could not be verified|Invalid password/i.test(msg)) throw new Error('Wrong certificate password.');
    if (/OID is not RSA/i.test(msg)) throw new Error('Only RSA certificates can be used for signing at the moment.');
    throw new Error(`Could not read the certificate file: ${msg}`);
  }
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((b) => b.cert).filter(Boolean) as forgeType.pki.Certificate[];
  const key = keyBags.find((b) => b.key)?.key as forgeType.pki.rsa.PrivateKey | undefined;
  if (!key) throw new Error('The certificate file contains no private key.');
  // The signing certificate is the one whose public key matches the private key.
  const cert = certs.find((c) => (c.publicKey as forgeType.pki.rsa.PublicKey).n?.equals(key.n)) ?? certs[0];
  if (!cert) throw new Error('The certificate file contains no certificate.');
  return {
    key,
    cert,
    chain: certs.filter((c) => c !== cert),
    name: attr(forge, cert, 'subject', 'CN') ?? attr(forge, cert, 'subject', 'O') ?? 'Unknown signer',
    email: attr(forge, cert, 'subject', 'E'),
    issuer: attr(forge, cert, 'issuer', 'CN') ?? attr(forge, cert, 'issuer', 'O') ?? 'Unknown issuer',
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
  };
}

/** Create a self-signed identity for testing, returned as a password-protected .p12 file. */
export async function createTestCertificate(o: { name: string; email?: string; password: string; years?: number }): Promise<Uint8Array> {
  const forge = await loadForge();
  // Web Crypto generates the RSA key far faster than forge's pure-JS implementation.
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const key = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(toBinary(pkcs8))) as forgeType.pki.rsa.PrivateKey;
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  cert.serialNumber = '01' + der.hex(crypto.getRandomValues(new Uint8Array(15)));
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + (o.years ?? 2) * 365 * 86_400_000);
  // forge encodes UTF8String values itself.
  const utf8 = (v: string) => ({ value: v, valueTagClass: forge.asn1.Type.UTF8 as never });
  const subject = [
    { name: 'commonName', ...utf8(o.name) },
    { name: 'organizationName', ...utf8('PDF-Xploder test certificate') },
    ...(o.email ? [{ name: 'emailAddress', value: o.email }] : []),
  ];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { name: 'extKeyUsage', emailProtection: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(key, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], o.password, { algorithm: 'aes256', friendlyName: o.name, generateLocalKeyId: true });
  return fromBinary(forge.asn1.toDer(p12).getBytes());
}

// ---------------------------------------------------------------- signing

export interface SignOptions {
  identity: Identity;
  reason?: string;
  location?: string;
  contactInfo?: string;
  /** Where to show the signature; omitted for an invisible signature. */
  visible?: { page: number; rect: Rect };
  date?: Date;
}

function existingFieldNames(doc: PDFDocument): Set<string> {
  const names = new Set<string>();
  const acro = doc.catalog.lookup(PDFName.of('AcroForm'));
  const walk = (arr: unknown, prefix: string) => {
    if (!(arr instanceof PDFArray)) return;
    for (const ref of arr.asArray()) {
      const f = doc.context.lookup(ref);
      if (!(f instanceof PDFDict)) continue;
      const t = f.lookup(PDFName.of('T'));
      const own = t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : '';
      const full = prefix && own ? `${prefix}.${own}` : own || prefix;
      if (full) names.add(full);
      walk(f.lookup(PDFName.of('Kids')), full);
    }
  };
  if (acro instanceof PDFDict) walk(acro.lookup(PDFName.of('Fields')), '');
  return names;
}

function formatDate(d: Date): string {
  return d.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

/** Draw the visible signature box: who signed, when, and why. */
async function signatureAppearance(doc: PDFDocument, g: PageGeom, rect: Rect, o: SignOptions, date: Date) {
  const lines = [
    `Digitally signed by ${o.identity.name}`,
    `Date: ${formatDate(date)}`,
    ...(o.reason ? [`Reason: ${o.reason}`] : []),
    ...(o.location ? [`Location: ${o.location}`] : []),
  ];
  const engine = await createTextEngine(doc, lines);
  const fg = frameGeom(g, g.rotation);
  const v = pdfRectToView(fg, rect);
  const pad = Math.min(6, v.height * 0.08);
  // Largest font size (≤ 11pt) at which the wrapped lines fit the box.
  let size = 11;
  let wrapped: string[] = [];
  for (; size > 4; size -= 0.5) {
    wrapped = lines.flatMap((l) => wrapLines(engine, l, size, v.width - pad * 2));
    if (wrapped.length * size * 1.25 <= v.height - pad * 2) break;
  }
  const c = new Canvas();
  c.rect(rect, { stroke: '#1a5fb4', fill: '#eef4fc', width: 1 });
  wrapped.forEach((line, i) => {
    const baseline = v.top + pad + size * (0.95 + i * 1.25);
    c.text(engine, line, viewToPdf(fg, { x: v.left + pad, y: baseline }), { size, color: i === 0 ? '#0d47a1' : '#263238', opacity: 1, angle: fg.rotation });
  });
  return c.toXObject(doc, rect);
}

/** Sign the document; returns the original bytes plus an incremental update. */
export async function signPdf(bytes: Uint8Array, o: SignOptions): Promise<Uint8Array> {
  const forge = await loadForge();
  const doc = await PDFDocument.load(bytes, { forIncrementalUpdate: true, updateMetadata: false });
  if (doc.context.trailerInfo.Encrypt) throw new Error('Signing password-protected documents is not supported yet.');
  const snapshot = doc.takeSnapshot();
  const ctx = doc.context;
  const date = o.date ?? new Date();

  const pageIndex = o.visible?.page ?? 0;
  const page = doc.getPage(pageIndex);
  const box = page.getCropBox();
  const g: PageGeom = { view: [box.x, box.y, box.x + box.width, box.y + box.height], rotation: normRot(page.getRotation().angle) };

  const sig = ctx.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, PDFName.of(BYTE_RANGE_PLACEHOLDER), PDFName.of(BYTE_RANGE_PLACEHOLDER), PDFName.of(BYTE_RANGE_PLACEHOLDER)],
    Contents: PDFHexString.of('0'.repeat(SIGNATURE_SPACE * 2)),
    M: PDFString.fromDate(date),
    Name: PDFHexString.fromText(o.identity.name),
    Prop_Build: { App: { Name: 'PDF-Xploder' } },
  });
  if (o.reason) sig.set(PDFName.of('Reason'), PDFHexString.fromText(o.reason));
  if (o.location) sig.set(PDFName.of('Location'), PDFHexString.fromText(o.location));
  if (o.contactInfo) sig.set(PDFName.of('ContactInfo'), PDFHexString.fromText(o.contactInfo));
  const sigRef = ctx.register(sig);

  const names = existingFieldNames(doc);
  let n = 1;
  while (names.has(`Signature${n}`)) n++;

  const rect = o.visible?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
  const ap = o.visible ? await signatureAppearance(doc, g, rect, o, date) : ctx.register(ctx.formXObject([], { BBox: [0, 0, 0, 0] }));
  const widget = ctx.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    T: PDFHexString.fromText(`Signature${n}`),
    V: sigRef,
    Rect: [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h],
    F: 4 | 128, // Print, Locked
    P: page.ref,
    AP: { N: ap },
  });
  const widgetRef = ctx.register(widget);
  page.node.addAnnot(widgetRef);
  snapshot.markRefForSave(page.ref);
  // addAnnot may have created or replaced an indirect /Annots array.
  const annots = page.node.get(PDFName.of('Annots'));
  if (annots instanceof PDFRef) snapshot.markRefForSave(annots);

  // Register the field in the AcroForm (creating one if needed).
  const rootRef = ctx.trailerInfo.Root as PDFRef;
  const acroEntry = doc.catalog.get(PDFName.of('AcroForm'));
  let acro = doc.catalog.lookup(PDFName.of('AcroForm'));
  if (!(acro instanceof PDFDict)) {
    acro = ctx.obj({ Fields: [] });
    doc.catalog.set(PDFName.of('AcroForm'), ctx.register(acro as PDFDict));
    snapshot.markRefForSave(rootRef);
  } else if (acroEntry instanceof PDFRef) {
    snapshot.markRefForSave(acroEntry);
  } else {
    snapshot.markRefForSave(rootRef);
  }
  const acroDict = acro as PDFDict;
  const fieldsEntry = acroDict.get(PDFName.of('Fields'));
  let fields = acroDict.lookup(PDFName.of('Fields'));
  if (!(fields instanceof PDFArray)) {
    fields = ctx.obj([]);
    acroDict.set(PDFName.of('Fields'), fields as PDFArray);
  } else if (fieldsEntry instanceof PDFRef) {
    snapshot.markRefForSave(fieldsEntry);
  }
  (fields as PDFArray).push(widgetRef);
  acroDict.set(PDFName.of('SigFlags'), PDFNumber.of(3));

  const update = await doc.saveIncremental(snapshot, { useObjectStreams: false });
  const sep = bytes[bytes.length - 1] === 0x0a ? new Uint8Array(0) : new Uint8Array([0x0a]);
  const out = new Uint8Array(bytes.length + sep.length + update.length);
  out.set(bytes, 0);
  out.set(sep, bytes.length);
  out.set(update, bytes.length + sep.length);

  // Locate the placeholders in the update and fill in the byte range.
  const tailStart = bytes.length;
  const tail = latin1.decode(out.subarray(tailStart));
  const contentsMatch = tail.match(new RegExp(`<0{${SIGNATURE_SPACE * 2}}>`));
  const rangeMatch = tail.match(/\/ByteRange\s*\[\s*0\s+\/\*{10}\s+\/\*{10}\s+\/\*{10}\s*\]/);
  if (!contentsMatch || !rangeMatch) throw new Error('Could not prepare the signature placeholder.');
  const cStart = tailStart + contentsMatch.index!;
  const cEnd = cStart + contentsMatch[0].length;
  const range = [0, cStart, cEnd, out.length - cEnd];
  const rangeText = `/ByteRange [${range.join(' ')}]`;
  if (rangeText.length > rangeMatch[0].length) throw new Error('Byte range does not fit its placeholder.');
  const rStart = tailStart + rangeMatch.index!;
  out.set(new TextEncoder().encode(rangeText.padEnd(rangeMatch[0].length, ' ')), rStart);

  // Sign everything except the hex placeholder itself.
  const signed = new Uint8Array(cStart + (out.length - cEnd));
  signed.set(out.subarray(0, cStart), 0);
  signed.set(out.subarray(cEnd), cStart);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(toBinary(signed));
  p7.addCertificate(o.identity.cert);
  o.identity.chain.forEach((c) => p7.addCertificate(c));
  p7.addSigner({
    key: o.identity.key,
    certificate: o.identity.cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: date as never },
    ],
  });
  p7.sign({ detached: true });
  const asn1 = p7.toAsn1();
  // forge re-encodes the signer's issuer name from parsed attributes, which
  // double-encodes UTF-8 values; use the certificate's exact issuer bytes so
  // validators can match the signer to its certificate.
  const certDer = fromBinary(forge.asn1.toDer(forge.pki.certificateToAsn1(o.identity.cert)).getBytes());
  const tbs = der.parseDer(certDer).children[0].children;
  const issuer = tbs[tbs[0].tag === 0xa0 ? 3 : 2];
  const signedData = (asn1.value as forgeType.asn1.Asn1[])[1].value as forgeType.asn1.Asn1[];
  const sdFields = signedData[0].value as forgeType.asn1.Asn1[];
  const signerInfo = (sdFields[sdFields.length - 1].value as forgeType.asn1.Asn1[])[0];
  const issuerAndSerial = (signerInfo.value as forgeType.asn1.Asn1[])[1];
  (issuerAndSerial.value as forgeType.asn1.Asn1[])[0] = forge.asn1.fromDer(toBinary(der.whole(certDer, issuer)));
  const cms = der.hex(fromBinary(forge.asn1.toDer(asn1).getBytes()));
  if (cms.length > SIGNATURE_SPACE * 2) throw new Error('The signature is too large for the space reserved in the file.');
  out.set(new TextEncoder().encode(cms), cStart + 1);
  return out;
}

// ---------------------------------------------------------------- verification

export type SigStatus = 'valid' | 'valid-modified' | 'invalid' | 'unknown';

export interface SignatureInfo {
  fieldName: string;
  page?: number;
  status: SigStatus;
  /** Why the status is what it is, in words. */
  detail: string;
  signer: string;
  signerDn?: string;
  issuer?: string;
  selfSigned?: boolean;
  certValidFrom?: Date;
  certValidTo?: Date;
  signedAt?: Date;
  reason?: string;
  location?: string;
  algorithm?: string;
  /** Whether the signature covers the entire file (no later changes). */
  coversWholeDocument: boolean;
}

const HASHES: Record<string, string> = {
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
};
const CURVES: Record<string, { name: string; size: number }> = {
  '1.2.840.10045.3.1.7': { name: 'P-256', size: 32 },
  '1.3.132.0.34': { name: 'P-384', size: 48 },
  '1.3.132.0.35': { name: 'P-521', size: 66 },
};
const OID_RSA = '1.2.840.113549.1.1.1';
const OID_EC = '1.2.840.10045.2.1';
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_SIGNING_TIME = '1.2.840.113549.1.9.5';

const strOf = (o: unknown) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : undefined);
const bytesOf = (o: unknown) => (o instanceof PDFHexString || o instanceof PDFString ? o.asBytes() : undefined);
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

interface ParsedCert {
  subject: ReturnType<typeof der.name>;
  issuer: ReturnType<typeof der.name>;
  serial: string;
  issuerDer: Uint8Array;
  subjectDer: Uint8Array;
  spki: Uint8Array;
  keyAlg: string;
  curve?: string;
  notBefore: Date;
  notAfter: Date;
}

function parseCert(b: Uint8Array, t: der.Tlv): ParsedCert {
  const tbs = t.children[0].children;
  const i = tbs[0].tag === 0xa0 ? 1 : 0; // optional explicit version
  const serial = der.hex(der.content(b, tbs[i]));
  const issuer = tbs[i + 2];
  const validity = tbs[i + 3];
  const subject = tbs[i + 4];
  const spki = tbs[i + 5];
  const alg = spki.children[0].children;
  return {
    subject: der.name(b, subject),
    issuer: der.name(b, issuer),
    serial,
    issuerDer: der.whole(b, issuer),
    subjectDer: der.whole(b, subject),
    spki: der.whole(b, spki),
    keyAlg: der.oid(b, alg[0]),
    curve: alg[1]?.tag === 0x06 ? der.oid(b, alg[1]) : undefined,
    notBefore: der.time(b, validity.children[0]),
    notAfter: der.time(b, validity.children[1]),
  };
}

/** ECDSA signatures are DER SEQUENCE { r, s }; Web Crypto wants fixed-size r || s. */
function ecdsaRaw(b: Uint8Array, size: number): Uint8Array {
  const seq = der.parseDer(b);
  const out = new Uint8Array(size * 2);
  seq.children.slice(0, 2).forEach((int, k) => {
    let v = der.content(b, int);
    while (v.length > size && v[0] === 0) v = v.subarray(1);
    out.set(v, k * size + (size - v.length));
  });
  return out;
}

async function verifyCms(cmsBytes: Uint8Array, signedData: Uint8Array): Promise<Omit<SignatureInfo, 'fieldName' | 'coversWholeDocument' | 'page' | 'reason' | 'location'>> {
  const b = cmsBytes;
  const contentInfo = der.parseDer(b);
  const sd = contentInfo.children[1].children[0]; // [0] EXPLICIT SignedData
  const certsNode = sd.children.find((c) => c.tag === 0xa0);
  const signerInfos = sd.children[sd.children.length - 1];
  const certs = (certsNode?.children ?? []).filter((c) => c.tag === 0x30).map((c) => parseCert(b, c));
  const si = signerInfos.children[0];
  if (!si) return { status: 'invalid', detail: 'The signature contains no signer.', signer: 'Unknown' };

  const [, sid, digestAlg, ...rest] = si.children;
  const signedAttrs = rest[0]?.tag === 0xa0 ? rest[0] : undefined;
  const after = signedAttrs ? rest.slice(1) : rest;
  const sigValue = der.content(b, after[1]);
  const hashOid = der.oid(b, digestAlg.children[0]);
  const hash = HASHES[hashOid];

  // Find the signer's certificate by issuer and serial number.
  let cert: ParsedCert | undefined;
  if (sid.tag === 0x30) {
    const issuerDer = der.whole(b, sid.children[0]);
    const serial = der.hex(der.content(b, sid.children[1]));
    cert = certs.find((c) => c.serial === serial && equal(c.issuerDer, issuerDer));
  } else if (certs.length === 1) {
    cert = certs[0]; // subjectKeyIdentifier: accept the only certificate present
  }
  const signer = cert?.subject.cn ?? cert?.subject.o ?? 'Unknown signer';
  const base = {
    signer,
    signerDn: cert?.subject.dn,
    issuer: cert ? cert.issuer.cn ?? cert.issuer.o ?? cert.issuer.dn : undefined,
    selfSigned: cert ? equal(cert.issuerDer, cert.subjectDer) : undefined,
    certValidFrom: cert?.notBefore,
    certValidTo: cert?.notAfter,
  };
  if (!hash || !cert) return { ...base, status: 'unknown', detail: !cert ? 'The signer certificate is missing.' : `Unsupported digest algorithm ${hashOid}.` };

  // 1. Integrity: the document digest must match the signed messageDigest attribute.
  const digest = new Uint8Array(await crypto.subtle.digest(hash, signedData as BufferSource));
  let signedAt: Date | undefined;
  let toVerify: Uint8Array = signedData;
  if (signedAttrs) {
    let md: Uint8Array | undefined;
    for (const a of signedAttrs.children) {
      const id = der.oid(b, a.children[0]);
      const val = a.children[1].children[0];
      if (id === OID_MESSAGE_DIGEST) md = der.content(b, val);
      if (id === OID_SIGNING_TIME) signedAt = der.time(b, val);
    }
    if (!md || !equal(md, digest)) {
      return { ...base, signedAt, status: 'invalid', detail: 'The document has been altered since it was signed.' };
    }
    // The signature covers the DER of the attributes re-tagged as a SET.
    toVerify = der.whole(b, signedAttrs).slice();
    toVerify[0] = 0x31;
  }

  // 2. The signature itself, checked with the signer's public key.
  let ok: boolean;
  let algorithm: string;
  try {
    if (cert.keyAlg === OID_RSA) {
      algorithm = `RSA with ${hash}`;
      const key = await crypto.subtle.importKey('spki', cert.spki as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
      ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sigValue as BufferSource, toVerify as BufferSource);
    } else if (cert.keyAlg === OID_EC && cert.curve && CURVES[cert.curve]) {
      const curve = CURVES[cert.curve];
      algorithm = `ECDSA ${curve.name} with ${hash}`;
      const key = await crypto.subtle.importKey('spki', cert.spki as BufferSource, { name: 'ECDSA', namedCurve: curve.name }, false, ['verify']);
      ok = await crypto.subtle.verify({ name: 'ECDSA', hash }, key, ecdsaRaw(sigValue, curve.size) as BufferSource, toVerify as BufferSource);
    } else {
      return { ...base, signedAt, status: 'unknown', detail: 'The signature uses a key type that cannot be checked here.' };
    }
  } catch (e) {
    return { ...base, signedAt, status: 'unknown', detail: `The signature could not be checked: ${(e as Error).message}` };
  }
  if (!ok) return { ...base, signedAt, algorithm, status: 'invalid', detail: 'The signature does not match the signer’s certificate.' };
  return { ...base, signedAt, algorithm, status: 'valid', detail: 'The document has not been modified since this signature was applied.' };
}

/** Find and check every signature in the document. */
export async function verifySignatures(bytes: Uint8Array): Promise<SignatureInfo[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return [];
  }
  const ctx = doc.context;
  // Map signature dictionaries to the fields (widgets) that use them.
  const fields: { sig: PDFRef; name: string; widget: PDFRef }[] = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of('FT'))?.toString() !== '/Sig') continue;
    const v = obj.get(PDFName.of('V'));
    if (v instanceof PDFRef) fields.push({ sig: v, name: strOf(obj.lookup(PDFName.of('T'))) ?? 'Signature', widget: ref });
  }
  const out: SignatureInfo[] = [];
  for (const field of fields) {
    const sig = ctx.lookup(field.sig);
    if (!(sig instanceof PDFDict)) continue;
    const range = (sig.lookup(PDFName.of('ByteRange')) as PDFArray | undefined)?.asArray().map((x) => (x as PDFNumber).asNumber?.() ?? NaN) ?? [];
    const contents = bytesOf(sig.lookup(PDFName.of('Contents')));
    let pageObj;
    try {
      pageObj = doc.findPageForAnnotationRef(field.widget);
    } catch {
      pageObj = undefined;
    }
    const common = {
      fieldName: field.name,
      page: pageObj ? doc.getPages().indexOf(pageObj) : undefined,
      reason: strOf(sig.lookup(PDFName.of('Reason'))),
      location: strOf(sig.lookup(PDFName.of('Location'))),
    };
    const name = strOf(sig.lookup(PDFName.of('Name'))) ?? 'Unknown signer';
    if (range.length !== 4 || range.some((x) => !Number.isFinite(x)) || !contents) {
      out.push({ ...common, signer: name, status: 'invalid', detail: 'The signature dictionary is malformed.', coversWholeDocument: false });
      continue;
    }
    const [a, la, c, lc] = range;
    if (a !== 0 || c + lc > bytes.length || la > c) {
      out.push({ ...common, signer: name, status: 'invalid', detail: 'The signed byte range does not fit the file.', coversWholeDocument: false });
      continue;
    }
    const coversWholeDocument = c + lc === bytes.length;
    const signed = new Uint8Array(la + lc);
    signed.set(bytes.subarray(0, la), 0);
    signed.set(bytes.subarray(c, c + lc), la);
    const subFilter = sig.lookup(PDFName.of('SubFilter'))?.toString();
    if (subFilter !== '/adbe.pkcs7.detached' && subFilter !== '/ETSI.CAdES.detached') {
      out.push({ ...common, signer: name, status: 'unknown', detail: `Signature format ${subFilter ?? '(none)'} is not supported.`, coversWholeDocument });
      continue;
    }
    let res: Awaited<ReturnType<typeof verifyCms>>;
    try {
      res = await verifyCms(contents, signed);
    } catch (e) {
      res = { signer: name, status: 'invalid', detail: `The signature data is corrupt (${(e as Error).message}).` };
    }
    if (res.status === 'valid' && !coversWholeDocument) {
      res = { ...res, status: 'valid-modified', detail: 'The signed revision is intact, but the document was changed after this signature was applied.' };
    }
    out.push({ ...common, ...res, signedAt: res.signedAt ?? parseSigDate(strOf(sig.lookup(PDFName.of('M')))), coversWholeDocument });
  }
  return out;
}

function parseSigDate(s: string | undefined): Date | undefined {
  const m = s?.match(/^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : undefined;
}
