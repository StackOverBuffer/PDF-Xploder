/**
 * Stamps drawn by other programs (StampAnnot.appearance) shown on screen: their
 * one-page PDF rendered by pdf.js into an image, once per drawing.
 */
import { useEffect, useState } from 'react';
import { openPdf, renderToCanvas } from './pdfjs';
import { fromBase64 } from './foreignAppearance';

/** Pixels on the longer side: sharp up to high zoom for stamp-sized drawings. */
const SIZE = 1024;
const cache = new Map<string, Promise<string>>();

function render(appearance: string): Promise<string> {
  let p = cache.get(appearance);
  if (!p) {
    p = (async () => {
      const { pdf } = await openPdf(fromBase64(appearance), () => null);
      try {
        const page = await pdf.getPage(1);
        const vp = page.getViewport({ scale: 1 });
        const canvas = await renderToCanvas(page, SIZE / Math.max(vp.width, vp.height), { transparent: true });
        const url = canvas.toDataURL('image/png');
        canvas.width = canvas.height = 0;
        return url;
      } finally {
        pdf.destroy();
      }
    })();
    p.catch(() => cache.delete(appearance));
    cache.set(appearance, p);
  }
  return p;
}

/** The drawing as an image URL, or null while it is being rendered. */
export function useAppearanceImage(appearance: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!appearance) return setUrl(null);
    let live = true;
    render(appearance).then((u) => live && setUrl(u), () => live && setUrl(null));
    return () => {
      live = false;
    };
  }, [appearance]);
  return url;
}
