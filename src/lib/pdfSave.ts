/**
 * Saving with pdf-lib, minus what nothing refers to any more. pdf-lib writes every
 * object it ever loaded or created, so without this a deleted page, an edited
 * page's old content or a redacted page's original text would stay in the file
 * (and the file would grow with every edit).
 */
import { decodePDFRawStream, PDFArray, PDFDict, PDFHexString, PDFName, PDFNull, PDFRawStream, PDFRef, PDFStream, PDFString, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib';

/** The object if it has the expected type: broken files never make these lookups throw. */
const dictOf = (o: unknown) => (o instanceof PDFDict ? o : undefined);
const arrayOf = (o: unknown) => (o instanceof PDFArray ? o : undefined);


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

/**
 * Cut every reference to a page object that is no longer in the page tree (a deleted,
 * dropped or replaced page): bookmarks and links to it would otherwise point at nothing,
 * and the reference alone would keep the whole page — its text included — in the file.
 * Links that lead nowhere any more are removed; bookmarks stay, without a target.
 */
export function cutLostPageRefs(doc: PDFDocument): number {
  const ctx = doc.context;
  // Walked here rather than taken from doc.getPages(): callers that rebuild /Kids by hand
  // leave pdf-lib's page cache stale.
  const inTree = new Set<string>();
  const leaves: PDFDict[] = [];
  const visit = (ref: PDFObject | undefined, depth: number) => {
    if (!(ref instanceof PDFRef) || inTree.has(ref.toString()) || depth > 64) return;
    const node = ctx.lookup(ref);
    if (!(node instanceof PDFDict)) return;
    inTree.add(ref.toString());
    const kids = node.lookup(PDFName.of('Kids'));
    if (kids instanceof PDFArray) for (const k of kids.asArray()) visit(k, depth + 1);
    else leaves.push(node);
  };
  visit(doc.catalog.get(PDFName.of('Pages')), 0);
  const lost = new Set<string>();
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of('Type'))?.toString() === '/Page' && !inTree.has(ref.toString())) lost.add(ref.toString());
  }
  const isLost = (o: PDFObject | undefined) => o instanceof PDFRef && lost.has(o.toString());
  let cut = 0;
  /** Dictionaries (widgets above all) whose page was cut. */
  const orphaned = new Set<PDFDict>();
  const seen = new Set<PDFObject>();
  const stack: PDFObject[] = [];
  const { Root, Info } = ctx.trailerInfo;
  if (lost.size) for (const o of [Root, Info]) if (o) stack.push(o);
  while (stack.length) {
    let o = stack.pop()!;
    if (o instanceof PDFRef) {
      if (isLost(o)) continue;
      const v = ctx.lookup(o);
      if (!v) continue;
      o = v;
    }
    if (seen.has(o)) continue;
    seen.add(o);
    if (o instanceof PDFStream) o = o.dict;
    if (o instanceof PDFDict) {
      for (const [k, v] of o.entries()) {
        if (isLost(v)) {
          o.delete(k);
          if (k === PDFName.of('P')) orphaned.add(o);
          cut++;
        } else stack.push(v);
      }
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) {
        if (isLost(o.get(i))) {
          o.set(i, PDFNull);
          cut++;
        } else stack.push(o.get(i));
      }
    }
  }
  // A destination whose page is gone: no destination. A link without one goes entirely.
  const deadDest = (d: PDFObject | undefined): boolean => {
    const arr = d instanceof PDFRef ? ctx.lookup(d) : d;
    const a = arr instanceof PDFDict ? arr.lookup(PDFName.of('D')) : arr;
    if (!(a instanceof PDFArray) || !a.size()) return false;
    const target = a.get(0);
    // Cut above, or a reference to an object that no longer exists at all.
    return target === PDFNull || (target instanceof PDFRef && !ctx.lookup(target));
  };
  /** Removes a destination that leads nowhere; true when there was one. */
  const clearDest = (dict: PDFDict): boolean => {
    let cleared = false;
    if (deadDest(dict.get(PDFName.of('Dest')))) {
      dict.delete(PDFName.of('Dest'));
      cleared = true;
    }
    const action = dictOf(dict.lookup(PDFName.of('A')));
    if (action && deadDest(action.get(PDFName.of('D')))) {
      dict.delete(PDFName.of('A'));
      cleared = true;
    }
    return cleared;
  };
  for (const leaf of leaves) {
    const annots = leaf.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    const kept = annots.asArray().filter((ref) => {
      const a = ctx.lookup(ref);
      if (!(a instanceof PDFDict)) return false;
      // Only links whose target was cut here go (one without a target may be on purpose).
      return !(clearDest(a) && a.get(PDFName.of('Subtype'))?.toString() === '/Link' && !a.has(PDFName.of('Dest')) && !a.has(PDFName.of('A')));
    });
    if (kept.length !== annots.size()) leaf.set(PDFName.of('Annots'), ctx.obj(kept));
  }
  // Form fields whose widgets were on those pages: the widgets go, and a field left
  // without any goes too, so its value does not stay in the form data of the file.
  const onPages = new Set<PDFObject>();
  for (const leaf of leaves) for (const a of arrayOf(leaf.lookup(PDFName.of('Annots')))?.asArray() ?? []) onPages.add(ctx.lookup(a) ?? a);
  const gone = (w: PDFDict) => {
    if (onPages.has(w)) return false;
    if (orphaned.has(w)) return true;
    const p = w.get(PDFName.of('P'));
    return p instanceof PDFRef && !ctx.lookup(p);
  };
  /** Prunes the field's kids; true when the field itself should go. */
  const pruneField = (field: PDFDict, depth: number): boolean => {
    const kids = field.lookup(PDFName.of('Kids'));
    if (!(kids instanceof PDFArray) || depth > 32) return field.get(PDFName.of('Subtype'))?.toString() === '/Widget' && gone(field);
    if (!kids.size()) return false;
    const kept = kids.asArray().filter((k) => {
      const kid = ctx.lookup(k);
      return !(kid instanceof PDFDict) || !pruneField(kid, depth + 1);
    });
    if (kept.length === kids.size()) return false;
    field.set(PDFName.of('Kids'), ctx.obj(kept));
    return kept.length === 0;
  };
  const form = dictOf(doc.catalog.lookup(PDFName.of('AcroForm')));
  const fields = form?.lookup(PDFName.of('Fields'));
  if (fields instanceof PDFArray) {
    const kept = fields.asArray().filter((f) => {
      const field = ctx.lookup(f);
      return !(field instanceof PDFDict) || !pruneField(field, 0);
    });
    if (kept.length !== fields.size()) form!.set(PDFName.of('Fields'), ctx.obj(kept));
  }
  // Wrong types (fuzzed or broken files) are skipped, never thrown on.
  const dictAt = (d: PDFDict | undefined, key: string) => {
    const v = d?.lookup(PDFName.of(key));
    return v instanceof PDFDict ? v : undefined;
  };
  const walk = (item: PDFDict | undefined, depth: number) => {
    const visited = new Set<PDFDict>();
    while (item && !visited.has(item) && depth < 64) {
      visited.add(item);
      clearDest(item);
      walk(dictAt(item, 'First'), depth + 1);
      item = dictAt(item, 'Next');
    }
  };
  walk(dictAt(dictAt(doc.catalog, 'Outlines'), 'First'), 0);
  const open = doc.catalog.get(PDFName.of('OpenAction'));
  const action = dictAt(doc.catalog, 'OpenAction');
  if (deadDest(open) || (action && deadDest(action.get(PDFName.of('D'))))) doc.catalog.delete(PDFName.of('OpenAction'));
  return cut;
}

/**
 * Every font a form field's /DA names, in the form's default resources (/DR), and a
 * default /DA on the form. pdf-lib writes field /DAs such as "/Helvetica 10 Tf" with
 * the font only in the widget's own appearance; Acrobat, print servers and form
 * processors that regenerate an appearance resolve the name in /DR and fell back to
 * another font. The font is taken from the widget's appearance, or for the standard
 * Helvetica names created as a standard font.
 */
export function fillFormResources(doc: PDFDocument) {
  const ctx = doc.context;
  const form = dictOf(doc.catalog.lookup(PDFName.of('AcroForm')));
  const fields = form?.lookup(PDFName.of('Fields'));
  if (!form || !(fields instanceof PDFArray) || !fields.size()) return;
  let dr = dictOf(form.lookup(PDFName.of('DR')));
  let fonts = dictOf(dr?.lookup(PDFName.of('Font')));
  const ensureFonts = () => {
    if (!dr) {
      dr = ctx.obj({}) as PDFDict;
      form.set(PDFName.of('DR'), dr);
    }
    if (!fonts) {
      fonts = ctx.obj({}) as PDFDict;
      dr.set(PDFName.of('Font'), fonts);
    }
    return fonts;
  };
  const helvetica = () => ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }));
  const fontOfAppearance = (widget: PDFDict, name: PDFName): PDFObject | undefined => {
    const n = dictOf(widget.lookup(PDFName.of('AP')))?.lookup(PDFName.of('N'));
    const streams = n instanceof PDFStream ? [n] : n instanceof PDFDict ? n.values().map((v) => ctx.lookup(v)).filter((v): v is PDFStream => v instanceof PDFStream) : [];
    for (const st of streams) {
      const f = dictOf(dictOf(st.dict.lookup(PDFName.of('Resources')))?.lookup(PDFName.of('Font')))?.get(name);
      if (f) return f;
    }
    return undefined;
  };
  const visit = (o: PDFObject | undefined, inheritedDa: string | undefined, depth: number) => {
    const dict = o instanceof PDFRef ? ctx.lookup(o) : o;
    if (!(dict instanceof PDFDict) || depth > 32) return;
    const own = dict.lookup(PDFName.of('DA'));
    const da = own instanceof PDFString || own instanceof PDFHexString ? own.decodeText() : inheritedDa;
    const m = da?.match(/\/([^\s/]+)\s+[\d.]+\s+Tf/);
    if (m) {
      const name = PDFName.of(m[1]);
      if (!fonts?.has(name)) {
        const font = fontOfAppearance(dict, name) ?? (/^(Helv|Helvetica)$/.test(m[1]) ? helvetica() : undefined);
        if (font) ensureFonts().set(name, font);
      }
    }
    const kids = dict.lookup(PDFName.of('Kids'));
    if (kids instanceof PDFArray) for (const k of kids.asArray()) visit(k, da, depth + 1);
  };
  for (const f of fields.asArray()) visit(f, undefined, 0);
  if (!form.has(PDFName.of('DA'))) {
    if (!fonts?.has(PDFName.of('Helv'))) ensureFonts().set(PDFName.of('Helv'), helvetica());
    form.set(PDFName.of('DA'), PDFString.of('/Helv 0 Tf 0 g'));
  }
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
  simple('xmp:CreatorTool', get('Creator'));
  list('dc:title', get('Title'));
  list('dc:creator', get('Author'));
  list('dc:description', get('Subject'));
  // Properties the XMP does not have yet: added in a description of their own, so the
  // two stay equivalent (PDF/A requires it).
  const has = (name: string) => new RegExp(`<${name}[\\s>/]|\\s${name}\\s*=`).test(xml);
  const add: string[] = [];
  const addSimple = (name: string, value: string | undefined) => {
    if (value && !has(name)) add.push(`<${name}>${xmlEscape(value)}</${name}>`);
  };
  const addList = (name: string, kind: 'Alt' | 'Seq', value: string | undefined) => {
    if (value && !has(name)) add.push(`<${name}><rdf:${kind}><rdf:li${kind === 'Alt' ? ' xml:lang="x-default"' : ''}>${xmlEscape(value)}</rdf:li></rdf:${kind}></${name}>`);
  };
  addList('dc:title', 'Alt', get('Title'));
  addList('dc:creator', 'Seq', get('Author'));
  addList('dc:description', 'Alt', get('Subject'));
  addSimple('pdf:Keywords', get('Keywords'));
  addSimple('pdf:Producer', get('Producer'));
  addSimple('xmp:CreatorTool', get('Creator'));
  addSimple('xmp:ModifyDate', date);
  if (add.length && /<\/rdf:RDF>/.test(xml)) {
    const desc = `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">${add.join('')}</rdf:Description>`;
    xml = xml.replace(/<\/rdf:RDF>/, `${desc}</rdf:RDF>`);
  }
  if (xml === before) return;
  const out = doc.context.stream(new TextEncoder().encode(xml), { Type: 'Metadata', Subtype: 'XML' });
  doc.context.assign(ref, out);
}

/** A fresh 16-byte file ID part (as pdfOps stamps new documents with). */
const randomFileId = () => PDFHexString.fromBytes(crypto.getRandomValues(new Uint8Array(16)));

/**
 * A save changes the document, so the file says so: a current /ModDate and a refreshed
 * /ID[1]. pdf-lib stamps the date only when loading with updateMetadata — which this app
 * never does — so without this an edit would keep the file's old date, and syncXmp would
 * copy that stale date into the XMP. /ID[0] stays: encryption keys are derived from it.
 * Runs before syncXmp so the XMP gets the new date. The signature path saves incrementally
 * (signature.ts), not through here: signed byte ranges must not move.
 */
function touchSaveMetadata(doc: PDFDocument): void {
  doc.setModificationDate(new Date());
  const ctx = doc.context;
  const fresh = randomFileId();
  const id = ctx.trailerInfo.ID ? ctx.lookup(ctx.trailerInfo.ID) : undefined;
  if (!(id instanceof PDFArray)) ctx.trailerInfo.ID = ctx.obj([fresh, fresh]);
  else if (id.size() === 0) { id.push(fresh); id.push(fresh); }
  else id.set(1, fresh);
}

/**
 * Remove XFA form data: pdf-lib cannot read or write it, and once fields change the XFA
 * datasets would disagree with them (Adobe renders from the XFA model and would show old
 * values). Documents whose fields are untouched keep their XFA (loadForEdit preserves it);
 * everything that fills or reshapes the form calls this before saving.
 */
export function dropXfa(doc: PDFDocument): void {
  const form = doc.catalog.lookup(PDFName.of('AcroForm'));
  if (!(form instanceof PDFDict)) return;
  form.delete(PDFName.of('XFA'));
  // A dynamic form asks for regeneration on open; without its data that would hang or fail.
  form.delete(PDFName.of('NeedsRendering'));
}

/** The catalog's XMP metadata as text, if the file has any. */
function catalogXmp(doc: PDFDocument): string | undefined {
  const stream = doc.catalog.lookup(PDFName.of('Metadata'));
  if (!(stream instanceof PDFRawStream)) return undefined;
  try {
    return new TextDecoder().decode(stream.dict.get(PDFName.of('Filter')) ? decodePDFRawStream(stream).decode() : stream.getContents());
  } catch {
    return undefined;
  }
}

/** The file declares PDF/A-1 conformance, which forbids object and cross-reference streams. */
export function isPdfA1(doc: PDFDocument): boolean {
  const xml = catalogXmp(doc);
  return !!xml && /pdfaid:part(?:>\s*|\s*=\s*["'])1\b/.test(xml);
}

/**
 * A widget whose /AP /N points nowhere (e.g. "/AP << /N 0 0 R >>") makes pdf-lib throw
 * while it updates field appearances, so a form with one could not be saved at all.
 * Drop such appearance dictionaries: pdf-lib then draws fresh ones.
 */
export function dropBrokenAppearances(doc: PDFDocument): number {
  if (!doc.catalog.has(PDFName.of('AcroForm'))) return 0;
  let dropped = 0;
  const AP = PDFName.of('AP');
  const N = PDFName.of('N');
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of('Subtype'))?.toString() !== '/Widget') continue;
    const ap = obj.lookup(AP);
    if (ap === undefined) continue;
    const n = ap instanceof PDFDict ? ap.lookup(N) : undefined;
    if (n instanceof PDFDict || n instanceof PDFStream) continue;
    obj.delete(AP);
    dropped++;
  }
  return dropped;
}

/** Save a document (with object streams, unless it is PDF/A-1), leaving out unreachable objects. */
export async function saveDoc(doc: PDFDocument, opts: { useObjectStreams?: boolean } = {}): Promise<Uint8Array> {
  // Embedded fonts and images become objects only when flushed: do that before pruning.
  await doc.flush();
  touchSaveMetadata(doc);
  syncXmp(doc);
  dropBrokenAppearances(doc);
  cutLostPageRefs(doc);
  fillFormResources(doc);
  pruneUnreachable(doc);
  return doc.save({ useObjectStreams: opts.useObjectStreams ?? !isPdfA1(doc) });
}
