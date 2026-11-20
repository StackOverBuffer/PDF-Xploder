/**
 * Startup timing: serves the build from bundle.ts (.perf/dist), opens it in Chromium
 * with the CPU slowed down 4× (a mid-range laptop on battery, roughly) and measures,
 * as the median of several fresh page loads:
 *
 *   - start page: navigation until the start page's buttons are on screen,
 *   - first page: clicking "Try a sample" until its first page is drawn,
 *   - startup JavaScript: what was downloaded until the start page showed (gzipped).
 *
 * Fails when a median is over its budget in scripts/perf/budget.json, or when a chunk
 * with an on-demand module (lazyOnly) is fetched while the app starts up idle (except
 * allowedWhenIdle: the German names for the command search are fetched on purpose).
 *
 *   npm run perf:startup             (after npm run perf:bundle)
 *   PERF_RUNS=9 npm run perf:startup
 */
import { chromium, type Page } from 'playwright';
import { preview } from 'vite';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import type { BundleReport } from './bundle';

const budget: { startup: { startPageMs: number; firstPageMs: number; startupJsGzipKB: number }; lazyOnly: string[]; allowedWhenIdle: string[] } = JSON.parse(
  readFileSync(resolve('scripts/perf/budget.json'), 'utf8'),
);
const bundle: BundleReport = JSON.parse(readFileSync(resolve('.perf/bundle.json'), 'utf8'));
const RUNS = Number(process.env.PERF_RUNS ?? 5);
const CPU_SLOWDOWN = 4;
/** How long the idle app is watched for on-demand chunks after the start page shows. */
const IDLE_WATCH_MS = 4000;

const server = await preview({ root: resolve('.'), logLevel: 'error', build: { outDir: resolve('.perf/dist') }, preview: { port: 0, strictPort: false } });
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('Preview server did not start');

// A preinstalled browser (cloud sandboxes) or Playwright's own (npx playwright install chromium).
const browser = await chromium.launch(process.env.PERF_CHROMIUM ? { executablePath: process.env.PERF_CHROMIUM } : {});

interface Run { startPage: number; firstPage: number; startupJs: number; idleLazy: string[] }

const gzipCache = new Map<string, number>();
const gzipped = (file: string) => {
  if (!gzipCache.has(file)) gzipCache.set(file, existsSync(resolve('.perf/dist', file)) ? gzipSync(readFileSync(resolve('.perf/dist', file)), { level: 9 }).length : 0);
  return gzipCache.get(file)!;
};

async function measure(): Promise<Run> {
  // A fresh profile each time: no HTTP cache, no saved session, no service worker (which
  // would download the whole app for offline use and compete with the measurement).
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  const page: Page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });

  // Scripts fetched, and when. Sizes are the built files gzipped (as GitHub Pages serves
  // them; the local server sends them uncompressed).
  const scripts: { file: string; at: number }[] = [];
  page.on('response', (r) => {
    const file = new URL(r.url()).pathname.replace(/^\//, '');
    if (/\.m?js$/.test(file)) scripts.push({ file, at: Date.now() });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const t0 = Date.now();
  await page.goto(url!, { waitUntil: 'commit' });
  await page.locator('.welcome-actions button').first().waitFor({ state: 'visible', timeout: 60_000 });
  const shownAt = Date.now();
  const startPage = shownAt - t0;
  // Let in-flight downloads finish being counted, then watch the idle app.
  await page.waitForTimeout(IDLE_WATCH_MS);
  const startupJs = scripts.filter((s) => s.at <= shownAt).reduce((n, s) => n + gzipped(s.file), 0);
  const idleLazy = scripts.flatMap(({ file }) => {
    // Chunks of the initial load are bundle.ts's business.
    if (bundle.initial.includes(file)) return [];
    const mods = bundle.chunks[file]?.modules ?? [];
    const hit = mods.find((m) => budget.lazyOnly.some((p) => m.includes(p)) && !budget.allowedWhenIdle.some((p) => m.includes(p)) && !/\.wasm$/.test(m));
    return hit ? [`${file} (${hit})`] : [];
  });

  const t1 = Date.now();
  await page.getByRole('button', { name: /Try a sample/ }).click();
  await page.locator('canvas.page-canvas').first().waitFor({ state: 'attached', timeout: 60_000 });
  const firstPage = Date.now() - t1;

  await context.close();
  if (errors.length) throw new Error(`The page reported errors:\n${errors.join('\n')}`);
  return { startPage, firstPage, startupJs, idleLazy };
}

const runs: Run[] = [];
try {
  // One unmeasured load first: the server and the browser warm up.
  await measure();
  for (let i = 0; i < RUNS; i++) {
    const r = await measure();
    console.log(`run ${i + 1}: start page ${r.startPage} ms, first page ${r.firstPage} ms, startup JS ${(r.startupJs / 1024).toFixed(1)} KB`);
    runs.push(r);
  }
} finally {
  await browser.close();
  await new Promise<void>((done) => server.httpServer.close(() => done()));
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const startPage = median(runs.map((r) => r.startPage));
const firstPage = median(runs.map((r) => r.firstPage));
const startupJs = median(runs.map((r) => r.startupJs));
const idleLazy = [...new Set(runs.flatMap((r) => r.idleLazy))];

const failures: string[] = [];
if (startPage > budget.startup.startPageMs) failures.push(`The start page took ${startPage} ms to show, over the budget of ${budget.startup.startPageMs} ms.`);
if (firstPage > budget.startup.firstPageMs) failures.push(`The sample's first page took ${firstPage} ms to draw, over the budget of ${budget.startup.firstPageMs} ms.`);
if (startupJs > budget.startup.startupJsGzipKB * 1024)
  failures.push(`${(startupJs / 1024).toFixed(1)} KB of JavaScript was downloaded before the start page showed, over the budget of ${budget.startup.startupJsGzipKB} KB.`);
for (const c of idleLazy) failures.push(`An on-demand chunk was fetched while the app sat idle: ${c}`);

const summary = [
  '## Startup timing',
  '',
  `Median of ${RUNS} fresh loads, CPU slowed down ${CPU_SLOWDOWN}×, no service worker.`,
  '',
  '| | Median | Budget |',
  '|---|---:|---:|',
  `| Start page shown | ${startPage} ms | ${budget.startup.startPageMs} ms |`,
  `| Sample's first page drawn (after the click) | ${firstPage} ms | ${budget.startup.firstPageMs} ms |`,
  `| JavaScript downloaded before the start page showed | ${(startupJs / 1024).toFixed(1)} KB | ${budget.startup.startupJsGzipKB} KB |`,
  '',
  failures.length ? failures.map((f) => `- ❌ ${f}`).join('\n') : '✅ Within budget.',
  '',
].join('\n');
console.log('\n' + summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
if (failures.length) {
  console.error('If the slowdown is intended, raise the budget in scripts/perf/budget.json in the same pull request and say why.');
  process.exit(1);
}
