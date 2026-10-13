import { describe, expect, it } from 'vitest';
import DE_UI from '../src/locales/de/ui';
import { translate } from '../src/lib/i18n';

describe('German UI strings', () => {
  it('maps trimmed English keys to non-empty strings', () => {
    const entries = Object.entries(DE_UI);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, value] of entries) {
      expect(key, `key ${JSON.stringify(key)}`).toBe(key.trim());
      expect(key.length).toBeGreaterThan(0);
      expect(typeof value, `value of ${JSON.stringify(key)}`).toBe('string');
      expect(value.trim().length, `value of ${JSON.stringify(key)}`).toBeGreaterThan(0);
    }
  });

  it('keeps placeholders intact', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const [key, value] of Object.entries(DE_UI)) expect(vars(value), key).toEqual(vars(key));
  });

  it('is used for German and not for English', () => {
    expect(translate('de', 'Try a sample')).toBe('Beispiel ausprobieren');
    expect(translate('en', 'Try a sample')).toBe('Try a sample');
  });
});
