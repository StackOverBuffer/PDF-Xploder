import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from '@cantoo/pdf-lib';
import { loadForEdit, repairPageTree } from '../src/lib/pageTree';
import * as ops from '../src/lib/pdfOps';

const N = PDFName.of;

/** A two-page file, then broken by `breakIt` and written without pdf-lib's checks. */
async function broken(breakIt: (doc: PDFDocument, pages: PDFRef[], tree: PDFRef) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  doc.addPage([500, 200]);
  const pages = doc.getPages().map((p) => p.ref);
  breakIt(doc, pages, doc.catalog.get(N('Pages')) as PDFRef);
  return doc.save({ useObjectStreams: false });
}

async function expectRepaired(bytes: Uint8Array, sizes: [number, number][]) {
  await expect(PDFDocument.load(bytes).then((d) => d.getPages().map((p) => p.getSize()))).rejects.toThrow();
  const doc = await loadForEdit(bytes);
  expect(doc.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual(sizes);
  // Every edit works on it and the saved file loads without repair.
  const rotated = await ops.rotatePages(bytes, [0], 90);
  const again = await PDFDocument.load(rotated);
  expect(again.getPages().map((p) => p.getRotation().angle)).toEqual([90, ...sizes.slice(1).map(() => 0)]);
  expect(repairPageTree(again)).toBe(false);
}

describe('page tree repair', () => {
  it('a catalog without /Type /Catalog', async () => {
    const bytes = await broken((doc) => doc.catalog.delete(N('Type')));
    await expectRepaired(bytes, [
      [300, 400],
      [500, 200],
    ]);
  });

  it('a page whose /Parent is not a page tree', async () => {
    const bytes = await broken((doc, pages) => doc.context.lookup(pages[1], PDFDict).set(N('Parent'), doc.context.obj({ Foo: 1 })));
    await expectRepaired(bytes, [
      [300, 400],
      [500, 200],
    ]);
  });

  it('a page without a /MediaBox anywhere gets US Letter', async () => {
    const bytes = await broken((doc, pages) => doc.context.lookup(pages[0], PDFDict).delete(N('MediaBox')));
    await expectRepaired(bytes, [
      [612, 792],
      [500, 200],
    ]);
  });

  it('a /Kids cycle keeps each page once', async () => {
    const bytes = await broken((doc, _pages, tree) => {
      // A nested tree whose kids lead back to the root.
      const inner = doc.context.register(doc.context.obj({ Type: 'Pages', Kids: [tree], Count: 2, Parent: tree }));
      const kids = doc.context.lookup(tree, PDFDict).lookup(N('Kids'), PDFArray);
      kids.push(inner);
    });
    await expectRepaired(bytes, [
      [300, 400],
      [500, 200],
    ]);
  });

  it('a file without any page cannot be loaded for editing', async () => {
    const bytes = await broken((doc, pages) => {
      for (const p of pages) doc.context.delete(p);
      doc.catalog.set(N('Pages'), doc.context.obj({ Foo: 1 }));
    });
    await expect(loadForEdit(bytes)).rejects.toThrow(/cannot be read for editing/);
  });

  it('leaves sound files alone', async () => {
    const doc = await PDFDocument.load(await broken(() => {}));
    expect(repairPageTree(doc)).toBe(false);
  });
});
