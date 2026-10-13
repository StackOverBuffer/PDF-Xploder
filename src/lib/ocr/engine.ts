/**
 * The OCR engine: tesseract.js (loaded on demand) with a scheduler spreading
 * jobs over several workers, each a WebAssembly Tesseract with the LSTM model.
 */
import type Tesseract from 'tesseract.js';
import { ocrPaths } from './config';
import type { OcrLine, OcrPage, OcrWord } from './types';

export type ImageInput = Tesseract.ImageLike;

export interface OcrEngine {
  /** Recognise an image; `onProgress` gets 0–1 while Tesseract works on it. */
  recognize(image: ImageInput, onProgress?: (p: number) => void): Promise<OcrPage>;
  terminate(): Promise<void>;
}

export interface EngineOptions {
  langs: string[];
  threads: number;
  /** Resolution hint for Tesseract. */
  dpi: number;
  /** Load progress (downloading data, starting workers), 0–1. */
  onLoad?: (status: string, progress: number) => void;
  /**
   * Directory holding <lang>.traineddata.gz, read by tesseract.js itself
   * (node tests). Without it the data is fetched once from `ocrPaths().langUrl`
   * and handed to every worker.
   */
  langPath?: string;
}

const loadTesseract = async (): Promise<typeof Tesseract> => {
  const m = (await import('tesseract.js')) as unknown as { default?: typeof Tesseract } & typeof Tesseract;
  return m.default ?? m;
};

const langData = new Map<string, Promise<Uint8Array>>();

/** Fetch (and keep) a language's traineddata. */
function fetchLang(code: string): Promise<Uint8Array> {
  let p = langData.get(code);
  if (!p) {
    p = fetch(ocrPaths().langUrl(code)).then(async (r) => {
      if (!r.ok) throw new Error(`Could not load OCR language data “${code}” (HTTP ${r.status})`);
      return new Uint8Array(await r.arrayBuffer());
    });
    p.catch(() => langData.delete(code));
    langData.set(code, p);
  }
  return p;
}

let wrapperUrl: string | null = null;

/**
 * Worker script that loads tesseract.js's worker. tesseract.js 7 passes a
 * language object's data where its code belongs when initialising, so the
 * wrapper replaces language objects by their codes in that one message.
 */
function workerUrl(): string {
  if (!wrapperUrl) {
    const src = `
const add = self.addEventListener.bind(self);
self.addEventListener = (type, fn, opts) => add(type, type !== 'message' ? fn : (e) => {
  const d = e.data;
  if (d && d.action === 'initialize' && d.payload && Array.isArray(d.payload.langs))
    return fn({ data: { ...d, payload: { ...d.payload, langs: d.payload.langs.map((l) => (typeof l === 'string' ? l : l.code)).join('+') } } });
  return fn(e);
}, opts);
importScripts(${JSON.stringify(ocrPaths().workerUrl)});`;
    wrapperUrl = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
  }
  return wrapperUrl;
}

/** Flatten Tesseract's block tree into lines of words. */
export function toOcrPage(data: Tesseract.Page, width: number, height: number): OcrPage {
  const lines: OcrLine[] = [];
  let sum = 0;
  let n = 0;
  for (const block of data.blocks ?? [])
    for (const para of block.paragraphs)
      for (const line of para.lines) {
        const words: OcrWord[] = line.words
          .filter((w) => w.text.trim())
          .map((w) => ({
            text: w.text.trim(),
            conf: w.confidence,
            box: { ...w.bbox },
            symbols: w.symbols.map((s) => ({ text: s.text, box: { ...s.bbox } })),
          }));
        if (!words.length) continue;
        for (const w of words) {
          sum += w.conf;
          n++;
        }
        lines.push({ box: { ...line.bbox }, baseline: { ...line.baseline }, rowHeight: line.rowAttributes?.rowHeight ?? 0, words });
      }
  return { width, height, lines, confidence: n ? sum / n : 0 };
}

const sizeOf = (image: ImageInput): { width: number; height: number } => {
  const i = image as { width?: number; height?: number };
  return { width: i.width ?? 0, height: i.height ?? 0 };
};

export async function createEngine(o: EngineOptions): Promise<OcrEngine> {
  const T = await loadTesseract();
  const paths = ocrPaths();
  o.onLoad?.('Loading OCR engine…', 0);
  let langs: string | Tesseract.Lang[] = o.langs.join('+');
  if (!o.langPath) {
    let done = 0;
    const data = await Promise.all(
      o.langs.map((code) =>
        fetchLang(code).then((d) => {
          o.onLoad?.('Loading OCR engine…', (++done / o.langs.length) * 0.5);
          return d;
        }),
      ),
    );
    langs = o.langs.map((code, i) => ({ code, data: data[i] }));
  }

  const listeners = new Map<string, (p: number) => void>();
  const logger = (m: Tesseract.LoggerMessage) => {
    if (m.status === 'recognizing text') listeners.get(m.userJobId ?? m.jobId)?.(m.progress);
  };
  const scheduler = T.createScheduler();
  const threads = Math.max(1, Math.round(o.threads));
  const workers: Tesseract.Worker[] = [];
  try {
    let started = 0;
    await Promise.all(
      Array.from({ length: threads }, async () => {
        const w = await T.createWorker(langs, T.OEM.LSTM_ONLY, {
          ...(o.langPath
            ? { langPath: o.langPath }
            : { workerPath: workerUrl(), workerBlobURL: false, corePath: paths.coreUrl }),
          cacheMethod: 'none',
          gzip: true,
          logger,
        });
        workers.push(w);
        await w.setParameters({ user_defined_dpi: String(Math.round(o.dpi)), tessedit_pageseg_mode: T.PSM.AUTO });
        scheduler.addWorker(w);
        o.onLoad?.('Loading OCR engine…', 0.5 + (++started / threads) * 0.5);
      }),
    );
  } catch (e) {
    await Promise.all(workers.map((w) => w.terminate().catch(() => undefined)));
    throw e;
  }

  let jobs = 0;
  return {
    async recognize(image, onProgress) {
      const id = `ocr-${++jobs}`;
      if (onProgress) listeners.set(id, onProgress);
      try {
        // The trailing job id is our own; the scheduler appends one that the worker ignores.
        const job = scheduler.addJob('recognize', image, {}, { blocks: true, text: false }, id);
        // A job still loading its image when the engine is terminated fails later; that is expected.
        job.catch(() => undefined);
        const r = await job;
        const { width, height } = sizeOf(image);
        return toOcrPage(r.data, width, height);
      } finally {
        listeners.delete(id);
      }
    },
    async terminate() {
      // The scheduler's terminate drops queued jobs but does not wait for its workers.
      scheduler.terminate().catch(() => undefined);
      await Promise.all(workers.map((w) => w.terminate().catch(() => undefined)));
    },
  };
}
