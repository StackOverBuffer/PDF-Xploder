/** A quick accessibility check of the document structure, in the spirit of PDF/UA basics. */
import { PDFBool, PDFDict, PDFHexString, PDFName, PDFString } from '@cantoo/pdf-lib';
import { load } from './pdfOps';

export type CheckStatus = 'pass' | 'fail' | 'warn';
export type FixId = 'title' | 'lang' | 'displayTitle';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  fix?: FixId;
}

const str = (o: unknown) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText().trim() : '');

/**
 * `pageText[i]` is the number of text characters on page i (from the renderer),
 * `fieldsWithoutTooltip` the names of form fields lacking a /TU description.
 */
export async function checkAccessibility(bytes: Uint8Array, pageText: number[], fieldsWithoutTooltip: string[], contentAccessibility: boolean): Promise<CheckResult[]> {
  const doc = await load(bytes);
  const cat = doc.catalog;
  const out: CheckResult[] = [];

  const markInfo = cat.lookup(PDFName.of('MarkInfo'));
  const marked = markInfo instanceof PDFDict && markInfo.lookup(PDFName.of('Marked')) === PDFBool.True;
  const tagged = marked && cat.has(PDFName.of('StructTreeRoot'));
  out.push({ id: 'tagged', label: 'Tagged PDF', status: tagged ? 'pass' : 'fail', detail: tagged ? 'The document has a structure tree for screen readers.' : 'The document is not tagged; screen readers have to guess the reading order.' });

  const lang = str(cat.lookup(PDFName.of('Lang')));
  out.push({ id: 'lang', label: 'Document language', status: lang ? 'pass' : 'fail', detail: lang ? `Language is set to “${lang}”.` : 'No language is set, so text may be read with the wrong pronunciation.', fix: lang ? undefined : 'lang' });

  const title = doc.getTitle()?.trim();
  out.push({ id: 'title', label: 'Title', status: title ? 'pass' : 'fail', detail: title ? `Title: “${title}”.` : 'The document has no title.', fix: title ? undefined : 'title' });

  const vp = cat.lookup(PDFName.of('ViewerPreferences'));
  const shows = vp instanceof PDFDict && vp.lookup(PDFName.of('DisplayDocTitle')) === PDFBool.True;
  out.push({ id: 'displayTitle', label: 'Title shown in window', status: shows ? 'pass' : 'warn', detail: shows ? 'Viewers show the title instead of the file name.' : 'Viewers show the file name instead of the title.', fix: shows ? undefined : 'displayTitle' });

  const empty = pageText.map((n, i) => (n === 0 ? i + 1 : 0)).filter(Boolean);
  out.push({
    id: 'text', label: 'Real text', status: empty.length ? 'warn' : 'pass',
    detail: empty.length ? `Page${empty.length > 1 ? 's' : ''} ${summarise(empty)} contain${empty.length > 1 ? '' : 's'} no text (scanned or image-only?).` : 'Every page has extractable text.',
  });

  if (fieldsWithoutTooltip.length || doc.getForm().getFields().length) {
    out.push({
      id: 'fields', label: 'Form field descriptions', status: fieldsWithoutTooltip.length ? 'warn' : 'pass',
      detail: fieldsWithoutTooltip.length ? `${fieldsWithoutTooltip.length} field(s) have no tooltip: ${fieldsWithoutTooltip.slice(0, 5).join(', ')}${fieldsWithoutTooltip.length > 5 ? ', …' : ''}.` : 'Every form field has a tooltip.',
    });
  }

  out.push({ id: 'security', label: 'Assistive technology access', status: contentAccessibility ? 'pass' : 'fail', detail: contentAccessibility ? 'Security settings allow screen readers to extract text.' : 'Security settings block text extraction for accessibility.' });
  return out;
}

function summarise(pages: number[]): string {
  return pages.length > 8 ? `${pages.slice(0, 8).join(', ')}, …` : pages.join(', ');
}

export async function applyAccessibilityFix(bytes: Uint8Array, fix: FixId, value = ''): Promise<Uint8Array> {
  const doc = await load(bytes);
  if (fix === 'lang') doc.catalog.set(PDFName.of('Lang'), PDFString.of(value));
  if (fix === 'title') doc.setTitle(value, { showInWindowTitleBar: true });
  if (fix === 'displayTitle') doc.catalog.getOrCreateViewerPreferences().setDisplayDocTitle(true);
  return doc.save({ useObjectStreams: true });
}
