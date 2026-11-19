/** Optimize / compress the whole document (File › Compress). */
import { useStore, reportProgress } from './store';
import { requirePermission } from './permissions';
import { load } from '../lib/pdfOps';
import { optimizeDocument, type ImageCodec, type ImageSource, type OptimizeOptions, type OptimizeReport } from '../lib/optimize';
import { tr } from '../lib/i18n';
import { closePdf, openPdf } from '../lib/pdfjs';

const S = () => useStore.getState();

/** Canvases can hold this many pixels in every browser (iOS Safari is the tightest). */
const MAX_PIXELS = 16e6;

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function canvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function jpegOf(c: AnyCanvas, quality: number): Promise<Uint8Array | null> {
  const blob =
    c instanceof HTMLCanvasElement
      ? await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', quality))
      : await c.convertToBlob({ type: 'image/jpeg', quality });
  return blob && blob.type === 'image/jpeg' ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** Draw an image source at the given size on a white canvas, or null if it is too big. */
async function drawSource(src: ImageSource, width: number, height: number): Promise<AnyCanvas | null> {
  if (src.width * src.height > MAX_PIXELS * 4 || width * height > MAX_PIXELS) return null;
  let source: CanvasImageSource;
  if ('pdf' in src) {
    // Formats only a PDF renderer reads (CMYK, JPEG 2000…): let pdf.js draw the image at the new size.
    const { pdf } = await openPdf(src.pdf, () => null);
    try {
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: width / src.width });
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      await page.render({ canvas: null, canvasContext: c.getContext('2d')!, viewport }).promise;
      source = c;
    } finally {
      closePdf(pdf);
    }
  } else if ('jpeg' in src) {
    source = await createImageBitmap(new Blob([src.jpeg as BlobPart], { type: 'image/jpeg' }));
  } else {
    if (src.width * src.height > MAX_PIXELS) return null;
    const rgba = new Uint8ClampedArray(src.width * src.height * 4);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgba[i] = src.rgb[j];
      rgba[i + 1] = src.rgb[j + 1];
      rgba[i + 2] = src.rgb[j + 2];
      rgba[i + 3] = 255;
    }
    const full = canvas(src.width, src.height);
    (full.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(rgba, src.width, src.height), 0, 0);
    source = full;
  }
  const out = canvas(width, height);
  const g = out.getContext('2d') as CanvasRenderingContext2D;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, width, height);
  g.drawImage(source, 0, 0, width, height);
  if ('close' in source && typeof source.close === 'function') source.close();
  return out;
}

/** Decode and encode images with the browser's canvas. */
export const canvasCodec: ImageCodec = {
  async encodeJpeg(src: ImageSource, width: number, height: number, quality: number) {
    const c = await drawSource(src, width, height);
    return c ? jpegOf(c, quality) : null;
  },
  async decodeRgb(src: ImageSource, width: number, height: number) {
    const c = await drawSource(src, width, height);
    if (!c) return null;
    const data = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, width, height).data;
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      rgb[j] = data[i];
      rgb[j + 1] = data[i + 1];
      rgb[j + 2] = data[i + 2];
    }
    return rgb;
  },
};

/** Does the file hold a digital signature? (Optimizing rewrites it, which breaks signatures.) */
export function hasSignature(bytes: Uint8Array): boolean {
  const pat = [47, 66, 121, 116, 101, 82, 97, 110, 103, 101]; // "/ByteRange"
  outer: for (let i = 0; i <= bytes.length - pat.length; i++) {
    if (bytes[i] !== 47) continue;
    for (let k = 1; k < pat.length; k++) if (bytes[i + k] !== pat[k]) continue outer;
    return true;
  }
  return false;
}

export const formatSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Optimize the open document; it is replaced only if it got smaller. */
export async function optimize(o: OptimizeOptions): Promise<OptimizeReport | undefined> {
  if (!requirePermission('modify')) return undefined;
  return S().run('Compressing document…', async () => {
    const before = S().bytes!;
    const doc = await load(before);
    const { bytes, report } = await optimizeDocument(doc, o, canvasCodec, { before: before.length, progress: reportProgress });
    if (report.after >= report.before) {
      S().notify(tr('The document is already as small as these settings make it.'));
      return report;
    }
    await S().commitBytes(bytes);
    const pct = Math.round((1 - report.after / report.before) * 100);
    S().notify(`${tr('Document compressed')}: ${formatSize(report.before)} → ${formatSize(report.after)} (−${pct}%)`, 'info', { undo: true });
    return report;
  });
}
