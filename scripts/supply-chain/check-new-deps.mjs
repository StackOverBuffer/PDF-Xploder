#!/usr/bin/env node
/**
 * Vets every package that a change adds to package-lock.json (a new name, or a new
 * version of an existing one) against the npm registry, to catch slopsquatted,
 * typosquatted or freshly hijacked packages before they are merged.
 *
 *   node scripts/supply-chain/check-new-deps.mjs <base-git-ref>   # e.g. origin/main
 *   node scripts/supply-chain/check-new-deps.mjs --all            # every locked package
 *
 * Fails (exit 1) when a new package version
 *   - does not come from registry.npmjs.org or has no integrity hash,
 *   - belongs to a package first published less than MIN_PACKAGE_AGE_DAYS ago (default 90),
 *   - was published less than MIN_RELEASE_AGE_DAYS ago (default 7),
 *   - or cannot be found on the registry,
 * unless it is listed in scripts/supply-chain/allowlist.json (see SECURITY.md).
 * Warns about: no linked source repository, fewer than MIN_WEEKLY_DOWNLOADS (default 1000)
 * weekly downloads, a single maintainer, or download numbers that could not be fetched.
 *
 * Registry data is treated as untrusted: it is only compared and printed, never executed.
 * Uses only Node's built-ins (fetch), so it adds no dependencies of its own.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DAY = 86_400_000;
const MIN_PACKAGE_AGE_DAYS = Number(process.env.MIN_PACKAGE_AGE_DAYS ?? 90);
const MIN_RELEASE_AGE_DAYS = Number(process.env.MIN_RELEASE_AGE_DAYS ?? 7);
const MIN_WEEKLY_DOWNLOADS = Number(process.env.MIN_WEEKLY_DOWNLOADS ?? 1000);
const REGISTRY = 'https://registry.npmjs.org';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const arg = process.argv[2];
if (!arg) {
  console.error('usage: check-new-deps.mjs <base-git-ref> | --all');
  process.exit(2);
}

/** name@version → lockfile entry, for every installed package in a v2/v3 lockfile. */
function lockedPackages(lock) {
  const out = new Map();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path || entry.link || !path.includes('node_modules/')) continue;
    const name = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    out.set(`${name}@${entry.version}`, { name, version: entry.version, ...entry });
  }
  return out;
}

const current = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const now = lockedPackages(current);
let base = new Map();
if (arg !== '--all') {
  let text;
  try {
    text = execFileSync('git', ['show', `${arg}:package-lock.json`], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch {
    text = '{}'; // no lockfile on the base: everything is new
  }
  base = lockedPackages(JSON.parse(text));
}
const added = [...now.values()].filter((p) => !base.has(`${p.name}@${p.version}`));

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const direct = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies }));

const allowFile = join(here, 'allowlist.json');
const allowlist = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')) : [];
const allowed = (pkg) =>
  allowlist.find((a) => a.package === `${pkg.name}@${pkg.version}` && (!a.expires || Date.parse(a.expires) > Date.now()));

const enc = (name) => name.replace('/', '%2f');

async function getJson(url, tries = 3) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return await res.json();
      if (res.status >= 400 && res.status < 500) return null; // not found or refused: no retry
    } catch {
      /* retry */
    }
    if (attempt + 1 < tries) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error(`could not fetch ${url}`);
}

async function weeklyDownloads(name) {
  try {
    const d = await getJson(`https://api.npmjs.org/downloads/point/last-week/${name}`, 1);
    if (d && typeof d.downloads === 'number') return d.downloads;
  } catch {
    /* fall through to the search API */
  }
  try {
    const s = await getJson(`${REGISTRY}/-/v1/search?size=20&text=${encodeURIComponent(name)}`, 1);
    const hit = s?.objects?.find((o) => o.package?.name === name);
    if (hit && typeof hit.downloads?.weekly === 'number') return hit.downloads.weekly;
  } catch {
    /* unknown */
  }
  return null;
}

const days = (iso) => Math.floor((Date.now() - Date.parse(iso)) / DAY);
const rows = [];
let failed = 0;

for (const pkg of added) {
  const fails = [];
  const warns = [];
  const info = { name: pkg.name, version: pkg.version, direct: direct.has(pkg.name) };

  if (!pkg.resolved?.startsWith(`${REGISTRY}/`)) fails.push(`resolved from ${pkg.resolved ?? 'nowhere'}, not ${REGISTRY}`);
  if (!pkg.integrity) fails.push('no integrity hash in lockfile');

  const meta = await getJson(`${REGISTRY}/${enc(pkg.name)}`);
  if (!meta) {
    fails.push('not found on the registry');
  } else {
    const created = meta.time?.created;
    const published = meta.time?.[pkg.version];
    info.created = created?.slice(0, 10) ?? '?';
    info.published = published?.slice(0, 10) ?? '?';
    if (!created || days(created) < MIN_PACKAGE_AGE_DAYS) fails.push(`package first published ${info.created} (< ${MIN_PACKAGE_AGE_DAYS} days)`);
    if (!published) fails.push(`version ${pkg.version} not on the registry`);
    else if (days(published) < MIN_RELEASE_AGE_DAYS) fails.push(`version published ${info.published} (< ${MIN_RELEASE_AGE_DAYS} days)`);

    const v = meta.versions?.[pkg.version] ?? {};
    const repo = v.repository ?? meta.repository;
    info.repo = (typeof repo === 'string' ? repo : repo?.url) ?? '';
    if (!info.repo) warns.push('no source repository linked');
    const maintainers = v.maintainers ?? meta.maintainers ?? [];
    info.maintainers = maintainers.map((m) => m.name ?? m).join(', ');
    if (maintainers.length <= 1) warns.push('single maintainer');

    info.downloads = await weeklyDownloads(pkg.name);
    if (info.downloads === null) warns.push('weekly downloads UNVERIFIED (lookup failed)');
    else if (info.downloads < MIN_WEEKLY_DOWNLOADS) warns.push(`only ${info.downloads} weekly downloads`);
  }

  const allow = fails.length ? allowed(pkg) : null;
  if (allow) warns.push(`allowlisted: ${allow.reason}`);
  const status = fails.length && !allow ? 'FAIL' : warns.length ? 'warn' : 'ok';
  if (status === 'FAIL') failed++;
  rows.push({ ...info, status, notes: [...fails, ...warns].join('; ') });
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const lines = [
  `### New or changed npm packages (${added.length})`,
  '',
  `Rules: package age ≥ ${MIN_PACKAGE_AGE_DAYS} days, release age ≥ ${MIN_RELEASE_AGE_DAYS} days, from ${REGISTRY} with an integrity hash.`,
  '',
];
if (rows.length) {
  lines.push('| Status | Package | Direct | Package created | Version published | Weekly downloads | Maintainers | Repo | Notes |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of rows.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'FAIL' ? -1 : 1))) {
    lines.push(
      `| ${r.status} | ${esc(r.name)}@${esc(r.version)} | ${r.direct ? 'yes' : ''} | ${esc(r.created)} | ${esc(r.published)} | ${r.downloads ?? 'UNVERIFIED'} | ${esc(r.maintainers)} | ${esc(r.repo)} | ${esc(r.notes)} |`,
    );
  }
} else {
  lines.push('No packages were added or changed.');
}
const report = lines.join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);

if (failed) {
  console.error(`\n${failed} package(s) failed. See SECURITY.md for how to vet them or allowlist an urgent fix.`);
  process.exit(1);
}
