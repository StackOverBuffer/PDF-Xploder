/**
 * Interface language. English strings are the keys; other languages map them
 * to translations and fall back to English for anything missing.
 */
import { create } from 'zustand';
export type Lang = 'en' | 'de';

/** Translations, loaded on demand: English users never download the German tables. */
const TABLES: Record<Lang, Record<string, string>> = { en: {}, de: {} };
let germanLoad: Promise<void> | null = null;

/** Make a language's strings available (resolves at once for English). */
export function loadLanguage(lang: Lang): Promise<void> {
  if (lang === 'en') return Promise.resolve();
  germanLoad ??= import('../locales/de').then((m) => {
    TABLES.de = m.default;
  });
  return germanLoad;
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('awesome-pdf.lang');
    if (saved === 'en' || saved === 'de') return saved;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export const useLang = create<{ lang: Lang; setLang(l: Lang): void }>()((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    try {
      localStorage.setItem('awesome-pdf.lang', lang);
    } catch {
      /* storage unavailable */
    }
    loadLanguage(lang).then(() => set({ lang }));
  },
}));

export function translate(lang: Lang, s: string): string {
  return TABLES[lang][s] ?? s;
}

/** Translate outside React (store messages, prompts); components should prefer useT(). */
export function tr(s: string): string {
  return translate(useLang.getState().lang, s);
}

/** Translate (outside React, like tr) and fill `{name}` placeholders: tf('Page {n}', { n: 3 }). */
export function tf(s: string, vars: Record<string, string | number>): string {
  return tr(s).replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Translation function for the current interface language. */
export function useT(): (s: string) => string {
  const lang = useLang((l) => l.lang);
  return (s) => translate(lang, s);
}

/** Format a zoom factor the way the language writes percentages. */
export function formatPercent(lang: Lang, scale: number): string {
  return `${(scale * 100).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: 2 })}%`;
}

/** Parse a typed zoom level ("150", "158,14 %", "75.5%") into a scale; null if invalid. */
export function parsePercent(text: string): number | null {
  const n = Number(text.replace('%', '').trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n / 100 : null;
}
