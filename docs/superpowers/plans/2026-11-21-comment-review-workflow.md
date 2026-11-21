# Comment review workflow implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roadmap item 5 — review status on comments (set, filter, stored in the file the way Acrobat does it), a comment summary as a generated PDF document, and a comments CSV export.

**Architecture:** `status` joins `AnnotBase`; the private `/AwesomePDF` dict strips it like `replies` (restored from the standard structure), and the standard structure is a `/State` reply annotation under `StateModel 'Review'`. The summary is a Markdown string fed through the existing `markdownToPdf` pipeline and opened as a new document tab. CSV mirrors the measurements CSV.

**Tech Stack:** TypeScript, React, zustand, `@cantoo/pdf-lib`, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-21-comment-review-workflow-design.md`

## Global Constraints

- No package installs of any kind (`AGENTS.md`); test with `npm test -- <file>`, full suite `npm test`, typecheck `npm run typecheck`.
- Every user-visible string: English key in code, German entry in `src/locales/de/ui.ts` (placeholders `{…}` must survive; `tests/locales.test.ts` checks).
- Match the surrounding code style (2-space indent, single quotes, semicolons, comments explain why).
- Branch `comment-workflow` in this worktree. Never push; commit locally per task with the exact messages below. Never run `git checkout`/`reset`/`rebase`/`stash`.
- Never touch `.npmrc`, `osv-scanner.toml`, `scripts/supply-chain/`, `.github/`, `package.json`, `package-lock.json`.
- Do not run `npm run corpus`, the perf scripts, `npm audit`, or a dev server.

## Review Focus

1. A comment with a status must survive save → close → open with the status intact, in our own files and in files touched by other editors (state dicts). Round-trip tests in Task 2.
2. A state dict from another editor must never appear as a visible reply with empty text (the "ghost reply" bug): the import path classifies state dicts before the reply loop adds them. Tested in Task 2.
3. Status dicts must not be written when flattening (flattened copies have no editable comments left) — pinned by the `flatten` option handling in Task 2.
4. Comment text containing Markdown characters must render literally in the summary, not as headings or emphasis. Tested in Task 3.
5. CSV must survive commas, quotes and line breaks inside comment text (RFC quoting). Tested in Task 4.

---

### Task 1: Status in the model, panel and popups

**Files:**
- Modify: `src/lib/types.ts` (AnnotBase)
- Modify: `src/components/CommentsPanel.tsx`
- Modify: `src/locales/de/ui.ts`
- Test: `tests/locales.test.ts` runs as part of the suite; the behaviour is UI-only, so this task's verification is typecheck + the suite.

**Interfaces:**
- Consumes: `useStore` annotations model; `updateAnnotation(pageId, id, patch)` (store.ts:230).
- Produces: `export type ReviewStatus = 'Accepted' | 'Rejected' | 'Cancelled' | 'Completed' | 'Reopened';` and `status?: ReviewStatus` on `AnnotBase` in `src/lib/types.ts` (comment: "Review status, stored as a /State reply annotation in the file — see annotIO.").

- [x] **Step 1:** Add `ReviewStatus` and the optional `status` field to `AnnotBase` in `src/lib/types.ts`.

- [x] **Step 2:** In `CommentsPanel.tsx`, inside each comment row (before the delete button), render a small `<select>` when `editable`, value `a.status ?? ''`, options: `''` → label `t('Not reviewed')`, then the five statuses (label `t(status)`); `onChange` → `updateAnnotation(pid, a.id, { status: v || undefined })`. Style it as `className="small-btn"`-sized inline select (keep the row's layout; a title attribute `t('Review status')` explains it).

- [x] **Step 3:** In the panel header next to the count, add a filter `<select>`: `All`, `Not reviewed`, then the five statuses (state `filter: '' | ReviewStatus | 'none'` with `useState`; `'none'` = not reviewed). While a filter is active, render only matching comments and hide page groups with no matches (the header count stays the document total).

- [x] **Step 4:** German strings in `de/ui.ts`: `Accepted: 'Angenommen'`, `Rejected: 'Abgelehnt'`, `Cancelled: 'Zurückgezogen'`, `Completed: 'Erledigt'`, `Reopened: 'Wieder geöffnet'`, `'Not reviewed': 'Nicht geprüft'`, `'Review status': 'Prüfstatus'`, `All: 'Alle'`.

- [x] **Step 5:** `npm run typecheck` and `npm test` — green. Commit:

```bash
git add src/lib/types.ts src/components/CommentsPanel.tsx src/locales/de/ui.ts
git commit -m "Comment review status: choose and filter it in the comments panel"
```

### Task 2: Status in the file — export and import

**Files:**
- Modify: `src/lib/annotIO.ts`
- Modify: `src/lib/pdfOps.ts` (exportWithAnnotations options)
- Modify: every store caller of `exportWithAnnotations` (find with `grep -rn "exportWithAnnotations(" src/store`)
- Test: `tests/commentWorkflow.test.ts` (new file)

**Interfaces:**
- Consumes: `replyDict` and the reply loop in `importAnnotations` (annotIO.ts ~577-604); the private-model serialization at annotIO.ts:248 (`const { replies, ...rest } = a;`).
- Produces: `AppearanceOptions`/export options gain `author?: string` (the acting user, used as the state annotation's `/T`); import maps state dicts to `status` (and removes them from the file, exactly like replies).

- [x] **Step 1: Write the failing tests** in `tests/commentWorkflow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { importAnnotations, writeNativeAnnotation } from '../src/lib/annotIO';
import { drawContext, exportWithAnnotations } from '../src/lib/pdfOps';
import type { Annotation, PageGeom } from '../src/lib/types';

const g: PageGeom = { view: [0, 0, 300, 200], rotation: 0 };
const note = (over: Partial<Annotation> = {}): Annotation => ({
  id: 'n1', type: 'note', at: { x: 10, y: 10 }, text: 'hello', color: '#fbc02d',
  opacity: 1, author: 'A', createdAt: 0, ...over,
} as Annotation);

it('writes the status as a review state annotation and reads it back', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]);
  const ctx = await drawContext(doc);
  await writeNativeAnnotation(ctx, doc.getPages()[0], g, note({ status: 'Accepted' }), { author: 'B' });
  const bytes = await doc.save();
  const res = await importAnnotations(await PDFDocument.load(bytes), [g], () => 'n2');
  expect(res.count).toBe(1);
  expect(res.annotations[0][0]).toMatchObject({ status: 'Accepted' });
  // The state dict was consumed: the file holds no leftover reply for it.
  expect(res.annotations[0][0].replies ?? []).toEqual([]);
});

it('maps another program\'s state annotation to the status, not to a reply', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const parent = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFHexString.fromText('the comment'),
    T: PDFHexString.fromText('A'), F: 4, M: PDFString.fromDate(new Date(0)), CreationDate: PDFString.fromDate(new Date(0)),
  }));
  const state = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Text', IRT: parent, RT: 'R', State: 'Rejected', StateModel: 'Review',
    T: PDFHexString.fromText('B'), F: 4, M: PDFString.fromDate(new Date(0)),
  }));
  page.node.set(PDFName.of('Annots'), doc.context.obj([parent, state]));
  const res = await importAnnotations(doc, [g], () => 'n3');
  expect(res.count).toBe(1);
  expect(res.annotations[0][0]).toMatchObject({ status: 'Rejected' });
  expect(res.annotations[0][0].replies ?? []).toEqual([]);
});

it('leaves another program\'s Marked-model state alone without a ghost reply', async () => {
  // as above, but State: 'Marked', StateModel: 'Marked' — expect count 1, no status, replies empty,
  // and the Marked dict still present in the saved file's page annotations.
});

it('keeps a comment without status state-free', async () => {
  // write + read back a plain note: no State dict in the file (check the saved bytes contain
  // no 'StateModel'), status undefined on import.
});
```

(Complete the two sketched tests in the same style; `PDFName`, `PDFHexString`, `PDFString` are imported from `@cantoo/pdf-lib` as in other test files. To check the saved bytes for a missing `StateModel`, `expect(new TextDecoder().decode(bytes)).not.toContain('StateModel')` is enough.)

- [x] **Step 2: Run `npm test -- tests/commentWorkflow.test.ts` — expect FAIL.**

- [x] **Step 3: Export** in `writeNativeAnnotation` (annotIO.ts):
  - Strip status from the private model exactly like replies: `const { replies, status, ...rest } = a;`
  - After the reply loop, when `status` is set and `!opts.flatten`, register and add a state dict mirroring `replyDict` but with `State: a.status`, `StateModel: 'Review'`, `Contents` omitted, `NM: PDFHexString.fromText('state-' + a.id)`, `T: PDFHexString.fromText(opts.author ?? a.author)`, `M: PDFString.fromDate(new Date())`, same `Name`/`F` flags as replies.

- [x] **Step 4: Options plumbing** — `AppearanceOptions` (annotIO.ts) and the `exportWithAnnotations` options (`pdfOps.ts:425`) gain `author?: string`. In `src/store`, pass `author: S().author` at every `exportWithAnnotations` call site that is not a pure flatten (grep them; the save path matters most).

- [x] **Step 5: Import** in the reply processing of `importAnnotations` (annotIO.ts, the `for (const { dict, entry } of replies)` loop): before the "reply to a missing root" check, read `const state = text(dict.lookup(PDFName.of('State'))); const model = text(dict.lookup(PDFName.of('StateModel')));`
  - `state && model === 'Review'` and the root exists: `'None'` → `delete root.status`, otherwise one of the five values → `root.status = state`; remove the entry (and its popup ref) from the file and `continue`.
  - `state && model === 'Review'` but no root: remove the entry too (an orphaned state says nothing).
  - `state && model === 'Marked'`: `continue` without removing and without adding a reply.
  - Everything else: existing reply behaviour, unchanged.

- [x] **Step 6: Run `npm test -- tests/commentWorkflow.test.ts` — expect PASS.** Then `npm test` (the corpus-backed save tests and the rest must stay green).

- [x] **Step 7: Commit**

```bash
git add src/lib/annotIO.ts src/lib/pdfOps.ts src/store tests/commentWorkflow.test.ts
git commit -m "Comment review status: stored as a review state annotation in the file"
```

### Task 3: Comment summary as a PDF document

**Files:**
- Create: `src/lib/commentSummary.ts`
- Modify: `src/store/extras.ts` (command)
- Modify: `src/components/Dialogs.tsx` (dialog + registry)
- Modify: `src/components/Ribbon.tsx` (Review tab)
- Modify: `src/locales/de/ui.ts`
- Test: `tests/commentWorkflow.test.ts`

**Interfaces:**
- Consumes: `markdownToPdf(markdown, { title, fontSize? })` (`src/lib/markdownPdf.ts:704`, headings become bookmarks); `S().openInNewTab(bytes, name)`; the measurements CSV's language handling in `src/lib/measure.ts` (`measurementsCsv(rows, lang)`) as the pattern for bilingual generated text.
- Produces:
  - `export function escapeMarkdownText(s: string): string` — backslash-escapes `\ ` * _ # ` [ ] ( ) ! < > |` and leading `#`/`-`/`+`/`1.` sequences.
  - `export interface CommentSummaryOptions { includeReplies: boolean; }`
  - `export function commentSummaryMarkdown(docName: string, byPage: { page: number; list: Annotation[] }[], o: CommentSummaryOptions, lang: 'en' | 'de'): string`
  - `export async function summarizeComments(o: CommentSummaryOptions)` in `src/store/extras.ts`.

- [x] **Step 1: Write the failing test** in `tests/commentWorkflow.test.ts`:

```ts
import { commentSummaryMarkdown, escapeMarkdownText } from '../src/lib/commentSummary';

it('escapes markdown syntax in comment text', () => {
  expect(escapeMarkdownText('# hi *bold* [link](x)')).toBe('\\# hi \\*bold\\* \\[link\\](x)');
});

it('builds one section per page with author, date and status', () => {
  const md = commentSummaryMarkdown('Plan.pdf', [{ page: 2, list: [note({ author: 'Jane', status: 'Accepted' })] }], { includeReplies: true }, 'en');
  expect(md).toContain('# Comments — Plan.pdf');
  expect(md).toContain('## Page 2');
  expect(md).toContain('Jane');
  expect(md).toContain('Accepted');
  expect(md).toContain('hello');
});

it('omits replies when asked and localizes headings in German', () => {
  const md = commentSummaryMarkdown('Plan.pdf', [{ page: 1, list: [note({ replies: [{ id: 'r', author: 'B', text: 'done', createdAt: 0 }] })] }], { includeReplies: false }, 'de');
  expect(md).toContain('Kommentare');
  expect(md).not.toContain('done');
});
```

(Shape the exact heading words freely — pin whatever you implement; the assertions above are the required behaviour. The comment text must appear escaped so `*bold*` shows literally in the PDF.)

- [x] **Step 2: Run `npm test -- tests/commentWorkflow.test.ts` — expect FAIL.**

- [x] **Step 3: Implement `commentSummary.ts`:** heading `# {Comments} — {docName}` (only when `byPage` has entries; the store command guards the empty case), one `## {Page {n}}` per page with comments, one list item per comment: `**{type label}** · {author} · {localized date} · {status}` then the escaped text on the next line; replies (when included) as indented sub-items `{author}: {text}`. Type labels: reuse the English `ANNOT_LABELS` names (`src/lib/annotGeom.ts`) as keys and translate the handful the summary needs for German inside this module (follow how `measurementsCsv` switches on `lang`).
  Date: `new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })` is fine here (generated document, not a unit-pinned string — assert only that author/status/text appear).

- [x] **Step 4: Store command** in `src/store/extras.ts`:

```ts
export async function summarizeComments(o: { includeReplies: boolean }) {
  const s = S();
  const byPage = s.pageIds.flatMap((id, i) => (s.annotations[id]?.length ? [{ page: i, list: s.annotations[id] }] : []));
  if (!byPage.length) return s.notify('There are no comments to summarize.');
  await s.run('Summarizing…', async () => {
    const md = commentSummaryMarkdown(baseName(s.fileName || 'document'), byPage, o, useLang.getState().lang);
    await s.openInNewTab(await markdownToPdf(md, { title: `Comments – ${baseName(s.fileName || 'document')}` }), `${baseName(s.fileName || 'document')}-comments.pdf`);
  });
}
```

(match the module's existing import style — `S`, `useLang`, `baseName`, lazy `markdownToPdf` if extras loads it on demand like other heavy imports).

- [x] **Step 5: Dialog and ribbon** — in `Dialogs.tsx`: add `'commentSummary'` to the `DialogName` union and a case rendering a small modal (pattern: `GotoDialog`): a checkbox "Include replies" (default on) and OK → `extra.summarizeComments({ includeReplies })`. In `Ribbon.tsx` Review tab, Group "Comments": add `<Btn icon={<FileText size={L} />} label="Summarize comments" title="Generate a PDF listing every comment" disabled={noDoc} onClick={() => show('commentSummary')} />`.

- [x] **Step 6: German strings**: `'Summarize comments': 'Kommentare zusammenfassen'`, `'Include replies': 'Antworten einbeziehen'`, `'There are no comments to summarize.': 'Es gibt keine Kommentare zusammenzufassen.'`, plus the summary's own German words (`Comments`, `Page {n}` if not already present — check existing keys first, `Page {n}` exists).

- [x] **Step 7: Run `npm test` and `npm run typecheck` — green. Commit:**

```bash
git add src/lib/commentSummary.ts src/store/extras.ts src/components/Dialogs.tsx src/components/Ribbon.tsx src/locales/de/ui.ts tests/commentWorkflow.test.ts
git commit -m "Comment summary: generate a PDF document from the comments"
```

### Task 4: Comments CSV export

**Files:**
- Modify: `src/lib/commentSummary.ts` (CSV writer)
- Modify: `src/store/extras.ts` (command)
- Modify: `src/components/Ribbon.tsx` (Review tab)
- Modify: `src/locales/de/ui.ts`
- Test: `tests/commentWorkflow.test.ts`

**Interfaces:**
- Consumes: `exportMeasurementsCsv` (`src/store/measureCommands.ts:44`) and `measurementsCsv` (`src/lib/measure.ts`) as the pattern (BOM, `downloadBlob`, language switch).
- Produces: `export function commentsCsv(rows: { page: number; type: string; author: string; date: string; status: string; text: string }[], lang: 'en' | 'de'): string` and `export function exportCommentsCsv()` in `src/store/extras.ts`.

- [ ] **Step 1: Failing test** — CSV quoting: a comment text with comma, quote and newline comes back quoted and doubled (`"a, ""b"""`), columns `page,type,author,date,status,text` in that order, first cell header row, no BOM inside the returned string (the store command adds the BOM like measurements does):

```ts
expect(commentsCsv([{ page: 1, type: 'Note', author: 'A', date: '2026-11-21', status: '', text: 'a, "b"\nc' }], 'en'))
  .toBe('page,type,author,date,status,text\r\n1,Note,A,2026-11-21,,"a, ""b""\nc"');
```

- [ ] **Step 2: Run — expect FAIL. Implement** the writer (RFC 4180: quote fields containing `,` `"` `\r` `\n`, double the quotes; `\r\n` line endings) and the store command (notify `There are no comments to export.` when empty; filename `${baseName(S().fileName || 'document')}-comments.csv`; type `text/csv`; BOM prefix `'\\uFEFF'` like measurements).

- [ ] **Step 3: Ribbon** — Review tab, Group "Comments": `<Btn icon={<FileSpreadsheet size={L} />} label="Export comments CSV" title="Save every comment as a CSV file" disabled={noDoc} onClick={extra.exportCommentsCsv} />` (import what is missing; the icon is already imported for measurements — reuse the same import).

- [ ] **Step 4: German strings**: `'Export comments CSV': 'Kommentare als CSV exportieren'`, `'There are no comments to export.': 'Es gibt keine Kommentare zu exportieren.'`.

- [ ] **Step 5: Run `npm test` — green. Commit:**

```bash
git add src/lib/commentSummary.ts src/store/extras.ts src/components/Ribbon.tsx src/locales/de/ui.ts tests/commentWorkflow.test.ts
git commit -m "Comments CSV export"
```

### Task 5: Roadmap and README

- [ ] **Step 1: ROADMAP.md** — Next up item 5 becomes 🟡 with "(review status, comment summary and CSV export done; FDF/XFDF still open)". Rows: "Comment Review Status" → ✅ ("set in the comments panel, stored as standard review state annotations"); "Summarize Comments (with font customization)" → ✅ ("as a generated PDF document; font size and replies optional — see markdownToPdf options"); leave the FDF/XFDF row ⬜.
- [ ] **Step 2: README.md** — extend the comments section with one or two sentences (status, summary, CSV).
- [ ] **Step 3: Commit** `git commit -m "Roadmap and README: comment review workflow"` (add the two files).

### Task 6: Final verification

- [ ] `npm run typecheck`, `npm test`, `npm run build` — all green. Check off completed steps in this plan as you go and commit the check-offs.
