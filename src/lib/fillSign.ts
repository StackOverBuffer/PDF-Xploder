/**
 * Helpers for the Fill & Sign tools: the names other editors give the check and
 * cross marks, a locale-independent date format, and dynamic stamp labels.
 */

/** A Fill & Sign mark drawn as a vector glyph instead of a boxed label. */
export type SignMarkKind = 'check' | 'cross';

/** The stamp's /Name in the file, as other editors spell these marks. */
export const SIGN_MARK_NAMES: Record<SignMarkKind, string> = { check: 'Checkmark', cross: 'Cross' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Today's date as the Fill & Sign tools write it. Hand-rolled (no Intl: month
 * names differ per ICU build, so tests would disagree across machines).
 */
export function formatSignedDate(lang: string | undefined, now?: Date): string {
  const d = now ?? new Date();
  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();
  const pad = (n: number) => String(n).padStart(2, '0');
  return lang === 'de' ? `${pad(day)}.${pad(month + 1)}.${year}` : `${MONTHS[month]} ${day}, ${year}`;
}

/**
 * A dynamic stamp's label is a template with a `dynamic:` prefix; at placement
 * time it becomes `Base – author – date` (en dash). Anything else passes through.
 */
export function materializeStampLabel(template: string, author: string, lang: string | undefined, now?: Date): string {
  if (!template.startsWith('dynamic:')) return template;
  const base = template.slice('dynamic:'.length);
  return `${base} – ${author} – ${formatSignedDate(lang, now)}`;
}
