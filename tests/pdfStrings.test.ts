import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { addBookmark, addLink } from '../src/lib/navigation';
import { readOutline } from '../src/lib/outline';
import { asciiString } from '../src/lib/pdfStrings';

async function blank(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  return doc.save();
}

describe('strings written into the file', () => {
  it('keeps bookmark titles with parentheses, backslashes and any script', async () => {
    let bytes = await blank();
    const titles = ['Kapitel 1 (Entwurf', 'Preis 5 €', '東京オフィス', 'C:\\new\\table'];
    for (const t of titles) bytes = await addBookmark(bytes, t, 0);
    expect((await readOutline(bytes)).map((n) => n.title)).toEqual(titles);
  });

  it('keeps link addresses intact, percent-encoding what URIs cannot hold', async () => {
    const bytes = await addLink(await blank(), 0, { x: 10, y: 10, w: 50, h: 20 }, { url: 'https://example.com/search?q=(draft) ü' });
    const doc = await PDFDocument.load(bytes);
    const link = doc.context.lookup(doc.getPage(0).node.Annots()!.get(0)) as PDFDict;
    const uri = (link.lookup(PDFName.of('A')) as PDFDict).lookup(PDFName.of('URI'));
    expect((uri as ReturnType<typeof asciiString>).decodeText()).toBe('https://example.com/search?q=(draft)%20%C3%BC');
  });
});
