import { describe, expect, it } from 'vitest';
import { formatSignedDate, materializeStampLabel, SIGN_MARK_NAMES } from '../src/lib/fillSign';

const day = new Date(2026, 10, 21); // months are 0-based

describe('fill & sign helpers', () => {
  it('formats the date per language, without Intl', () => {
    expect(formatSignedDate('de', day)).toBe('21.11.2026');
    expect(formatSignedDate('en', day)).toBe('Nov 21, 2026');
    expect(formatSignedDate(undefined, day)).toBe('Nov 21, 2026');
  });

  it('materializes dynamic stamp labels, passes others through', () => {
    expect(materializeStampLabel('dynamic:Approved', 'Jane Doe', 'de', day)).toBe('Approved – Jane Doe – 21.11.2026');
    expect(materializeStampLabel('dynamic:Reviewed', 'Guest', 'en', day)).toBe('Reviewed – Guest – Nov 21, 2026');
    expect(materializeStampLabel('Approved', 'Jane Doe', 'de', day)).toBe('Approved');
  });

  it('names the marks as other editors expect', () => {
    expect(SIGN_MARK_NAMES).toEqual({ check: 'Checkmark', cross: 'Cross' });
  });
});
