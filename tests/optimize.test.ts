import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFHexString, PDFArray, PDFNumber, type PDFPage } from '@cantoo/pdf-lib';
import { imageDisplaySizes, mergeDuplicateStreams, optimizeDocument, unpredict, type ImageCodec, type ImageSource } from '../src/lib/optimize';

const N = PDFName.of;

/** A stand-in for the canvas: "JPEGs" of a tenth of a byte per pixel, and a record of what was asked. */
function fakeCodec() {
  const calls: { src: ImageSource; width: number; height: number; quality: number }[] = [];
  const codec: ImageCodec = {
    async encodeJpeg(src, width, height, quality) {
      calls.push({ src, width, height, quality });
      const out = new Uint8Array(Math.max(16, Math.round((width * height) / 10)));
      out.set([0xff, 0xd8, 0xff]);
      return out;
    },
  };
  return { codec, calls };
}

/** Noisy RGB pixels (so Flate cannot shrink them much, like a photo). */
function photo(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 3);
  let seed = 7;
  for (let i = 0; i < px.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    px[i] = seed >> 16;
  }
  return px;
}

function addImage(doc: PDFDocument, pixels: Uint8Array, w: number, h: number, extra: Record<string, unknown> = {}): PDFRef {
  return doc.context.register(
    doc.context.flateStream(pixels, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, ...extra }),
  );
}

/** Show images on a page with an uncompressed content stream: [name, ref, size in points]. */
function showImages(page: PDFPage, imgs: [PDFRef, number][]): PDFName[] {
  const names = imgs.map(([ref], i) => page.node.newXObject(`Im${i}`, ref));
  const ops = imgs.map(([, size], i) => `q ${size} 0 0 ${size} ${20 + i * 10} 20 cm ${names[i].asString()} Do Q`);
  page.node.set(N('Contents'), page.doc.context.register(page.doc.context.stream(ops.join('\n') + '\n'.repeat(200))));
  return names;
}

describe('imageDisplaySizes', () => {
  it('finds the largest size each image is shown at, also inside forms', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 600]);
    const img = addImage(doc, photo(20, 20), 20, 20);
    const form = doc.context.register(
      doc.context.stream('q 50 0 0 25 0 0 cm /I Do Q', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 100], Matrix: [2, 0, 0, 2, 0, 0], Resources: { XObject: { I: img } } }),
    );
    const f = page.node.newXObject('F', form).asString();
    const i = page.node.newXObject('I', img).asString();
    page.node.set(N('Contents'), doc.context.register(doc.context.stream(`q 30 0 0 30 0 0 cm ${i} Do Q ${f} Do`)));
    const sizes = imageDisplaySizes(doc);
    expect(sizes.get(img.toString())).toEqual({ w: 100, h: 50 });
  });
});

describe('unpredict', () => {
  it('undoes PNG Sub and Up filters', () => {
    // Two rows of three gray pixels: [10 20 30] with Sub, then [11 21 31] with Up.
    const data = new Uint8Array([1, 10, 10, 10, 2, 1, 1, 1]);
    expect([...unpredict(data, 3, 1, 8)!]).toEqual([10, 20, 30, 11, 21, 31]);
  });
});

describe('mergeDuplicateStreams', () => {
  it('stores identical streams once and points every user at the copy kept', async () => {
    const doc = await PDFDocument.create();
    const px = photo(30, 30);
    const a = addImage(doc, px, 30, 30);
    const b = addImage(doc, px, 30, 30);
    const p1 = doc.addPage();
    const p2 = doc.addPage();
    showImages(p1, [[a, 100]]);
    showImages(p2, [[b, 100]]);
    expect(mergeDuplicateStreams(doc)).toBe(1);
    const xo = (p: PDFPage) => p.node.Resources()!.lookup(N('XObject'), PDFDict).values()[0];
    expect(xo(p1)).toBe(xo(p2));
    expect(doc.context.lookup(b)).toBeUndefined();
  });
});

describe('optimizeDocument', () => {
  async function sample() {
    const doc = await PDFDocument.create();
    doc.setAuthor('Someone');
    doc.setTitle('Report');
    const big = addImage(doc, photo(600, 600), 600, 600); // shown at 100 pt: 432 ppi
    const small = addImage(doc, photo(150, 150), 150, 150); // shown at 150 pt: 72 ppi
    const page = doc.addPage([600, 600]);
    const names = showImages(page, [[big, 100], [small, 150]]);
    page.node.set(N('Thumb'), addImage(doc, photo(10, 10), 10, 10));
    page.node.set(N('PieceInfo'), doc.context.obj({ Illustrator: { Private: 'x' } }));
    return { doc, names };
  }

  it('downsamples images above the limit and recompresses the others', async () => {
    const { doc, names } = await sample();
    const { codec, calls } = fakeCodec();
    const { bytes, report } = await optimizeDocument(doc, { jpegQuality: 0.7, maxDpi: 150 }, codec, { before: 2e6 });
    expect(report.imagesRecompressed).toBe(2);
    expect(report.imagesDownsampled).toBe(1);
    const big = calls.find((c) => c.src.width === 600)!;
    expect(big.width).toBe(208); // 600 px × 150 / 432
    expect(big.quality).toBe(0.7);
    expect(calls.find((c) => c.src.width === 150)!.width).toBe(150);

    const out = await PDFDocument.load(bytes);
    const res = out.getPage(0).node.Resources()!.lookup(N('XObject'), PDFDict);
    const im = res.lookup(names[0]) as PDFRawStream;
    expect(im.dict.lookup(N('Filter'))).toBe(N('DCTDecode'));
    expect(im.dict.lookup(N('Width'), PDFNumber).asNumber()).toBe(208);
    expect(im.dict.lookup(N('ColorSpace'))).toBe(N('DeviceRGB'));
    expect(im.dict.has(N('DecodeParms'))).toBe(false);
    expect(report.after).toBe(bytes.length);
  });

  it('keeps an image when the new encoding is not smaller', async () => {
    const doc = await PDFDocument.create();
    // Flat colour: Flate makes it tiny, a JPEG would be bigger.
    const flat = addImage(doc, new Uint8Array(300 * 300 * 3).fill(200), 300, 300);
    showImages(doc.addPage(), [[flat, 300]]);
    const { codec } = fakeCodec();
    const { report } = await optimizeDocument(doc, { jpegQuality: 0.7 }, codec);
    expect(report.imagesRecompressed).toBe(0);
    expect(report.imagesKept).toBe(1);
  });

  it('leaves soft masks, 1-bit scans, CMYK and colour-key masked images lossless', async () => {
    const doc = await PDFDocument.create();
    const mask = doc.context.register(doc.context.flateStream(photo(100, 100).slice(0, 100 * 100), { Type: 'XObject', Subtype: 'Image', Width: 100, Height: 100, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
    const withMask = addImage(doc, photo(100, 100), 100, 100, { SMask: mask });
    const bw = doc.context.register(doc.context.flateStream(photo(100, 100).slice(0, 13 * 100), { Type: 'XObject', Subtype: 'Image', Width: 100, Height: 100, ColorSpace: 'DeviceGray', BitsPerComponent: 1 }));
    const cmyk = doc.context.register(doc.context.flateStream(photo(100, 133), { Type: 'XObject', Subtype: 'Image', Width: 100, Height: 100, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8 }));
    const keyed = addImage(doc, photo(100, 100), 100, 100, { Mask: [0, 10, 0, 10, 0, 10] });
    showImages(doc.addPage(), [[withMask, 50], [bw, 50], [cmyk, 50], [keyed, 50]]);
    const { codec, calls } = fakeCodec();
    const { report } = await optimizeDocument(doc, { jpegQuality: 0.7 }, codec);
    expect(calls.map((c) => c.src.width * 1000 + c.src.height)).toEqual([100100]); // only the masked image's colours
    expect(report.imagesRecompressed).toBe(1);
    const out = await PDFDocument.load((await optimizeDocument(await PDFDocument.load(await doc.save()), {}, codec)).bytes);
    expect(out.getPageCount()).toBe(1);
  });

  it('hands CMYK images to the renderer when asked, but never 1-bit scans', async () => {
    const doc = await PDFDocument.create();
    const cmyk = doc.context.register(doc.context.flateStream(photo(100, 133), { Type: 'XObject', Subtype: 'Image', Width: 100, Height: 100, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8 }));
    const bw = doc.context.register(doc.context.flateStream(photo(100, 100).slice(0, 13 * 100), { Type: 'XObject', Subtype: 'Image', Width: 100, Height: 100, ColorSpace: 'DeviceGray', BitsPerComponent: 1 }));
    showImages(doc.addPage(), [[cmyk, 50], [bw, 50]]);
    const { codec, calls } = fakeCodec();
    const { bytes, report } = await optimizeDocument(doc, { jpegQuality: 0.7, convertOtherImages: true }, codec);
    expect(calls).toHaveLength(1);
    const src = calls[0].src as { pdf: Uint8Array; width: number };
    expect(src.width).toBe(100);
    // The one-page PDF holds the CMYK image on a 100 × 100 pt page.
    const iso = await PDFDocument.load(src.pdf);
    expect(iso.getPage(0).getSize()).toEqual({ width: 100, height: 100 });
    expect(report.imagesRecompressed).toBe(1);
    const out = await PDFDocument.load(bytes);
    const img = out.context.lookup(cmyk) as PDFRawStream;
    expect(img.dict.lookup(N('ColorSpace'))).toBe(N('DeviceRGB'));
  });

  it('turns palette images into RGB', async () => {
    const doc = await PDFDocument.create();
    const palette = PDFHexString.of('ff0000' + '00ff00' + '0000ff');
    const idx = new Uint8Array(100 * 100).map((_, i) => i % 3);
    const ref = doc.context.register(
      doc.context.flateStream(idx, { Type: 'XObject', Subtype: 'Image', Width: 100, Height: 100, BitsPerComponent: 8 }),
    );
    (doc.context.lookup(ref) as PDFRawStream).dict.set(N('ColorSpace'), doc.context.obj([N('Indexed'), N('DeviceRGB'), 2, palette]) as PDFArray);
    showImages(doc.addPage(), [[ref, 100]]);
    const { codec, calls } = fakeCodec();
    // A generous fake encoder: the palette image only has to be read correctly here.
    codec.encodeJpeg = async (src, w, h, q) => {
      calls.push({ src, width: w, height: h, quality: q });
      return new Uint8Array([0xff, 0xd8, 0xff]);
    };
    await optimizeDocument(doc, { jpegQuality: 0.7 }, codec);
    const src = calls[0].src as { rgb: Uint8Array };
    expect([...src.rgb.slice(0, 9)]).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255]);
  });

  it('removes thumbnails, private data and metadata but keeps the title', async () => {
    const { doc } = await sample();
    const { codec } = fakeCodec();
    const { bytes, report } = await optimizeDocument(doc, { removeMetadata: true, removeThumbnails: true, compressStreams: true }, codec);
    expect(report.metadataRemoved).toBe(true);
    expect(report.streamsCompressed).toBeGreaterThan(0);
    const out = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(out.getTitle()).toBe('Report');
    expect(out.getAuthor()).toBeUndefined();
    expect(out.getPage(0).node.has(N('Thumb'))).toBe(false);
    expect(out.getPage(0).node.has(N('PieceInfo'))).toBe(false);
    // The content stream was stored uncompressed and is now Flate-compressed.
    expect((out.getPage(0).node.lookup(N('Contents')) as PDFRawStream).dict.lookup(N('Filter'))).toBe(N('FlateDecode'));
  });

  it('keeps the metadata of PDF/A files', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" pdfaid:part="2" pdfaid:conformance="B"/></rdf:RDF></x:xmpmeta>';
    doc.catalog.set(N('Metadata'), doc.context.register(doc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' })));
    const { codec } = fakeCodec();
    const { bytes, report } = await optimizeDocument(doc, { removeMetadata: true, compressStreams: true }, codec);
    expect(report.keptForPdfA).toBe(true);
    const out = await PDFDocument.load(bytes);
    const meta = out.catalog.lookup(N('Metadata')) as PDFRawStream;
    // Still readable without decoding, as PDF/A wants.
    expect(meta.dict.has(N('Filter'))).toBe(false);
  });
});
