import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from '@cantoo/pdf-lib';
import * as ops from '../src/lib/pdfOps';

/** All decoded stream contents of a file, as text. */
async function streamText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let out = '';
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        out += new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode());
      } catch {
        /* image or unsupported filter */
      }
    }
  }
  return out;
}

async function secretDoc() {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 300]).drawText('PUBLIC', { x: 20, y: 200, font: f });
  doc.addPage([300, 300]).drawText('TOPSECRET', { x: 20, y: 200, font: f });
  return doc.save();
}
// pdf-lib writes standard-font text as hex strings.
const hex = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');

describe('saving leaves out unreachable objects', () => {
  it('a deleted page leaves nothing behind', async () => {
    const bytes = await secretDoc();
    expect(await streamText(bytes)).toContain(hex('TOPSECRET'));
    const out = await ops.deletePages(bytes, [1]);
    const text = await streamText(out);
    expect(text).toContain(hex('PUBLIC'));
    expect(text).not.toContain(hex('TOPSECRET'));
  });

  it('a redacted page keeps only its image', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
    const { bytes } = await ops.replacePagesWithImages(await secretDoc(), [{ index: 1, png }]);
    expect(await streamText(bytes)).not.toContain(hex('TOPSECRET'));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });
});
