import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { PDFArray, PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { createSampleDocument } from '../src/lib/sample';
import { SAMPLE_TEXT } from '../src/lib/sampleText';
import { getFormFields } from '../src/lib/forms';
import { readOutline } from '../src/lib/outline';
import { listAttachments } from '../src/lib/attachments';
import { importForEditing } from '../src/lib/pdfOps';
import { findImages } from '../src/lib/extractImages';

const fromDisk = async (name: string) => new Uint8Array(await readFile(`public/sample/${name}`));

describe.each(['en', 'de'] as const)('sample document (%s)', (lang) => {
  const t = SAMPLE_TEXT[lang];
  let cached: Uint8Array | undefined;
  const sample = async () => {
    cached ??= await createSampleDocument(lang, fromDisk);
    // SAMPLE_OUT=dir writes the files for a look (e.g. pdftoppm -r 60 dir/sample-en.pdf).
    if (process.env.SAMPLE_OUT) await writeFile(`${process.env.SAMPLE_OUT}/sample-${lang}.pdf`, cached);
    return cached;
  };

  it('has seven pages, the plan in landscape', async () => {
    const doc = await PDFDocument.load(await sample());
    expect(doc.getPageCount()).toBe(7);
    const sizes = doc.getPages().map((p) => p.getWidth() > p.getHeight());
    expect(sizes).toEqual([false, false, false, false, true, false, false]);
    expect(doc.getTitle()).toBe(t.docTitle);
  });

  it('has a form with every common field kind', async () => {
    const fields = await getFormFields(await sample());
    const kinds = new Set(fields.map((f) => f.kind));
    expect([...kinds].sort()).toEqual(['checkbox', 'dropdown', 'radio', 'text']);
    expect(fields.find((f) => f.name === t.fields.name)).toMatchObject({ kind: 'text', value: 'Ines Albrecht' });
    expect(fields.find((f) => f.name === t.fields.bike)).toMatchObject({ value: t.fields.bikes[1] });
    expect(fields.every((f) => f.widgets.every((w) => w.page === 3))).toBe(true);
  });

  it('opens with the comments, replies and the measurement as editable annotations', async () => {
    const { annotations } = await importForEditing(await sample());
    const byPage = annotations.map((list) => list.map((a) => a.type));
    expect(byPage[1].sort()).toEqual(['highlight', 'note']);
    expect(byPage[2]).toEqual(['cloud']);
    expect(byPage[4]).toEqual(['line']);
    const highlight = annotations[1].find((a) => a.type === 'highlight')!;
    expect(highlight.comment).toBe(t.comments.highlight);
    expect(annotations[2][0].replies?.map((r) => r.author)).toEqual(['Theo Brandner']);
    expect(highlight.type === 'highlight' && highlight.rects.length).toBeGreaterThan(0);
    const measure = annotations[4][0];
    expect(measure.type === 'line' && measure.measure?.scale.label).toBe('1:50');
  });

  it('has nested bookmarks, an attachment and the scanned receipt as an image', async () => {
    const bytes = await sample();
    const outline = await readOutline(bytes);
    expect(outline.map((n) => n.title)).toEqual([t.outline.start, t.outline.order, t.outline.plan, t.outline.receipt, t.outline.record]);
    expect(outline[1].children.map((n) => n.page)).toEqual([1, 2, 3]);
    expect((await listAttachments(bytes)).map((a) => a.mimeType)).toEqual(['text/csv']);
    const images = await findImages(await PDFDocument.load(bytes));
    expect(images.length).toBe(1);
  });

  it('is saved like the files the app writes: /ID, the app as producer, form /DA and /DR', async () => {
    // Signing a sample that was never edited signs these bytes as they are.
    const doc = await PDFDocument.load(await sample(), { updateMetadata: false });
    expect(doc.getProducer()).toBe('PDF-Xploder');
    expect(doc.getCreator()).toBe('PDF-Xploder');
    expect(doc.context.lookup(doc.context.trailerInfo.ID, PDFArray).size()).toBe(2);
    const acro = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    expect(acro.lookup(PDFName.of('DA'))).toBeDefined();
    const fonts = acro.lookup(PDFName.of('DR'), PDFDict).lookup(PDFName.of('Font'), PDFDict);
    for (const f of doc.getForm().getFields()) {
      const da = f.acroField.dict.lookup(PDFName.of('DA'));
      const name = da && /\/([^\s/]+)\s+[\d.]+\s+Tf/.exec(da.toString())?.[1];
      if (name) expect(fonts.has(PDFName.of(name)), `${f.getName()} /DA font ${name}`).toBe(true);
    }
  });

  it('keeps clear of the usual tells of generated text', () => {
    const all = JSON.stringify(t) + t.vat(1) + t.pageOf(1, 7);
    expect(all).not.toMatch(/—|–|lorem|ipsum|seamless|robust|cutting-edge|unlock|elevate|delve|tapestry|nahtlos|[\u{1F300}-\u{1FAFF}]/iu);
  });
});
