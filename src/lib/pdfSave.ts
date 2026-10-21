/**
 * Saving with pdf-lib, minus what nothing refers to any more. pdf-lib writes every
 * object it ever loaded or created, so without this a deleted page, an edited
 * page's old content or a redacted page's original text would stay in the file
 * (and the file would grow with every edit).
 */
import { decodePDFRawStream, PDFArray, PDFDict, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFStream, PDFString, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib';

/** Delete indirect objects that cannot be reached from the trailer. Returns how many were removed. */
export function pruneUnreachable(doc: PDFDocument): number {
  const ctx = doc.context;
  const reached = new Set<string>();
  const stack: PDFObject[] = [];
  const { Root, Info, Encrypt, ID } = ctx.trailerInfo;
  for (const o of [Root, Info, Encrypt, ID]) if (o) stack.push(o);
  while (stack.length) {
    const o = stack.pop()!;
    if (o instanceof PDFRef) {
      const tag = o.toString();
      if (reached.has(tag)) continue;
      reached.add(tag);
      const v = ctx.lookup(o);
      if (v) stack.push(v);
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v);
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) stack.push(v);
    } else if (o instanceof PDFStream) {
      stack.push(o.dict);
    }
  }
  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!reached.has(ref.toString())) {
      ctx.delete(ref);
      removed++;
    }
  }
  return removed;
}

const xmlEscape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "D:20261021191500+02'00'" → "2026-10-21T19:15:00+02:00" (XMP dates). */
function xmpDate(pdfDate: string): string | undefined {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(pdfDate);
  if (!m) return undefined;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz, th = '00', tm = '00'] = m;
  const zone = !tz ? '' : tz === 'Z' || tz === 'z' ? 'Z' : `${tz}${th}:${tm}`;
  return `${y}-${mo}-${d}T${h}:${mi}:${se}${zone}`;
}

/**
 * Bring the XMP metadata (if the file has any) in line with the document information:
 * validators and archives flag a mismatch, and some programs show the XMP values.
 * Only fields the XMP already has are changed; it is written unfiltered.
 */
export function syncXmp(doc: PDFDocument): void {
  const ref = doc.catalog.get(PDFName.of('Metadata'));
  const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : undefined;
  if (!(ref instanceof PDFRef) || !(stream instanceof PDFRawStream)) return;
  const infoRef = doc.context.trailerInfo.Info;
  const info = infoRef ? doc.context.lookup(infoRef) : undefined;
  if (!(info instanceof PDFDict)) return;
  const get = (k: string) => {
    const v = info.lookup(PDFName.of(k));
    return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined;
  };
  let bytes: Uint8Array;
  try {
    bytes = stream.dict.get(PDFName.of('Filter')) ? decodePDFRawStream(stream).decode() : stream.getContents();
  } catch {
    return;
  }
  let xml = new TextDecoder().decode(bytes);
  const before = xml;
  // A simple property, as an element or as an attribute.
  const simple = (name: string, value: string | undefined) => {
    if (value === undefined) return;
    const v = xmlEscape(value);
    xml = xml.replace(new RegExp(`(<${name}>)[^<]*(</${name}>)`, 'g'), `$1${v}$2`).replace(new RegExp(`(${name}=")[^"]*(")`, 'g'), `$1${v}$2`);
  };
  // The first entry of an rdf:Alt / rdf:Seq (dc:title, dc:creator, dc:description).
  const list = (name: string, value: string | undefined) => {
    if (value === undefined) return;
    xml = xml.replace(new RegExp(`(<${name}>\\s*<rdf:(?:Alt|Seq|Bag)>\\s*<rdf:li[^>]*>)[^<]*(</rdf:li>)`), `$1${xmlEscape(value)}$2`);
  };
  const mod = get('ModDate');
  const date = mod ? xmpDate(mod) : undefined;
  simple('xmp:ModifyDate', date);
  simple('xmp:MetadataDate', date);
  simple('pdf:Producer', get('Producer'));
  simple('pdf:Keywords', get('Keywords'));
  list('dc:title', get('Title'));
  list('dc:creator', get('Author'));
  list('dc:description', get('Subject'));
  if (xml === before) return;
  const out = doc.context.stream(new TextEncoder().encode(xml), { Type: 'Metadata', Subtype: 'XML' });
  doc.context.assign(ref, out);
}

/** Save a document (with object streams), leaving out unreachable objects. */
export async function saveDoc(doc: PDFDocument, opts: { useObjectStreams?: boolean } = {}): Promise<Uint8Array> {
  // Embedded fonts and images become objects only when flushed: do that before pruning.
  await doc.flush();
  syncXmp(doc);
  pruneUnreachable(doc);
  return doc.save({ useObjectStreams: opts.useObjectStreams ?? true });
}
