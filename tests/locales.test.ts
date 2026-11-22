import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import DE_UI from '../src/locales/de/ui';
import DE from '../src/locales/de';
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

describe('every translated string has a German entry', () => {
  // Tooltip titles are plain English literals; Btn and ToolBtn translate them themselves
  // (ribbonParts). tr/tf in these lib files localise at the throw, so each key must be in
  // the German tables, or the UI shows English.
  const sources: [file: string, re: RegExp][] = [
    ['src/components/Ribbon.tsx', /\btitle="([^"]+)"/g],
    ['src/components/Ribbon.tsx', /\bt\('([^']+)'/g],
    ['src/lib/pageTree.ts', /\b(?:tr|tf)\('([^']+)'/g],
    ['src/lib/signature.ts', /\b(?:tr|tf)\('([^']+)'/g],
    ['src/lib/pdfOps.ts', /\b(?:tr|tf)\('([^']+)'/g],
  ];
  for (const [file, re] of sources) {
    it(file, () => {
      const keys = [...readFileSync(file, 'utf8').matchAll(re)].map((m) => m[1]);
      expect(keys.length, `scan found nothing in ${file}`).toBeGreaterThan(0);
      for (const key of keys) {
        expect(key, key).toBe(key.trim());
        expect(DE[key], key).toBeTypeOf('string');
        expect(DE[key].length, key).toBeGreaterThan(0);
      }
    });
  }
});
