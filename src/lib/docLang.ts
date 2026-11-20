/**
 * The open document's language (/Lang), for the `lang` of text being typed into it:
 * the browser underlines spelling mistakes with that language's dictionary.
 */
import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import type { PDFDocumentProxy } from './pdfjs';

const langs = new WeakMap<PDFDocumentProxy, Promise<string | undefined>>();

export function documentLang(pdf: PDFDocumentProxy): Promise<string | undefined> {
  let p = langs.get(pdf);
  if (!p) {
    p = pdf
      .getMetadata()
      .then((m) => {
        const l = (m.info as { Language?: unknown } | undefined)?.Language;
        return typeof l === 'string' && /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i.test(l.trim()) ? l.trim() : undefined;
      })
      .catch(() => undefined);
    langs.set(pdf, p);
  }
  return p;
}

/** The document's language tag, or undefined (the browser then uses its own). */
export function useDocLang(): string | undefined {
  const pdf = useStore((s) => s.pdf);
  const [lang, setLang] = useState<string | undefined>();
  useEffect(() => {
    setLang(undefined);
    if (!pdf) return;
    let live = true;
    void documentLang(pdf).then((l) => live && setLang(l));
    return () => {
      live = false;
    };
  }, [pdf]);
  return lang;
}
