/**
 * Sanitize a document: remove what can run, call out or hide information, without
 * touching what the pages show. Each part can be chosen on its own.
 */
import { PDFArray, PDFDict, PDFName, PDFRef, PDFStream, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib';
import { isPdfA, removeMetadata, removeThumbnails } from './optimize';
import { saveDoc } from './pdfSave';

export interface SanitizeOptions {
  /** JavaScript (document, page, field and link scripts), launching programs, XFA forms. */
  scripts?: boolean;
  /** Sending or importing form data (submit/import actions) and loading remote content (GoToR, remote GoToE). */
  externalActions?: boolean;
  /** Attached files, document-level and as comments on the page. */
  attachments?: boolean;
  /** Document information (author, dates…), XMP metadata and other programs' private data. */
  metadata?: boolean;
  /** Embedded page thumbnails and web-capture data. */
  hiddenData?: boolean;
}

export interface SanitizeReport {
  scripts: number;
  externalActions: number;
  attachments: number;
  metadataRemoved: boolean;
  /** Metadata was asked to be removed but kept, because the file claims PDF/A conformance. */
  keptForPdfA: boolean;
  hiddenData: number;
}

const N = (k: string) => PDFName.of(k);
const SCRIPT_ACTIONS = new Set(['JavaScript', 'Launch', 'Rendition']);
const EXTERNAL_ACTIONS = new Set(['SubmitForm', 'ImportData', 'GoToR', 'GoToE']);

/** Every dictionary of the document (indirect objects, and dictionaries inside them). */
function allDicts(doc: PDFDocument): PDFDict[] {
  const out: PDFDict[] = [];
  const seen = new Set<PDFObject>();
  const visit = (o: PDFObject | undefined) => {
    if (!o || seen.has(o)) return;
    seen.add(o);
    if (o instanceof PDFStream) visit(o.dict);
    else if (o instanceof PDFDict) {
      out.push(o);
      for (const [, v] of o.entries()) if (!(v instanceof PDFRef)) visit(v);
    } else if (o instanceof PDFArray) for (const v of o.asArray()) if (!(v instanceof PDFRef)) visit(v);
  };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) visit(obj);
  visit(doc.context.trailerInfo.Info ? doc.context.lookup(doc.context.trailerInfo.Info) : undefined);
  return out;
}

/** The kinds of an action and of the actions chained after it (/Next). */
function actionKinds(doc: PDFDocument, a: PDFObject | undefined, depth = 0): string[] {
  const d = a instanceof PDFRef ? doc.context.lookup(a) : a;
  if (!(d instanceof PDFDict) || depth > 20) return [];
  const s = d.lookup(N('S'));
  const kinds = s instanceof PDFName ? [s.decodeText()] : [];
  const next = d.lookup(N('Next'));
  const list = next instanceof PDFArray ? next.asArray() : next ? [next] : [];
  for (const n of list) kinds.push(...actionKinds(doc, n, depth + 1));
  return kinds;
}

function deleteNameTree(doc: PDFDocument, key: string): number {
  const names = doc.catalog.lookup(N('Names'));
  if (!(names instanceof PDFDict) || !names.has(N(key))) return 0;
  let count = 0;
  const walk = (node: PDFObject | undefined, depth: number) => {
    const d = node instanceof PDFRef ? doc.context.lookup(node) : node;
    if (!(d instanceof PDFDict) || depth > 20) return;
    const n = d.lookup(N('Names'));
    if (n instanceof PDFArray) count += Math.floor(n.size() / 2);
    const kids = d.lookup(N('Kids'));
    if (kids instanceof PDFArray) for (const k of kids.asArray()) walk(k, depth + 1);
  };
  walk(names.get(N(key)), 0);
  names.delete(N(key));
  return Math.max(1, count);
}

/** Sanitize a loaded document in place. */
export function sanitizeDocument(doc: PDFDocument, o: SanitizeOptions): SanitizeReport {
  const report: SanitizeReport = { scripts: 0, externalActions: 0, attachments: 0, metadataRemoved: false, keptForPdfA: false, hiddenData: 0 };
  const remove = new Set<string>();
  if (o.scripts) SCRIPT_ACTIONS.forEach((k) => remove.add(k));
  if (o.externalActions) EXTERNAL_ACTIONS.forEach((k) => remove.add(k));
  const countAction = (kinds: string[]) => {
    for (const k of kinds) {
      if (o.scripts && SCRIPT_ACTIONS.has(k)) report.scripts++;
      else if (o.externalActions && EXTERNAL_ACTIONS.has(k)) report.externalActions++;
    }
  };

  if (o.scripts) report.scripts += deleteNameTree(doc, 'JavaScript');
  if (o.attachments) report.attachments += deleteNameTree(doc, 'EmbeddedFiles');

  if (remove.size) {
    for (const d of allDicts(doc)) {
      // Actions triggered by events (opening, closing, printing, focusing a field, calculating…).
      const aa = d.lookup(N('AA'));
      if (aa instanceof PDFDict) {
        for (const [event, a] of aa.entries()) {
          const bad = actionKinds(doc, a).filter((k) => remove.has(k));
          if (!bad.length) continue;
          countAction(bad);
          aa.delete(event);
        }
        if (!aa.keys().length) d.delete(N('AA'));
      }
      for (const key of ['A', 'OpenAction']) {
        const kinds = actionKinds(doc, d.get(N(key)));
        const bad = kinds.filter((k) => remove.has(k));
        if (bad.length) {
          countAction(bad);
          d.delete(N(key));
        }
      }
    }
  }

  if (o.scripts) {
    // XFA forms carry their own scripts; the standard form fields stay.
    const form = doc.catalog.lookup(N('AcroForm'));
    if (form instanceof PDFDict && form.has(N('XFA'))) {
      form.delete(N('XFA'));
      form.delete(N('NeedsRendering'));
      report.scripts++;
    }
  }

  if (o.attachments) {
    for (const page of doc.getPages()) {
      const annots = page.node.Annots();
      if (!annots) continue;
      const keep = annots.asArray().filter((r) => {
        const a = doc.context.lookup(r);
        return !(a instanceof PDFDict && a.lookup(N('Subtype')) === N('FileAttachment'));
      });
      if (keep.length !== annots.size()) {
        report.attachments += annots.size() - keep.length;
        page.node.set(N('Annots'), doc.context.obj(keep));
      }
    }
    // Associated files (PDF/A-3, ZUGFeRD invoices…): references to the files counted above.
    for (const d of allDicts(doc)) d.delete(N('AF'));
  }

  if (o.metadata) {
    if (isPdfA(doc)) report.keptForPdfA = true;
    else {
      removeMetadata(doc);
      report.metadataRemoved = true;
    }
  }

  if (o.hiddenData) {
    report.hiddenData += doc.getPages().filter((p) => p.node.has(N('Thumb'))).length;
    removeThumbnails(doc);
    for (const k of ['SpiderInfo', 'PieceInfo']) if (doc.catalog.has(N(k))) {
      doc.catalog.delete(N(k));
      report.hiddenData++;
    }
    for (const page of doc.getPages()) for (const k of ['PieceInfo', 'ID']) if (page.node.has(N(k))) {
      page.node.delete(N(k));
      report.hiddenData++;
    }
  }
  return report;
}

export async function sanitize(doc: PDFDocument, o: SanitizeOptions): Promise<{ bytes: Uint8Array; report: SanitizeReport }> {
  const report = sanitizeDocument(doc, o);
  return { bytes: await saveDoc(doc), report };
}
