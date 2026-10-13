/** Embedded files (the document's EmbeddedFiles name tree). */
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream, type PDFObject } from '@cantoo/pdf-lib';
import { load } from './pdfOps';

export interface AttachmentInfo {
  /** Key in the name tree; unique within the document. */
  key: string;
  fileName: string;
  description: string;
  size: number | null;
  mimeType: string;
}

const text = (o: PDFObject | undefined) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '');

type Leaf = { key: string; spec: PDFDict; names: PDFArray; at: number };

/** Every leaf entry of a name tree, with where it lives so it can be removed. */
function leaves(node: PDFDict | undefined, out: Leaf[] = [], depth = 0): Leaf[] {
  if (!node || depth > 32) return out;
  const names = node.lookup(PDFName.of('Names'));
  if (names instanceof PDFArray) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      const spec = names.lookup(i + 1);
      if (spec instanceof PDFDict) out.push({ key: text(names.lookup(i)), spec, names, at: i });
    }
  }
  const kids = node.lookup(PDFName.of('Kids'));
  if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) leaves(kids.lookup(i) as PDFDict, out, depth + 1);
  return out;
}

function tree(doc: Awaited<ReturnType<typeof load>>): PDFDict | undefined {
  const names = doc.catalog.lookup(PDFName.of('Names'));
  const ef = names instanceof PDFDict ? names.lookup(PDFName.of('EmbeddedFiles')) : undefined;
  return ef instanceof PDFDict ? ef : undefined;
}

function fileStream(spec: PDFDict): PDFRawStream | undefined {
  const ef = spec.lookup(PDFName.of('EF'));
  if (!(ef instanceof PDFDict)) return undefined;
  const s = ef.lookup(PDFName.of('UF')) ?? ef.lookup(PDFName.of('F'));
  return s instanceof PDFRawStream ? s : undefined;
}

export async function listAttachments(bytes: Uint8Array): Promise<AttachmentInfo[]> {
  const doc = await load(bytes);
  return leaves(tree(doc)).map(({ key, spec }) => {
    const stream = fileStream(spec);
    const params = stream?.dict.lookup(PDFName.of('Params'));
    const size = params instanceof PDFDict ? params.lookup(PDFName.of('Size')) : undefined;
    const subtype = stream?.dict.lookup(PDFName.of('Subtype'));
    return {
      key,
      fileName: text(spec.lookup(PDFName.of('UF'))) || text(spec.lookup(PDFName.of('F'))) || key,
      description: text(spec.lookup(PDFName.of('Desc'))),
      size: size && 'asNumber' in size ? (size as { asNumber(): number }).asNumber() : null,
      mimeType: subtype instanceof PDFName ? subtype.decodeText().replace(/#2F/gi, '/') : '',
    };
  });
}

/** The decoded contents of an attachment. */
export async function readAttachment(bytes: Uint8Array, key: string): Promise<Uint8Array> {
  const doc = await load(bytes);
  const leaf = leaves(tree(doc)).find((l) => l.key === key);
  const stream = leaf && fileStream(leaf.spec);
  if (!stream) throw new Error(`Attachment “${key}” has no file data`);
  return decodePDFRawStream(stream).decode();
}

/** A key not yet used in the name tree (attachments are keyed by file name). */
function freeKey(existing: Set<string>, name: string): string {
  if (!existing.has(name)) return name;
  const m = /^(.*?)(\.[^.]*)?$/.exec(name)!;
  for (let i = 2; ; i++) if (!existing.has(`${m[1]} (${i})${m[2] ?? ''}`)) return `${m[1]} (${i})${m[2] ?? ''}`;
}

export async function addAttachment(bytes: Uint8Array, file: { name: string; type: string; bytes: Uint8Array; lastModified?: number }, description = ''): Promise<Uint8Array> {
  const doc = await load(bytes);
  const keys = new Set(leaves(tree(doc)).map((l) => l.key));
  await doc.attach(file.bytes, freeKey(keys, file.name), {
    mimeType: file.type || 'application/octet-stream',
    description: description || undefined,
    modificationDate: file.lastModified ? new Date(file.lastModified) : undefined,
  });
  return doc.save({ useObjectStreams: true });
}

export async function removeAttachment(bytes: Uint8Array, key: string): Promise<Uint8Array> {
  const doc = await load(bytes);
  const leaf = leaves(tree(doc)).find((l) => l.key === key);
  if (!leaf) return bytes;
  const specRef = leaf.names.get(leaf.at + 1);
  leaf.names.remove(leaf.at);
  leaf.names.remove(leaf.at);
  // PDF/A-3 also lists attachments in the catalog's /AF array.
  const af = doc.catalog.lookup(PDFName.of('AF'));
  if (af instanceof PDFArray) {
    const i = af.indexOf(specRef);
    if (i !== undefined && i >= 0) af.remove(i);
  }
  return doc.save({ useObjectStreams: true });
}
