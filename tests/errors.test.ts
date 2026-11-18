import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { TECHNICAL_ERROR, isTechnicalError, userMessage } from '../src/lib/errors';
import { translate } from '../src/lib/i18n';

describe('error messages for people', () => {
  it('passes on PDF-Xploder’s own messages', () => {
    for (const m of ['A document must keep at least one page.', 'Wrong certificate password.', 'No form field named “Name”.', 'Page 3 does not exist.']) {
      expect(userMessage(new Error(m))).toBe(m);
    }
  });

  it('replaces library and runtime errors by a plain message', async () => {
    const cases: unknown[] = [
      new Error('Expected instance of M or be, but got instance of undefined'),
      new Error('PDF/A-1 forbids object and cross-reference streams. Save with useObjectStreams: false (the default for PDF/A-1).'),
      new TypeError('Cannot read properties of undefined (reading "get")'),
      Object.assign(new Error('x.y is weird'), { name: 'RangeError' }),
      new Error(''),
    ];
    // A real pdf-lib error, too.
    cases.push(await PDFDocument.load(new Uint8Array([1, 2, 3])).catch((e) => e));
    for (const e of cases) {
      expect(isTechnicalError(e), String(e)).toBe(true);
      expect(userMessage(e)).toBe(TECHNICAL_ERROR);
    }
  });

  it('has a German translation', () => {
    expect(translate('de', TECHNICAL_ERROR)).not.toBe(TECHNICAL_ERROR);
  });
});
