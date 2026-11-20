/**
 * Bundle budget: builds the app (into .perf/dist) and checks what a visitor downloads
 * before the start page can show, against scripts/perf/budget.json.
 *
 *   npm run perf:bundle
 *
 * "Initial" is index.html's entry script with everything it imports statically
 * (the modulepreload links), plus the stylesheet. Features that load on demand
 * (dialogs, OCR, signatures, fonts, Markdown import…) are dynamic imports and do
 * not count, unless a static import pulls them into the initial chunks: the modules
 * listed under lazyOnly must never be there. Writes .perf/bundle.json for startup.ts
 * and a table for the CI job summary.
 */
import { build, type Plugin } from 'vite';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

interface Budget {
  initial: { jsGzipKB: number; cssGzipKB: number };
  lazyOnly: string[];
}

export interface BundleReport {
  /** Chunk file (assets/…) → the source modules in it, relative to the repository. */
  chunks: Record<string, { modules: string[]; isEntry: boolean }>;
  initial: string[];
  jsGzip: number;
  jsRaw: number;
  cssGzip: number;
}

const root = resolve('.');
const outDir = resolve('.perf/dist');
const budget: Budget = JSON.parse(readFileSync(resolve('scripts/perf/budget.json'), 'utf8'));
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const rel = (id: string) => id.replace(/\0/g, '').replace(root + '/', '').replace(/\?.*$/, '');

type ChunkInfo = { imports: string[]; modules: { id: string; size: number; url: boolean }[]; isEntry: boolean };
const chunks: Record<string, ChunkInfo> = {};
const collect: Plugin = {
  name: 'perf-collect',
  generateBundle(_o, bundle) {
    for (const [file, c] of Object.entries(bundle)) {
      if (c.type !== 'chunk') continue;
      chunks[file] = {
        imports: c.imports,
        isEntry: c.isEntry,
        modules: Object.entries(c.modules).map(([id, m]) => ({ id: rel(id), size: m.renderedLength, url: /[?&]url\b|\.wasm$/.test(id) })),
      };
    }
  },
};

// vite-node runs scripts in development mode: build as `npm run build` does.
process.env.NODE_ENV = 'production';
await build({ root, mode: 'production', logLevel: 'error', build: { outDir, emptyOutDir: true }, plugins: [collect] });

// The entry chunk and its static imports, transitively: what the browser fetches before running the app.
const html = readFileSync(join(outDir, 'index.html'), 'utf8');
const entry = Object.keys(chunks).find((f) => chunks[f].isEntry && html.includes(f));
if (!entry) throw new Error('No entry chunk found in index.html');
const initial = new Set<string>();
const visit = (f: string) => {
  if (initial.has(f) || !chunks[f]) return;
  initial.add(f);
  chunks[f].imports.forEach(visit);
};
visit(entry);
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="[^"]*?(assets\/[^"]+\.css)"/g)].map((m) => m[1]);

const size = (f: string) => {
  const bytes = readFileSync(join(outDir, f));
  return { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
};
const rows = [...initial].map((f) => ({ f, ...size(f) })).sort((a, b) => b.gzip - a.gzip);
const jsGzip = rows.reduce((s, r) => s + r.gzip, 0);
const jsRaw = rows.reduce((s, r) => s + r.raw, 0);
const cssGzip = css.reduce((s, f) => s + size(f).gzip, 0);

// Modules that belong in on-demand chunks only.
const leaks: string[] = [];
for (const f of initial) {
  for (const m of chunks[f].modules) {
    // A file's URL (`?url`, wasm) is a short string: the file itself is fetched when used.
    if (m.url) continue;
    const rule = budget.lazyOnly.find((p) => m.id.includes(p));
    if (rule) leaks.push(`${m.id} (${kb(m.size)}, matches "${rule}") is in ${f}`);
  }
}

const failures: string[] = [];
if (jsGzip > budget.initial.jsGzipKB * 1024) failures.push(`Initial JavaScript is ${kb(jsGzip)} gzipped, over the budget of ${budget.initial.jsGzipKB} KB.`);
if (cssGzip > budget.initial.cssGzipKB * 1024) failures.push(`Initial CSS is ${kb(cssGzip)} gzipped, over the budget of ${budget.initial.cssGzipKB} KB.`);
for (const l of leaks) failures.push(`Loaded at startup but should load on demand: ${l}`);

// The biggest source modules in the initial chunks: where to look when the budget is hit.
const top = [...initial]
  .flatMap((f) => chunks[f].modules.map((m) => ({ ...m, f })))
  .map((m) => ({ ...m, id: m.id.includes('node_modules/') ? m.id.replace(/^.*node_modules\/((@[^/]+\/)?[^/]+).*$/, '$1 (package)') : m.id }))
  .reduce((acc, m) => acc.set(m.id, (acc.get(m.id) ?? 0) + m.size), new Map<string, number>());
const topRows = [...top].sort((a, b) => b[1] - a[1]).slice(0, 15);

const summary = [
  '## Bundle budget',
  '',
  `| | Gzipped | Budget |`,
  `|---|---:|---:|`,
  `| Initial JavaScript (${initial.size} files, ${kb(jsRaw)} unpacked) | ${kb(jsGzip)} | ${budget.initial.jsGzipKB} KB |`,
  `| Initial CSS | ${kb(cssGzip)} | ${budget.initial.cssGzipKB} KB |`,
  '',
  '| Initial file | Gzipped | Unpacked |',
  '|---|---:|---:|',
  ...rows.map((r) => `| ${r.f} | ${kb(r.gzip)} | ${kb(r.raw)} |`),
  '',
  '<details><summary>Biggest modules loaded at startup (before minifying)</summary>',
  '',
  '| Module | Size |',
  '|---|---:|',
  ...topRows.map(([id, s]) => `| ${id} | ${kb(s)} |`),
  '',
  '</details>',
  '',
  failures.length ? failures.map((f) => `- ❌ ${f}`).join('\n') : '✅ Within budget, and no on-demand feature is loaded at startup.',
  '',
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');

const report: BundleReport = {
  chunks: Object.fromEntries(Object.entries(chunks).map(([f, c]) => [f, { modules: c.modules.map((m) => m.id), isEntry: c.isEntry }])),
  initial: [...initial],
  jsGzip,
  jsRaw,
  cssGzip,
};
mkdirSync(resolve('.perf'), { recursive: true });
writeFileSync(resolve('.perf/bundle.json'), JSON.stringify(report, null, 1));

if (failures.length) {
  console.error(
    '\nTo fix: load the feature with a dynamic import() (see src/components/Dialogs.tsx for dialogs, src/lib/fonts.ts for libraries),' +
      '\nor, if the growth is intended, raise the budget in scripts/perf/budget.json in the same pull request and say why.',
  );
  process.exit(1);
}
