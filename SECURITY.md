# Security

## Reporting a vulnerability

Please report security problems privately through GitHub's
[private vulnerability reporting](https://github.com/StackOverBuffer/PDF-Xploder/security/advisories/new)
rather than in a public issue.

## Dependency policy

PDF-Xploder runs in people's browsers and handles their documents and signing keys, so every
dependency is code we ship to them. Attackers publish malicious packages under names that are
easy to mistype, or that AI assistants tend to invent ("slopsquatting"). Such a package
really exists on the registry, so **existing is never proof that a package is legitimate**.

### How installs are locked down

- `package-lock.json` is committed and CI installs only with `npm ci`, which fails if the
  lockfile and `package.json` disagree.
- `.npmrc` sets one registry (`registry.npmjs.org`), turns off dependencies' install scripts
  (`ignore-scripts=true`) and saves exact versions (`save-exact=true`). Nothing in the
  project currently needs an install script. If a future dependency really does, run its
  script explicitly in CI and note why here.
- Releases must be at least **7 days old** before they enter the lockfile (enforced in CI,
  see below). Most malicious releases are found and pulled within days.

### Checklist for adding a dependency

1. Check whether an existing dependency, the browser platform or a few lines of our own code
   already do the job.
2. Look the package up for real, and copy the output into the PR description:

   ```sh
   npm view <name> time.created time.modified dist-tags.latest maintainers repository.url
   npm view <name>@<version> time
   ```

   Weekly downloads are at `https://api.npmjs.org/downloads/point/last-week/<name>`.
3. Check the details:
   - The name matches what the library's own docs tell you to install, letter for letter
     and scope included. Watch for near-misses of popular names.
   - The package was first published more than 90 days ago, and the version you add more
     than 7 days ago.
   - Downloads are plausible for what it is.
   - It links a source repository, and that repository is real, active and publishes
     this package.
   - The maintainers are long-standing, not one account added recently.
   - Its install scripts, if any, are understood. They won't run here anyway.
4. Add it with an exact version: `npm install --save-exact <name>@<version>`.
5. AI assistants follow the same rules (`AGENTS.md`) and are not allowed to install
   packages without a human's approval (`.claude/settings.json`).

### What CI checks

| Check | Where | What it does | Blocks merge? |
|---|---|---|---|
| `npm ci` | every job | Installs exactly the lockfile, with no install scripts | yes |
| `npm audit signatures` | `supply-chain` | Verifies the registry signature of every installed package, and its provenance where published | yes |
| `npm audit --omit=dev --audit-level=high` | `supply-chain` | Known high/critical vulnerabilities in code that ships to users | yes |
| `npm audit --audit-level=high` | `supply-chain` | The same for dev tools | warning only |
| `check-new-deps.mjs` | `supply-chain` (PRs) | Looks up every package the PR adds or changes in the lockfile. Fails on: package under 90 days old, version under 7 days old, not from registry.npmjs.org, no integrity hash, not on the registry. Warns on: no repo link, under 1,000 weekly downloads, single maintainer. Results are in the job summary. | yes |
| Dependency review | `dependency-review` (PRs) | GitHub's review of changed dependencies: fails on high/critical advisories and shows OpenSSF Scorecards | yes |
| OSV-Scanner | `osv-scanner` | Vulnerabilities and **known malicious packages** (OpenSSF malicious-packages data) in the lockfile | yes |

All GitHub Actions are pinned to full commit SHAs, with the version in a comment. To update
one, look up the new tag's commit with `git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag>`
(use the `^{}` line for annotated tags), then update the SHA and the comment together.

### When a check flags a package

- **New-dependency check fails:** treat it as suspicious until proven otherwise. Look up
  the package as in the checklist above, compare the name with the library's official docs,
  and look at its repository and recent releases. If it's a young version of a trusted
  package, waiting a few days usually clears the check on its own.
- **A known malicious package (OSV `MAL-…` id):** do not merge. Remove it, check whether
  it was ever installed on a developer machine or in CI (lifecycle scripts are off, but its
  code may have been imported), and rotate any secrets that could have been exposed.
- **A vulnerability:** upgrade to the fixed version. If that isn't possible yet and the
  advisory doesn't affect us (dev-only, for example), add an ignore with a reason and an
  expiry date: to `osv-scanner.toml` (`[[IgnoredVulns]]` with `ignoreUntil`) and to
  `allow-ghsas` in the dependency-review job. Currently ignored: five vitest/tinypool
  advisories that only affect the test runner and need the vitest 5 upgrade
  (expiry 2027-02-20).

### Urgent security patches (bypassing the 7-day release age)

A fix released today will fail the release-age check. To ship it anyway:

1. Make sure it really is the upstream fix: the release is announced in the project's
   repository or advisory, and it was published by the usual maintainers
   (`npm view <name>@<version> _npmUser maintainers`).
2. Add it to `scripts/supply-chain/allowlist.json` with a short reason and an expiry a
   few weeks out:

   ```json
   [
     { "package": "node-forge@1.4.4", "reason": "GHSA-xxxx-xxxx-xxxx fix", "expires": "2026-12-31" }
   ]
   ```

3. Mention the allowlist entry in the PR description. Remove expired entries when you
   come across them.

The thresholds can also be changed for a single run with the environment variables
`MIN_RELEASE_AGE_DAYS`, `MIN_PACKAGE_AGE_DAYS` and `MIN_WEEKLY_DOWNLOADS`. For a local
install that respects the delay, npm's `--before` option resolves versions as of a date:
`npm install --save-exact --before="$(date -d '7 days ago' +%F)" <name>`.
