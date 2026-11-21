# Interleave, Booklet, Poster and Save-as-PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roadmap item 1 — interleave front/back scans, booklet imposition in the print dialog, poster tiling, and saving any print layout as a PDF.

**Architecture:** Extend `PrintOptions` with `imposition` and dispatch inside `planSheets` (existing grid for none, booklet ordering through the same grid math, a dedicated poster planner); add "Save as PDF…" beside "Print…". Interleave is a pure layout function in `organize.ts` applied via the existing `arrange` store command, with a dialog modeled on "Insert pages from file".

**Tech Stack:** TypeScript, React, zustand, `@cantoo/pdf-lib`, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2025-11-20-interleave-booklet-poster-design.md`

## Global Constraints

- No package installs of any kind (`AGENTS.md`); test commands are `npm test -- <file>` and the full `npm test`; typecheck with `npm run typecheck`.
- Every user-visible string: English key in code, German entry in `src/locales/de/organize.ts` or `src/locales/de/ui.ts` (placeholders like `{n}` must survive translation; `tests/locales.test.ts` checks).
- Match the surrounding code style (2-space indent, single quotes, semicolons, comments explain why).
- Branch: `interleave-booklet-poster`. Never push; commit locally per task with the exact messages below.

## Review Focus

1. Interleaving files with different page counts → leftovers are appended at the end, nothing is dropped or duplicated. Test in Task 1.
2. Booklet with a page count that is not a multiple of 4 → blanks pad it so the fold stays correct; sheet count = ceil(n/4). Test in Task 2.
3. One-page (or two-page) booklet → still one sheet with blanks, front cover on the right half. Test in Task 2.
4. Poster tiles must cover the page without cropping or gaps, including overlap and the last row/column → formula tests in Task 3.
5. Empty page selection → both `Print…` and `Save as PDF…` are disabled (same condition). No component-test harness for the dialog; verify by reading the `disabled` props and by `npm run typecheck` in Task 3.

---

### Task 1: Interleave pages with a file

**Files:**
- Modify: `src/lib/organize.ts` (new pure function, place near `swapLayout`/`replaceLayout`)
- Modify: `src/store/organizeCommands.ts` (new command near `insertPagesFromFile`)
- Modify: `src/components/OrganizeDialogs.tsx` (new dialog + registry entry)
- Modify: `src/components/Dialogs.tsx` (add `orgInterleave` to the case list that renders `OrganizeDialog`)
- Modify: `src/components/OrganizeTab.tsx` (menu item next to "Merge Pages")
- Modify: `src/locales/de/organize.ts`
- Test: `tests/organize.test.ts`

**Interfaces:**
- Consumes: `PageSource = number | { file: number; page: number }` (existing, `src/lib/organize.ts`); `arrange(label, layout, others)` (existing, `src/store/organizeCommands.ts:244`); `pageCountOf(bytes)` (existing in the same store file); `usePdfFile`, `FileRow`, `Hint`, `Foot`, `Choice`, `Check` dialog helpers (existing, `src/components/OrganizeDialogs.tsx`).
- Produces: `export interface InterleaveOptions { first: 'current' | 'file'; reverseOther: boolean }` and `export function interleaveLayout(currentCount: number, otherCount: number, o: InterleaveOptions): PageSource[]` in `src/lib/organize.ts`; store command `export async function interleaveWithFile(other: Uint8Array, o: InterleaveOptions)` in `src/store/organizeCommands.ts`; dialog name `orgInterleave`.

- [ ] **Step 1: Write the failing tests in `tests/organize.test.ts`** (follow the file's existing import/style):

```ts
it('interleaves two documents alternately', () => {
  expect(org.interleaveLayout(2, 2, { first: 'current', reverseOther: false }))
    .toEqual([0, { file: 0, page: 0 }, 1, { file: 0, page: 1 }]);
  expect(org.interleaveLayout(2, 2, { first: 'file', reverseOther: false }))
    .toEqual([{ file: 0, page: 0 }, 0, { file: 0, page: 1 }, 1]);
});

it('interleaves a reversed second file (re-fed scan stack)', () => {
  expect(org.interleaveLayout(3, 2, { first: 'current', reverseOther: true }))
    .toEqual([0, { file: 0, page: 1 }, 1, { file: 0, page: 0 }, 2]);
});

it('appends the leftover pages of the longer document', () => {
  expect(org.interleaveLayout(1, 3, { first: 'current', reverseOther: false }))
    .toEqual([0, { file: 0, page: 0 }, { file: 0, page: 1 }, { file: 0, page: 2 }]);
  expect(org.interleaveLayout(3, 1, { first: 'file', reverseOther: false }))
    .toEqual([{ file: 0, page: 0 }, 0, 1, 2]);
});

it('refuses an empty file', () => {
  expect(() => org.interleaveLayout(1, 0, { first: 'current', reverseOther: false })).toThrow();
});
```

- [ ] **Step 2: Run `npm test -- tests/organize.test.ts` — expect FAIL** (`interleaveLayout` is not exported).

- [ ] **Step 3: Implement `interleaveLayout`** in `src/lib/organize.ts`: walk pairs over the shorter count (current page first or file first per `o.first`; the other file's page is `reverseOther ? otherCount - 1 - k : k`, emitted as `{ file: 0, page }`), then append the longer side's remaining pages (plain numbers for current, `{ file: 0, page }` for the file). Throw `new Error('The file has no pages.')` when `otherCount < 1`.

- [ ] **Step 4: Run `npm test -- tests/organize.test.ts` — expect PASS.**

- [ ] **Step 5: Add the store command** in `src/store/organizeCommands.ts` near `insertPagesFromFile`: guard with `requirePermission('assemble')`, read `otherCount = await pageCountOf(other)` (notify `The file could not be read.` as an error and return when falsy), build `org.interleaveLayout(S().pageIds.length, otherCount, o)`, `await arrange('Interleaving pages…', layout, [other])`, then `S().setSelectedPages([])` and `S().goToPage(0)`.

- [ ] **Step 6: Add the dialog** `InterleaveDialog` in `src/components/OrganizeDialogs.tsx` (pattern: `InsertFileDialog` without position row): `FileRow` with `accept={OPEN_ACCEPT}`; `Choice` for which document starts (`'current'` → label `This document (front sides)`, `'file'` → `The chosen file`); `Check` "The file's pages are in reverse order (typical when the stack was re-fed for the back sides)"; `Hint`: "The pages of both documents are combined alternately. Leftover pages of the longer document are appended at the end." OK runs `oc.interleaveWithFile(file.bytes, { first, reverseOther })`, disabled without a file. Register `orgInterleave: InterleaveDialog` in `ORGANIZE_DIALOGS` and add `orgInterleave` to the `Dialogs.tsx` case list.

- [ ] **Step 7: Add the menu item** in `src/components/OrganizeTab.tsx` in the group with Merge Pages: `<Btn size="small" icon={<Shuffle size={I} />} label="Interleave Pages" disabled={!canAssemble} onClick={open('orgInterleave')} />` (import `Shuffle` from `lucide-react`).

- [ ] **Step 8: German strings** in `src/locales/de/organize.ts` for every new English key, e.g. `'Interleave Pages': 'Seiten verschränken'`, `'Interleave with File…': 'Mit Datei verschränken…'`, `'This document (front sides)': 'Dieses Dokument (Vorderseiten)'`, `'The chosen file': 'Die gewählte Datei'`, `'The file could not be read.': 'Die Datei konnte nicht gelesen werden.'`, `'Interleaving pages…': 'Seiten werden verschränkt…'` plus the checkbox/hint strings. (Wording is your call; keep `{…}` placeholders intact where used.)

- [ ] **Step 9: Verify** `npm test -- tests/organize.test.ts tests/locales.test.ts` PASS and `npm run typecheck` clean.

- [ ] **Step 10: Commit** `git add -A && git commit -m "Interleave pages with a file to combine separately scanned front and back sides"`

### Task 2: Booklet imposition

**Files:**
- Modify: `src/lib/printLayout.ts`
- Modify: `src/components/PrintDialog.tsx`
- Modify: `src/locales/de/ui.ts`
- Test: `tests/printLayout.test.ts`

**Interfaces:**
- Consumes: existing `planSheets` grid logic, `PrintOptions`, `Sheet`, `Placement`, `PerSheet`.
- Produces: `export type Imposition = 'none' | 'booklet' | 'poster'`; `PrintOptions` gains `imposition: Imposition; posterColumns: number; posterOverlap: number` (poster values unused until Task 3; `DEFAULT_PRINT` gains `imposition: 'none', posterColumns: 2, posterOverlap: 0`); `export function bookletSequence(count: number): number[]` — values are 0-based positions into the page list, `-1` for a blank half; `planSheets` dispatches on `o.imposition`.

- [ ] **Step 1: Write the failing tests in `tests/printLayout.test.ts`:**

```ts
it('orders booklet sheets for saddle-stitch folding, padding with blanks', () => {
  expect(bookletSequence(8)).toEqual([7, 0, 1, 6, 5, 2, 3, 4]);
  expect(bookletSequence(6)).toEqual([-1, 0, 1, -1, 5, 2, 3, 4]);
  expect(bookletSequence(1)).toEqual([-1, 0, -1, -1]);
});

it('lays a booklet out two pages per sheet with blanks skipped', () => {
  const sheets = planSheets(opts({ imposition: 'booklet', paper: 'A4' }), [A4, A4, A4, A4, A4]);
  expect(sheets).toHaveLength(4); // ceil(5/4) half-sheets … 8 positions → 4 sheets
  expect(sheets[0].items).toHaveLength(1); // left half blank, right half page 0
  expect(sheets[0].items[0]).toMatchObject({ page: 0 });
  expect(sheets[0].items[0].x).toBeGreaterThan(sheets[0].width / 2);
});
```

- [ ] **Step 2: Run `npm test -- tests/printLayout.test.ts` — expect FAIL.**

- [ ] **Step 3: Implement** in `src/lib/printLayout.ts`:
  - `bookletSequence(count)`: `m = Math.ceil(count / 4) * 4`; for `k` in `0..m/4-1` push `[m - 2*k - 1, 2*k, 2*k + 1, m - 2*k - 2]`; map any value `>= count` to `-1`.
  - Extract the existing grid body of `planSheets` into an internal `gridSheets(o, list: number[], sizes)` helper where `list` may contain `-1` (skip that cell's item; still count it as a cell). Guard every `sizes[page]` lookup against `-1` — including the sheet-orientation decision, which must use the first non-blank page of the group (fall back to the first sized page of the document). `planSheets` with `imposition: 'none'` calls it with `printedPages(o)` (existing behaviour, existing tests must stay green). For `'booklet'`: call it with `bookletSequence(o.pages.length).map((p) => p < 0 ? -1 : o.pages[p])` and a options object forced to `perSheet: 2, order: 'horizontal', subset: 'all', reverse: false`. Poster returns `[]` for now (Task 3 fills it in).
  - `isPlain` also returns `false` unless `o.imposition === 'none'`.

- [ ] **Step 4: Run `npm test -- tests/printLayout.test.ts` — expect PASS** (old tests too: `npm test -- tests/printLayout.test.ts`).

- [ ] **Step 5: Print dialog UI** in `src/components/PrintDialog.tsx`: a `Layout` section select `Imposition` with `None` / `Booklet` / `Poster` bound to `o.imposition`. When `booklet`: hide the `Subset` and `Reverse order` rows and the `Pages per sheet` select; show `Hint` "Two pages per sheet, ordered so two-sided printing folds the stack into a booklet. Missing pages are padded blank." When `poster`: hide the `Pages per sheet` select and page-order row (columns/overlap inputs come in Task 3).

- [ ] **Step 6: German strings** in `src/locales/de/ui.ts`: `'Imposition': 'Ausschießen'`, `'None': 'Keine'` (only if not already present), `'Booklet': 'Heftchen'`, `'Poster': 'Poster'`, and the hint. Check `grep -n "'None'" src/locales/de/ui.ts` first to avoid duplicate keys.

- [ ] **Step 7: Verify** `npm test -- tests/printLayout.test.ts tests/locales.test.ts` PASS, `npm run typecheck` clean.

- [ ] **Step 8: Commit** `git add -A && git commit -m "Booklet imposition in the print dialog"`

### Task 3: Poster tiling and Save as PDF

**Files:**
- Modify: `src/lib/printLayout.ts`
- Modify: `src/store/printCommands.ts`
- Modify: `src/components/PrintDialog.tsx`
- Modify: `src/locales/de/ui.ts`
- Test: `tests/printLayout.test.ts`

**Interfaces:**
- Consumes: `PrintOptions.posterColumns/posterOverlap` (Task 2), `prepared(o.comments)`, `buildPrintPdf`, `planSheets` (existing, `src/store/printCommands.ts`), `downloadBlob(data, name)` and `baseName(name)` (existing, `src/lib/download.ts`).
- Produces: `export function printFileName(o: Pick<PrintOptions, 'imposition' | 'perSheet'>, fileName: string): string`; store command `export async function savePrintPdf(o: PrintOptions)`; poster support inside `planSheets`.

- [ ] **Step 1: Write the failing tests in `tests/printLayout.test.ts`:**

```ts
it('tiles a page over poster sheets without gaps or crops', () => {
  const sheets = planSheets(opts({ imposition: 'poster', paper: 'A4', posterColumns: 2, posterOverlap: 0 }), [A4]);
  // scale 2: two columns cover 1190.56 pt; height 1683.78 → 2 rows → 4 sheets
  expect(sheets).toHaveLength(4);
  const [a, b, c] = sheets.map((s) => s.items[0]);
  expect(a).toMatchObject({ page: 0, scale: 2, x: 0 });
  expect(b).toMatchObject({ x: -a.cell.w });
  expect(c.y).toBeLessThan(a.y); // second row shows a lower part of the page
  expect(sheets.every((s) => !s.borders)).toBe(true);
});

it('names saved print files after the layout', () => {
  expect(printFileName({ imposition: 'booklet', perSheet: 1 }, 'Report.pdf')).toBe('Report (booklet).pdf');
  expect(printFileName({ imposition: 'poster', perSheet: 1 }, 'Report')).toBe('Report (poster).pdf');
  expect(printFileName({ imposition: 'none', perSheet: 2 }, 'Report.pdf')).toBe('Report (2-up).pdf');
  expect(printFileName({ imposition: 'none', perSheet: 1 }, 'Report.pdf')).toBe('Report.pdf');
});
```

- [ ] **Step 2: Run `npm test -- tests/printLayout.test.ts` — expect FAIL.**

- [ ] **Step 3: Implement the poster planner** in `src/lib/printLayout.ts` (internal `posterSheets(o, sizes)`, dispatched from `planSheets`):
  - Sheet size from paper + orientation like the grid path, but `orientation === 'landscape'` is the only landscape case (`auto` and `portrait` give portrait sheets).
  - `m = margin * MM`, `ov = posterOverlap * MM`, `tileW = width - 2*m`, `tileH = height - 2*m`, `advX = tileW - ov`, `advY = tileH - ov`.
  - For each page `p` of `printedPages(o)` with size `{ w, h }`: `scale = (posterColumns * tileW - (posterColumns - 1) * ov) / w`; `scaledH = h * scale`; `rows = scaledH <= tileH ? 1 : Math.ceil((scaledH - tileH) / advY) + 1`.
  - For each `row` (0 = top row) and `col`: one `Sheet` with `borders: false` and a single `Placement`: `{ page: p, scale, w: tileW, h: tileH, x: -col * advX, y: scaledH - tileH - row * advY, cell: { x: m, y: m, w: tileW, h: tileH } }` (`buildPrintPdf` clips to the cell, so no crop/gap escapes).

- [ ] **Step 4: Implement `printFileName`** in `src/lib/printLayout.ts` using `baseName` from `./download`: suffix ` (booklet)`, ` (poster)`, or ` (${perSheet}-up)` when `perSheet > 1`, then `.pdf`.

- [ ] **Step 5: Run `npm test -- tests/printLayout.test.ts` — expect PASS.**

- [ ] **Step 6: Store command** `savePrintPdf(o: PrintOptions)` in `src/store/printCommands.ts`: when `!o.pages.length` notify `There are no pages to print.` as an error; otherwise inside `S().run('Preparing the file…', …)`: plain case (`o.imposition === 'none' && isPlain(o, S().pageIds.length)`) saves `o.comments ? await buildOutput() : await currentBytes()`, otherwise `planSheets` + `buildPrintPdf` over `prepared(o.comments)`; hand the result to `downloadBlob(out, printFileName(o, S().fileName || 'Document'))`.

- [ ] **Step 7: Print dialog UI**: when `imposition === 'poster'` show `Row label="Columns"` (`Num` 1–10 for `posterColumns`) and `Row label="Overlap (mm)"` (`Num` 0–30 for `posterOverlap`); keep Subset/Reverse active for poster. Footer: add `<button disabled={!pages.length} onClick={() => savePrintPdf(options)}>{t('Save as PDF…')}</button>` before the `Print…` button.

- [ ] **Step 8: German strings** in `src/locales/de/ui.ts`: `'Save as PDF…': 'Als PDF speichern…'`, `'Columns': 'Spalten'`, `'Overlap (mm)': 'Überlappung (mm)'`.

- [ ] **Step 9: Verify** `npm test -- tests/printLayout.test.ts tests/locales.test.ts` PASS, `npm run typecheck` clean, and confirm the `Save as PDF…` and `Print…` buttons share the same `disabled` condition (Review Focus 5).

- [ ] **Step 10: Commit** `git add -A && git commit -m "Poster imposition and Save as PDF in the print dialog"`

### Task 4: Roadmap, README and full verification

**Files:**
- Modify: `ROADMAP.md`, `README.md` (grep for "Interleave", "Booklet", "Poster", "pages per sheet", "Export Documents to Images" neighbourhoods to find every row that changes status)

- [ ] **Step 1: Update ROADMAP.md**: section 9 `Interleave Pages …` ⬜ → ✅ (front/back scans with a file, reversed order option); `Booklet Imposition` ⬜ → ✅ (saddle-stitch in the print dialog, blanks padded, browser duplex folds it); `Posterize …` ⬜ → 🟡 (poster tiling with overlap done; divide pages open); section 12 `Print Documents` ✅ row: add booklet/poster to the description and note `Save as PDF…` for any layout. Rewrite "Next up" item 1 as done (drop it, renumber, or mark ✅ with the same one-line style used for item 2).

- [ ] **Step 2: Update README.md** wherever printing/organizing features are listed (match existing sentence style; German README lines if the README is bilingual — check).

- [ ] **Step 3: Full verification**: `npm test` (whole suite, expect all PASS) and `npm run typecheck` (clean). Report any failure by name, including pre-existing ones.

- [ ] **Step 4: Commit** `git add -A && git commit -m "Roadmap and README: interleave, booklets and posters done"`

- [ ] **Step 5: Final report**: per-task summary, `git log --oneline main..HEAD`, full-suite result, and anything uncertain.
