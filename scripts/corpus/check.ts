/**
 * One corpus file through the same steps as the app: open and draw it with pdf.js,
 * import its comments for editing, save it, open the saved file again and check it
 * with qpdf. Runs in a child process of run.ts, which kills it if a file hangs.
 */
import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { setFontSource } from '../../src/lib/fonts';
import { setSubsetWasmLoader } from '../../src/lib/subset';
import * as ops from '../../src/lib/pdfOps';
import { saveDoc } from '../../src/lib/pdfSave';
import { decrypt, inspectEncryption } from '../../src/lib/security';
import type { Annotation } from '../../src/lib/types';

/** What happened at each step. `fail` lists the problems that count against the file. */
export interface FileResult {
  file: string;
  pages?: number;
  /** pdf.js refused the file (many corpus files are broken on purpose): the app shows an error. */
  openError?: string;
  /** Needs a password the corpus does not give: only opening is checked. */
  password?: boolean;
  /** pdf-lib cannot parse it: the app opens it read-only. */
  readOnly?: string;
  annotations?: number;
  saved?: boolean;
  /** qpdf complains about the saved file, but no more than about the original. */
  qpdfInherited?: boolean;
  fail: string[];
  ms: number;
}

const require = createRequire(import.meta.url);
const pdfjsRoot = resolve(require.resolve('pdfjs-dist/package.json'), '..');
const canvas = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');

/** Pages drawn per document, and the largest canvas (pixels) a page is drawn at. */
const MAX_PAGES = Number(process.env.CORPUS_MAX_PAGES ?? Infinity);
const MAX_PIXELS = 1_000_000;

const fontFiles: Record<string, string> = {
  sans: 'public/fonts/NotoSans-Regular.ttf',
  sansBold: 'public/fonts/NotoSans-Bold.ttf',
  symbols: 'public/fonts/NotoSansSymbols2-Regular.ttf',
};
setFontSource(async (key) => (fontFiles[key] ? new Uint8Array(await readFile(fontFiles[key])) : null));
setSubsetWasmLoader(() => readFile(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')));

const short = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0].slice(0, 200);

function open(data: Uint8Array) {
  const task = pdfjs.getDocument({
    data,
    cMapUrl: `${pdfjsRoot}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${pdfjsRoot}/standard_fonts/`,
    wasmUrl: `${pdfjsRoot}/wasm/`,
    verbosity: 0,
  });
  return task;
}

/** Draw the pages (up to CORPUS_MAX_PAGES) and read their text and comments, as the viewer does. */
async function render(pdf: pdfjs.PDFDocumentProxy, fail: string[], label: string, maxPages = MAX_PAGES) {
  for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
    try {
      const page = await pdf.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, vp1.width * vp1.height)));
      const vp = page.getViewport({ scale });
      const c = canvas.createCanvas(Math.max(1, Math.ceil(vp.width)), Math.max(1, Math.ceil(vp.height)));
      await page.render({ canvas: c as unknown as HTMLCanvasElement, viewport: vp, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS }).promise;
      await page.getTextContent();
      await page.getAnnotations();
      page.cleanup();
    } catch (e) {
      fail.push(`${label} page ${n}: ${short(e)}`);
    }
  }
}

function qpdfCheck(path: string): Promise<{ code: number; out: string }> {
  return new Promise((res) =>
    execFile('qpdf', ['--check', path], { maxBuffer: 16 * 1024 * 1024, timeout: 60_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      res({ code, out: `${stderr}${stdout}`.split('\n').filter((l) => /error|warning|WARNING|ERROR/.test(l)).slice(0, 3).join(' | ').slice(0, 300) });
    }),
  );
}

export async function checkFile(path: string, file: string): Promise<FileResult> {
  const t0 = Date.now();
  const fail: string[] = [];
  const r: FileResult = { file, fail, ms: 0 };
  const bytes = new Uint8Array(await readFile(path));

  // 1. Open and draw, as the viewer does.
  let pdf: pdfjs.PDFDocumentProxy;
  try {
    pdf = await open(bytes.slice()).promise;
  } catch (e) {
    if ((e as Error)?.name === 'PasswordException') r.password = true;
    else r.openError = short(e);
    r.ms = Date.now() - t0;
    return r;
  }
  r.pages = pdf.numPages;
  await render(pdf, fail, 'render');
  await pdf.loadingTask.destroy();

  // 2. Make it editable, as opening does: decrypt files without a user password, import comments.
  let editable = bytes;
  try {
    if ((await inspectEncryption(bytes)).encrypted) editable = await decrypt(bytes, '');
  } catch (e) {
    r.readOnly = `decrypt: ${short(e)}`;
  }
  let imported: { bytes: Uint8Array; annotations: Annotation[][]; count: number } | null = null;
  if (!r.readOnly) {
    try {
      await ops.load(editable);
    } catch (e) {
      r.readOnly = short(e);
    }
  }
  if (!r.readOnly) {
    try {
      imported = await ops.importForEditing(editable);
      r.annotations = imported.count;
    } catch (e) {
      fail.push(`import: ${short(e)}`);
    }
  }
  if (!imported) {
    r.ms = Date.now() - t0;
    return r;
  }

  // 3. Save: comments written back; every file is rewritten once, as any edit does.
  let out: Uint8Array;
  try {
    out = await ops.exportWithAnnotations(imported.bytes, imported.annotations);
    if (out === imported.bytes) out = await saveDoc(await ops.load(out));
    r.saved = true;
  } catch (e) {
    fail.push(`save: ${short(e)}`);
    r.ms = Date.now() - t0;
    return r;
  }

  // 4. The saved file opens with the same pages and draws.
  try {
    const again = await open(out.slice()).promise;
    if (again.numPages !== r.pages) fail.push(`page count: ${again.numPages} after saving instead of ${r.pages}`);
    await render(again, fail, 'reopen', 3);
    await again.loadingTask.destroy();
  } catch (e) {
    fail.push(`reopen: ${short(e)}`);
  }

  // 5. qpdf finds no damage in the saved file that the original did not already have:
  // errors count if the original had none, warnings if the original was clean.
  const tmp = join(tmpdir(), `corpus-${process.pid}-${Date.now()}`);
  try {
    await writeFile(`${tmp}-out.pdf`, out);
    const saved = await qpdfCheck(`${tmp}-out.pdf`);
    if (saved.code !== 0) {
      await writeFile(`${tmp}-in.pdf`, editable);
      const orig = await qpdfCheck(`${tmp}-in.pdf`);
      const msg = saved.out.replaceAll(`${tmp}-out.pdf`, 'saved file') || `exit ${saved.code}`;
      if ((saved.code === 2 || saved.code < 0) && orig.code !== 2) fail.push(`qpdf: ${msg}`);
      else if (saved.code === 3 && orig.code === 0) fail.push(`qpdf warning: ${msg}`);
      else r.qpdfInherited = true;
    }
  } finally {
    await rm(`${tmp}-out.pdf`, { force: true });
    await rm(`${tmp}-in.pdf`, { force: true });
  }
  r.ms = Date.now() - t0;
  return r;
}

// As a child process: check the files the parent sends, one at a time.
if (process.send) {
  // A stray rejection in pdf.js or pdf-lib must not take the other files down with it.
  process.on('unhandledRejection', (e) => console.error('unhandled rejection:', short(e)));
  process.on('message', async (m: { path: string; file: string }) => {
    let res: FileResult;
    try {
      res = await checkFile(m.path, m.file);
    } catch (e) {
      res = { file: m.file, fail: [`crash: ${short(e)}`], ms: 0 };
    }
    process.send!(res);
  });
  process.send({ ready: true });
}
