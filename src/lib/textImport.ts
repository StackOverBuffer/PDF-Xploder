/** Which files are converted from text (Markdown, plain text) when opened or inserted. */

export type TextKind = 'markdown' | 'text';

/** For file inputs: PDFs plus the text formats. */
export const OPEN_ACCEPT = 'application/pdf,.pdf,text/markdown,.md,.markdown,text/plain,.txt';

/** For file inputs: the text formats only. */
export const TEXT_ACCEPT = 'text/markdown,.md,.markdown,text/plain,.txt';

/** For the open picker (File System Access API). */
export const TEXT_PICKER_ACCEPT: Record<string, string[]> = { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'] };

export function textKind(f: { name: string; type: string }): TextKind | null {
  if (/\.(md|markdown|mdown|mkd)$/i.test(f.name) || f.type === 'text/markdown' || f.type === 'text/x-markdown') return 'markdown';
  if (/\.txt$/i.test(f.name) || f.type === 'text/plain') return 'text';
  return null;
}

export const isPdfFile = (f: { name: string; type: string }) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** "notes.md" → "notes.pdf". */
export const pdfNameFor = (name: string) => `${name.replace(/\.[^.]+$/, '') || 'document'}.pdf`;
