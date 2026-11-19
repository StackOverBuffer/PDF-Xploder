/**
 * Corpus test: every PDF in a folder (pdf.js's test files in CI, see fetch.sh) is opened,
 * drawn, imported for editing, saved, opened again and checked with qpdf (check.ts).
 *
 *   npm run corpus -- <folder> [--update] [--only name.pdf,…] [--jobs n]
 *
 * Problems already listed in known-issues.json are reported but do not fail the run;
 * new ones do. --update rewrites that list from this run (after fixing, or to accept a
 * known pdf.js limitation). A file that hangs or kills its process counts as a problem too.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import type { FileResult } from './check';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const update = args.includes('--update') && !!args.splice(args.indexOf('--update'), 1);
const only = flag('--only')?.split(',');
const jobs = Number(flag('--jobs') ?? Math.max(1, availableParallelism()));
const dir = resolve(args[0] ?? '.corpus/pdfs');
const TIMEOUT = Number(process.env.CORPUS_TIMEOUT ?? 120_000);
const knownPath = resolve('scripts/corpus/known-issues.json');
const here = resolve('scripts/corpus');
const viteNode = resolve('node_modules/vite-node/vite-node.mjs');

const files = readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith('.pdf') && statSync(join(dir, f)).isFile())
  .filter((f) => !only || only.includes(f))
  .sort();
const known: Record<string, string[]> = JSON.parse(readFileSync(knownPath, 'utf8'));

/** A problem without page numbers and details, so a known issue matches across small changes. */
const kind = (p: string) => p.replace(/ page \d+/, '').replace(/^(\w[\w ]*?):.*$/, '$1');

interface Worker {
  proc: ChildProcess;
  busy?: { file: string; timer: NodeJS.Timeout; resolve(r: FileResult): void };
}

function spawn(): Promise<Worker> {
  return new Promise((ready) => {
    const proc = fork(viteNode, [join(here, 'check.ts')], {
      execArgv: ['--max-old-space-size=3072'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    const w: Worker = { proc };
    proc.stderr!.on('data', () => {}); // pdf.js warnings
    proc.on('message', (m: FileResult | { ready: true }) => {
      if ('ready' in m) return ready(w);
      const b = w.busy;
      if (!b) return;
      clearTimeout(b.timer);
      w.busy = undefined;
      b.resolve(m);
    });
    proc.on('exit', (code, signal) => {
      const b = w.busy;
      if (!b) return;
      clearTimeout(b.timer);
      w.busy = undefined;
      b.resolve({ file: b.file, fail: [`crash: process exited (${signal ?? code})`], ms: 0 });
    });
  });
}

async function runOne(w: Worker, file: string): Promise<{ result: FileResult; dead: boolean }> {
  let dead = false;
  const result = await new Promise<FileResult>((res) => {
    const timer = setTimeout(() => {
      dead = true;
      w.busy = undefined;
      w.proc.kill('SIGKILL');
      res({ file, fail: [`timeout: over ${TIMEOUT / 1000} s`], ms: TIMEOUT });
    }, TIMEOUT);
    w.busy = { file, timer, resolve: res };
    w.proc.send({ path: join(dir, file), file });
  });
  return { result, dead: dead || w.proc.exitCode !== null || w.proc.signalCode !== null };
}

const t0 = Date.now();
const results: FileResult[] = [];
const queue = [...files];
await Promise.all(
  Array.from({ length: Math.min(jobs, files.length) }, async () => {
    let w = await spawn();
    for (let file = queue.shift(); file; file = queue.shift()) {
      const { result, dead } = await runOne(w, file);
      results.push(result);
      if (results.length % 50 === 0) console.log(`${results.length}/${files.length} files…`);
      if (dead) w = await spawn();
    }
    w.proc.kill();
  }),
);
results.sort((a, b) => a.file.localeCompare(b.file));

// Compare with the known issues.
const newProblems: string[] = [];
const fixed: string[] = [];
const nextKnown: Record<string, string[]> = {};
for (const r of results) {
  const kinds = [...new Set(r.fail.map(kind))].sort();
  if (kinds.length) nextKnown[r.file] = kinds;
  const was = known[r.file] ?? [];
  for (const p of r.fail) if (!was.includes(kind(p))) newProblems.push(`${r.file}: ${p}`);
  for (const k of was) if (!kinds.includes(k)) fixed.push(`${r.file}: ${k}`);
}

const count = (f: (r: FileResult) => unknown) => results.filter(f).length;
const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5);
const summary = [
  `## PDF corpus: ${files.length} files in ${Math.round((Date.now() - t0) / 1000)} s`,
  '',
  `| | files |`,
  `|---|---|`,
  `| opened and drawn | ${count((r) => r.pages !== undefined)} |`,
  `| saved and checked with qpdf | ${count((r) => r.saved)} |`,
  `| saved with damage the original already had (qpdf) | ${count((r) => r.qpdfInherited)} |`,
  `| refused by pdf.js (broken on purpose) | ${count((r) => r.openError)} |`,
  `| need a password | ${count((r) => r.password)} |`,
  `| read-only (pdf-lib cannot parse them) | ${count((r) => r.readOnly)} |`,
  `| known issues | ${Object.keys(known).filter((f) => files.includes(f)).length} |`,
  `| **new problems** | **${newProblems.length}** |`,
  '',
  newProblems.length ? `### New problems\n\n${newProblems.map((p) => `- ${p}`).join('\n')}\n` : '',
  fixed.length ? `### Fixed (remove from known-issues.json with --update)\n\n${fixed.map((p) => `- ${p}`).join('\n')}\n` : '',
  `Slowest: ${slowest.map((r) => `${r.file} (${(r.ms / 1000).toFixed(1)} s)`).join(', ')}`,
].join('\n');
console.log(`\n${summary}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
mkdirSync(resolve('.corpus'), { recursive: true });
writeFileSync(resolve('.corpus/results.json'), JSON.stringify(results, null, 1));

if (update) {
  // Keep entries for files this run did not look at (--only).
  const merged = only ? { ...known, ...Object.fromEntries(only.map((f) => [f, nextKnown[f]])) } : nextKnown;
  const sorted = Object.fromEntries(Object.entries(merged).filter(([, v]) => v?.length).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(knownPath, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(sorted).length} known issues to ${knownPath}`);
} else if (newProblems.length) {
  process.exit(1);
}
