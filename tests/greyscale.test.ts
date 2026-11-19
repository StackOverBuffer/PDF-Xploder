import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import { convertToGreyscale, greyHex, greyOf, greyOps, luma } from '../src/lib/greyscale';
import { name, parseContent, type Op, type Operand } from '../src/lib/content/syntax';
import type { ImageCodec } from '../src/lib/optimize';

const N = PDFName.of;
const text = (ops: Op[]) => ops.map((o) => `${o.args.map((a) => (typeof a === 'number' ? +a.toFixed(3) : typeof a === 'object' && a && 't' in a && a.t === 'name' ? `/${a.v}` : String(a))).join(' ')} ${o.op}`.trim());

/** Decodes "JPEGs" made by encodeJpeg below: they hold the RGB pixels after a 3-byte marker. */
const codec: ImageCodec = {
  async encodeJpeg(src) {
    if (!('rgb' in src)) return null;
    const out = new Uint8Array(src.rgb.length + 3);
    out.set([0xff, 0xd8, 0xff]);
    out.set(src.rgb, 3);
    return out;
  },
  async decodeRgb(src) {
    return 'jpeg' in src ? src.jpeg.slice(3) : null;
  },
};

describe('greyscale', () => {
  it('computes grey values for each kind of colour', () => {
    expect(greyOf('rgb', [1, 0, 0])).toBeCloseTo(0.299);
    expect(greyOf('cmyk', [0, 0, 0, 1])).toBe(0);
    expect(greyOf('cmyk', [0, 0, 0, 0])).toBeCloseTo(1);
    expect(greyOf('lab', [50, 20, -10])).toBe(0.5);
    expect(greyHex('#ff0000')).toBe('#4c4c4c');
    expect(luma(1, 1, 1)).toBeCloseTo(1);
  });

  it('rewrites device colours and colour spaces in content, following q/Q', () => {
    const ops = parseContent(new TextEncoder().encode('1 0 0 rg 0 0 1 RG q /CS0 cs 0 1 0 sc /P1 cs /Pat scn Q 0 0 0 1 k 0.5 g /DeviceCMYK CS 0 0 0 0 SC'));
    const out = greyOps(ops, (n) => (n === 'CS0' ? 'rgb' : undefined))!;
    expect(text(out)).toEqual(['0.299 g', '0.114 G', 'q', '/DeviceGray cs', '0.587 sc', '/P1 cs', '/Pat scn', 'Q', '0 g', '0.5 g', '/DeviceGray CS', '1 SC']);
    expect(greyOps(parseContent(new TextEncoder().encode('0.2 g 0 0 10 10 re f')), () => undefined)).toBeUndefined();
  });

  it('converts unfiltered inline RGB images', () => {
    const op: Op = { op: 'BI', args: [], inline: { dict: new Map<string, Operand>([['W', 2], ['H', 1], ['BPC', 8], ['CS', name('RGB')]]), data: new Uint8Array([255, 0, 0, 255, 255, 255]) } };
    const [out] = greyOps([op], () => undefined)!;
    expect([...out.inline!.data]).toEqual([76, 255]);
    expect(out.inline!.dict.get('CS')).toEqual(name('G'));
  });

  it('converts pages, forms, gradients, comment colours and images in a document', async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const page = doc.addPage([200, 200]);
    const form = ctx.register(ctx.stream('0 1 0 rg 0 0 5 5 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 5, 5] }));
    const shading = ctx.register(ctx.obj({ ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [0, 0, 100, 0], Function: { FunctionType: 2, Domain: [0, 1], C0: [1, 0, 0], C1: [0, 0, 1], N: 1 } }));
    const rgb = new Uint8Array(4 * 4 * 3).fill(0);
    for (let i = 0; i < 16; i++) rgb[i * 3] = 255; // red
    const flateImage = ctx.register(ctx.flateStream(rgb, { Type: 'XObject', Subtype: 'Image', Width: 4, Height: 4, BitsPerComponent: 8, ColorSpace: 'DeviceRGB' }));
    const jpeg = await codec.encodeJpeg({ rgb, width: 4, height: 4 }, 4, 4, 1);
    const jpegImage = ctx.register(PDFRawStream.of(ctx.obj({ Type: 'XObject', Subtype: 'Image', Width: 4, Height: 4, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode' }) as PDFDict, jpeg!));
    page.node.set(N('Resources'), ctx.obj({ XObject: { F: form, I1: flateImage, I2: jpegImage }, Shading: { S: shading } }));
    page.node.set(N('Contents'), ctx.register(ctx.stream('1 0 0 rg 0 0 10 10 re f /F Do /S sh /I1 Do /I2 Do')));
    const annot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10], C: [0, 0, 1] }));
    page.node.set(N('Annots'), ctx.obj([annot]));

    const report = await convertToGreyscale(doc, codec);
    expect(report).toEqual({ contentStreams: 2, images: 2, imagesKept: 0, shadings: 1 });
    const content = new TextDecoder().decode(decodePDFRawStream(ctx.lookup(page.node.get(N('Contents'))) as PDFRawStream).decode());
    expect(content).toMatch(/^0\.299 g/);
    const formOut = new TextDecoder().decode(decodePDFRawStream(ctx.lookup(form) as PDFRawStream).decode());
    expect(formOut).toMatch(/^0\.587 g/);
    const sh = ctx.lookup(shading) as PDFDict;
    expect(sh.lookup(N('ColorSpace'))).toBe(N('DeviceGray'));
    const fn = sh.lookup(N('Function')) as PDFDict;
    expect((fn.lookup(N('C0')) as PDFArray).asArray().map((x) => (x as PDFNumber).asNumber())).toEqual([0.299]);
    const img1 = ctx.lookup(flateImage) as PDFRawStream;
    expect(img1.dict.lookup(N('ColorSpace'))).toBe(N('DeviceGray'));
    expect([...decodePDFRawStream(img1).decode().slice(0, 2)]).toEqual([76, 76]);
    const img2 = ctx.lookup(jpegImage) as PDFRawStream;
    expect(img2.dict.lookup(N('Filter'))).toBe(N('DCTDecode'));
    expect([...img2.contents.slice(3, 6)]).toEqual([76, 76, 76]);
    expect(((ctx.lookup(annot) as PDFDict).lookup(N('C')) as PDFArray).size()).toBe(1);
    // The result still saves and loads.
    await PDFDocument.load(await doc.save());
  });
});
