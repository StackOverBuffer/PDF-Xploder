/**
 * Where the OCR engine comes from. tesseract.js itself is bundled (and loaded
 * lazily); its worker script, WebAssembly core and language data are fetched
 * from jsDelivr with pinned versions. Everything is configurable here, e.g. to
 * self-host the files or to serve them from node_modules in tests.
 */

export const TESSERACT_VERSION = '7.0.0';
export const TESSERACT_CORE_VERSION = '7.0.0';
export const TESSDATA_VERSION = '1.0.0';

export interface OcrPaths {
  /** tesseract.js worker script. */
  workerUrl: string;
  /** Directory with the tesseract-core*.wasm.js variants (SIMD is picked automatically). */
  coreUrl: string;
  /** URL of the gzipped LSTM ("best_int") traineddata of a language. */
  langUrl: (lang: string) => string;
}

const CDN = 'https://cdn.jsdelivr.net/npm';

export const DEFAULT_PATHS: OcrPaths = {
  workerUrl: `${CDN}/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`,
  coreUrl: `${CDN}/tesseract.js-core@${TESSERACT_CORE_VERSION}`,
  langUrl: (lang) => `${CDN}/@tesseract.js-data/${lang}@${TESSDATA_VERSION}/4.0.0_best_int/${lang}.traineddata.gz`,
};

let paths: OcrPaths = DEFAULT_PATHS;

export const ocrPaths = () => paths;

/** Override some or all locations (tests, self-hosting). */
export function setOcrPaths(p: Partial<OcrPaths>) {
  paths = { ...paths, ...p };
}

/** Languages offered in the dialog (tesseract codes). */
export const OCR_LANGUAGES: { code: string; label: string }[] = [
  { code: 'deu', label: 'German' },
  { code: 'eng', label: 'English' },
  { code: 'fra', label: 'French' },
  { code: 'ita', label: 'Italian' },
  { code: 'spa', label: 'Spanish' },
  { code: 'nld', label: 'Dutch' },
  { code: 'pol', label: 'Polish' },
];

export const DEFAULT_THREADS = () => Math.max(1, Math.min(typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2, 4));
