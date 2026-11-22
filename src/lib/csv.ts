/**
 * One CSV cell (RFC 4180): quoted when it holds the separator, a quote or a line
 * break, with quotes doubled. Text from documents or their authors that starts like a
 * formula (=, +, -, @, or a tab or carriage return before one) would be run by Excel
 * and LibreOffice when the file is opened; such text gets a leading apostrophe and
 * stays plain text. Numbers written by the app itself pass `formula: false`.
 */
export function csvCell(raw: string, sep: string, o: { formula?: boolean } = {}): string {
  const s = o.formula === false || !/^[=+\-@\t\r]/.test(raw) ? raw : `'${raw}`;
  return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
