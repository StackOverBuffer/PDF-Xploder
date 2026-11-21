/**
 * The comment summary: every comment of the document, with author, date, status and
 * text, as a Markdown document. It is laid out by the Markdown-to-PDF pipeline
 * (markdownToPdf), so headings become bookmarks. Comment text is escaped, so it
 * renders the way it was written instead of as Markdown markup.
 */
import { ANNOT_LABELS } from './annotGeom';
import type { Annotation, AnnotType, ReviewStatus } from './types';

export interface CommentSummaryOptions {
  /** Threads shown as indented sub-items (off: the comment itself only). */
  includeReplies: boolean;
}

/** Backslash-escape the Markdown syntax characters in a comment, so they render literally. */
export function escapeMarkdownText(s: string): string {
  // The list and heading markers at a line start ("- ", "+ ", "1. ") would start a
  // block of their own, so they are escaped too.
  const chars = s.replace(/[#*_[\]`!<>|\\]/g, (m) => `\\${m}`);
  return chars.split('\n').map((line) => line.replace(/^(\s*)([-+]|\d+[.)])(\s)/, '$1\\$2$3')).join('\n');
}

/** The words of the generated document; the interface language chooses the column. */
const WORDS: Record<'en' | 'de', { comments: string; page: string; states: Record<ReviewStatus, string>; types: Record<AnnotType, string> }> = {
  en: {
    comments: 'Comments',
    page: 'Page {n}',
    states: { Accepted: 'Accepted', Rejected: 'Rejected', Cancelled: 'Cancelled', Completed: 'Completed', Reopened: 'Reopened' },
    types: { ...ANNOT_LABELS },
  },
  de: {
    comments: 'Kommentare',
    page: 'Seite {n}',
    states: { Accepted: 'Angenommen', Rejected: 'Abgelehnt', Cancelled: 'Zurückgezogen', Completed: 'Erledigt', Reopened: 'Wieder geöffnet' },
    types: {
      highlight: 'Hervorheben', underline: 'Unterstreichen', strikeout: 'Durchstreichen', ink: 'Stift', rect: 'Rechteck',
      ellipse: 'Ellipse', line: 'Linie', arrow: 'Pfeil', polygon: 'Vieleck', polyline: 'Linienzug', cloud: 'Wolke',
      text: 'Textfeld', note: 'Notiz', image: 'Bild', stamp: 'Stempel', redact: 'Schwärzungsmarkierung',
    },
  },
};

/** The comment's own words: a note or text box's text, otherwise the comment on the annotation. */
export function commentBody(a: Annotation): string {
  return a.type === 'note' || a.type === 'text' ? a.text : a.comment ?? '';
}

export function commentSummaryMarkdown(docName: string, byPage: { page: number; list: Annotation[] }[], o: CommentSummaryOptions, lang: 'en' | 'de'): string {
  const w = WORDS[lang];
  const date = new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
  // The store command notifies instead when there is nothing to summarize.
  if (!byPage.length) return '';
  const lines: string[] = [`# ${w.comments} — ${escapeMarkdownText(docName)}`];
  // `page` is the page's number as people count them (1-based), as the store passes it.
  for (const { page, list } of byPage) {
    lines.push('', `## ${w.page.replace('{n}', String(page))}`);
    for (const a of list) {
      const status = a.status ? ` · ${w.states[a.status]}` : '';
      lines.push(`- **${w.types[a.type]}** · ${escapeMarkdownText(a.author)} · ${date.format(a.createdAt)}${status}`);
      const body = escapeMarkdownText(commentBody(a));
      if (body) lines.push(`  ${body}`);
      if (o.includeReplies) {
        for (const r of a.replies ?? []) {
          lines.push(`  - ${escapeMarkdownText(r.author)}: ${escapeMarkdownText(r.text)}`);
        }
      }
    }
  }
  return lines.join('\n');
}

/** The comments as CSV for spreadsheets, RFC 4180: fields with separators, quotes or line breaks are quoted, quotes doubled, CRLF line endings. */
export function commentsCsv(rows: { page: number; type: string; author: string; date: string; status: string; text: string }[], lang: 'en' | 'de'): string {
  const sep = lang === 'de' ? ';' : ',';
  // A cell that starts like a formula (=, +, -, @, or a tab or carriage return before one)
  // would be run by Excel and LibreOffice: comment text and author names come from other
  // people's files, so such a cell gets a leading apostrophe and stays plain text.
  const defuse = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
  const esc = (raw: string) => {
    const s = defuse(raw);
    return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['page', 'type', 'author', 'date', 'status', 'text'];
  const lines = rows.map((r) => [String(r.page), r.type, r.author, r.date, r.status, r.text].map(esc).join(sep));
  return [head.join(sep), ...lines].join('\r\n');
}
