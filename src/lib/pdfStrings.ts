/**
 * Writing strings into PDF objects. pdf-lib's PDFString.of writes its argument between
 * parentheses as it is: an unbalanced "(" or a "\" breaks the object (a bookmark titled
 * "Chapter 1 (draft" vanished on reload), and characters above U+00FF are cut to one byte.
 */
import { PDFHexString, PDFString } from '@cantoo/pdf-lib';

/** A text string (titles, names, labels): UTF-16 as hex, so any character survives. */
export const textString = (s: string): PDFHexString => PDFHexString.fromText(s);

/**
 * A byte string for 7-bit values such as URIs and language tags: characters outside
 * printable ASCII are percent-encoded (as URIs require) and the delimiters escaped.
 */
export function asciiString(s: string): PDFString {
  const ascii = s.replace(/[^\x21-\x7e]/gu, (c) => encodeURIComponent(c));
  return PDFString.of(ascii.replace(/[\\()]/g, (c) => `\\${c}`));
}
