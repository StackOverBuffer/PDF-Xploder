/**
 * Error messages for people. PDF-Xploder's own errors say what went wrong in words
 * the user understands; errors from the PDF libraries or the browser ("Expected instance
 * of PDFDict, but got instance of undefined", minified class names, TypeErrors) do not,
 * so the user gets a plain message instead and the details stay in the console.
 */

/** Shown instead of a technical error (an English key, translated where it is shown). */
export const TECHNICAL_ERROR = 'This did not work: the document contains something PDF-Xploder cannot process here. Technical details are in the browser console.';

/** Error types thrown by the JavaScript runtime itself, never by our own checks. */
const RUNTIME_ERRORS = new Set(['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'InternalError', 'EvalError', 'URIError']);

/** Messages of pdf-lib, pdf.js and the runtime, by their wording. */
const TECHNICAL = [
  /instance of/i,
  /\bpdf-?lib\b|PDFDocument\.|useObjectStreams|ignoreEncryption/,
  /Failed to parse|Trying to parse|No PDF header|Invalid object ref|Bad XRef|Invalid PDF structure|Unknown (?:filter|compression)/i,
  /Cannot (?:read|set) propert|is not a function|is not defined|is not iterable|is not a constructor|Maximum call stack/i,
  /\b(?:undefined|null)\b/,
  /Unexpected (?:token|end of)|out of (?:range|bounds|memory)|Array buffer allocation|Invalid (?:array|typed array) length/i,
];

/** The error comes from a library or the runtime rather than from PDF-Xploder's own checks. */
export function isTechnicalError(e: unknown): boolean {
  const err = e as { name?: unknown; message?: unknown } | null;
  if (typeof err?.name === 'string' && RUNTIME_ERRORS.has(err.name)) return true;
  const msg = typeof err?.message === 'string' ? err.message : String(e);
  return !msg.trim() || TECHNICAL.some((re) => re.test(msg));
}

/** What to tell the user about `e` (an English key or an already translated message). */
export function userMessage(e: unknown): string {
  if (isTechnicalError(e)) return TECHNICAL_ERROR;
  return (e as Error)?.message || String(e);
}
