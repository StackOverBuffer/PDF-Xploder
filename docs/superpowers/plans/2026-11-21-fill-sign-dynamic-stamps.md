# Fill & Sign and dynamic stamps implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roadmap item 4 — check, cross, date and initials tools for forms without fields, and dynamic stamps whose label fills in author and date when placed.

**Architecture:** Extend `StampAnnot` with an optional `kind: 'check' | 'cross'` drawn as a vector glyph in `appearance.ts` (no new annotation type: stamps already have hit testing, popups and export). Date and initials reuse TextBoxAnnot and ImageAnnot. Dynamic labels are `dynamic:`-prefixed templates materialized at placement. Pure helpers live in a new `src/lib/fillSign.ts`.

**Tech Stack:** TypeScript, React, zustand, `@cantoo/pdf-lib`, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-21-fill-sign-dynamic-stamps-design.md`

## Global Constraints

- No package installs of any kind (`AGENTS.md`); test with `npm test -- <file>`, full suite `npm test`, typecheck `npm run typecheck`.
- Every user-visible string: English key in code, German entry in `src/locales/de/ui.ts` (placeholders `{…}` must survive; `tests/locales.test.ts` checks).
- Match the surrounding code style (2-space indent, single quotes, semicolons, comments explain why).
- Branch `fill-sign-stamps` in this worktree. Never push; commit locally per task with the exact messages below. Never run `git checkout`/`reset`/`rebase`/`stash`.
- Never touch `.npmrc`, `osv-scanner.toml`, `scripts/supply-chain/`, `.github/`, `package.json`, `package-lock.json`.
- Do not run `npm run corpus`, the perf scripts, `npm audit`, or a dev server.

## Review Focus

1. A saved file with a check mark re-opens with the mark intact — in our own files through the private dict, in other programs' files through `/Name`. Round-trip test in Task 2.
2. A check placed on a rotated page must not come out sideways: the glyph is drawn in the stamp's own frame via `frameGeom`, like the boxed label. Verify the code path uses `frameGeom(g, a.rot)`; pinned by the existing stamp rotation handling, add no new geometry.
3. The date must not use `Intl`: month names differ per ICU build, so tests would flake. Hand-rolled format in Task 3, tested exactly.
4. A dynamic stamp placed twice shows two different dates (placement time, not document open time): materialization happens in the placement handler, never in a selector. Test in Task 4.
5. German strings must exist for every new English key — `tests/locales.test.ts` catches missing entries only if the key is added to `de/ui.ts`; run it in Task 5.

---

### Task 1: The pure helpers in `src/lib/fillSign.ts`

**Files:**
- Create: `src/lib/fillSign.ts`
- Test: `tests/fillSign.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `export type SignMarkKind = 'check' | 'cross';`
  - `export const SIGN_MARK_NAMES: Record<SignMarkKind, string>` → `{ check: 'Checkmark', cross: 'Cross' }` (the `/Name` other viewers see).
  - `export function formatSignedDate(lang: string | undefined, now?: Date): string` — de: `21.11.2026`, en: `Nov 21, 2026` (month abbreviations `Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec`, day not zero-padded in en).
  - `export function materializeStampLabel(template: string, author: string, lang: string | undefined, now?: Date): string` — a template starting with `dynamic:` becomes `` `${base} – ${author} – ${formatSignedDate(lang, now)}` `` (en dash U+2013); anything else passes through unchanged.

- [x] **Step 1: Write the failing tests** in `tests/fillSign.test.ts` (new file, `import { describe, expect, it } from 'vitest';`):

```ts
import { formatSignedDate, materializeStampLabel, SIGN_MARK_NAMES } from '../src/lib/fillSign';

const day = new Date(2026, 10, 21); // months are 0-based

it('formats the date per language, without Intl', () => {
  expect(formatSignedDate('de', day)).toBe('21.11.2026');
  expect(formatSignedDate('en', day)).toBe('Nov 21, 2026');
  expect(formatSignedDate(undefined, day)).toBe('Nov 21, 2026');
});

it('materializes dynamic stamp labels, passes others through', () => {
  expect(materializeStampLabel('dynamic:Approved', 'Jane Doe', 'de', day)).toBe('Approved – Jane Doe – 21.11.2026');
  expect(materializeStampLabel('dynamic:Reviewed', 'Guest', 'en', day)).toBe('Reviewed – Guest – Nov 21, 2026');
  expect(materializeStampLabel('Approved', 'Jane Doe', 'de', day)).toBe('Approved');
});

it('names the marks as other editors expect', () => {
  expect(SIGN_MARK_NAMES).toEqual({ check: 'Checkmark', cross: 'Cross' });
});
```

- [x] **Step 2: Run `npm test -- tests/fillSign.test.ts` — expect FAIL** (module does not exist).

- [x] **Step 3: Implement the three exports** exactly as specified above (no `Intl`, no locale data files).

- [x] **Step 4: Run `npm test -- tests/fillSign.test.ts` — expect PASS.**

- [x] **Step 5: Commit**

```bash
git add src/lib/fillSign.ts tests/fillSign.test.ts
git commit -m "Fill & Sign helpers: mark names, date format and dynamic stamp labels"
```

### Task 2: Check and cross as stamp kinds, in the file and back out

**Files:**
- Modify: `src/lib/types.ts` (StampAnnot)
- Modify: `src/lib/appearance.ts` (case `'stamp'`)
- Modify: `src/lib/annotIO.ts` (writeNativeAnnotation stamp case, fromStandard stamp case)
- Test: `tests/fillSign.test.ts`

**Interfaces:**
- Consumes: `SIGN_MARK_NAMES` (Task 1); `frameGeom`, `pdfRectToView`, `viewToPdf` (existing, appearance.ts); the existing stamp appearance case at `src/lib/appearance.ts:465`.
- Produces: `StampAnnot.kind?: 'check' | 'cross'` (types.ts, field comment: "Fill & Sign mark drawn as a vector glyph instead of the boxed label"); the private `/AwesomePDF` dict carries `kind` automatically (the model is JSON-serialized — no annotIO change needed for our own files).

- [x] **Step 1: Write the failing round-trip test** in `tests/fillSign.test.ts` (pattern: build a document with pdf-lib, write the annotation, save, reload, import):

```ts
import { PDFDocument } from '@cantoo/pdf-lib';
import { importAnnotations, writeNativeAnnotation } from '../src/lib/annotIO';
import { drawContext } from '../src/lib/pdfOps';
import type { PageGeom } from '../src/lib/types';

const g: PageGeom = { view: [0, 0, 300, 200], rotation: 0 };

it('writes a check as a named stamp and reads it back as a stamp kind', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]);
  const ctx = await drawContext(doc);
  const a = { id: 'x1', type: 'stamp', kind: 'check', rect: { x: 40, y: 80, w: 18, h: 18 }, label: 'Check', color: '#2e7d32', opacity: 1, author: 'A', createdAt: 0, rot: 0 } as const;
  await writeNativeAnnotation(ctx, doc.getPages()[0], g, a);
  const bytes = await doc.save();
  const back = await PDFDocument.load(bytes);
  const res = await importAnnotations(back, [g], () => 'n1');
  expect(res.count).toBe(1);
  expect(res.annotations[0][0]).toMatchObject({ type: 'stamp', kind: 'check', name: 'Checkmark' });
});

it('maps another program\'s Checkmark stamp without an appearance to a check', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  page.node.set(PDFName.of('Annots'), doc.context.obj([
    doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [10, 10, 28, 28], Name: 'Checkmark', T: PDFHexString.fromText('B'), F: 4 })),
  ]));
  const res = await importAnnotations(doc, [g], () => 'n2');
  expect(res.annotations[0][0]).toMatchObject({ type: 'stamp', kind: 'check' });
});
```

(Adjust imports/types to what the file already imports; `PDFName`/`PDFHexString` come from `@cantoo/pdf-lib` as in other tests.)

- [x] **Step 2: Run `npm test -- tests/fillSign.test.ts` — expect the new tests FAIL.**

- [x] **Step 3: Model**: add `kind?: 'check' | 'cross'` to `StampAnnot` in `src/lib/types.ts`.

- [x] **Step 4: Appearance**: in `appearance.ts` case `'stamp'`, right after the `a.appearance` branch, add a `kind` branch: `const fg = frameGeom(g, a.rot); const v = pdfRectToView(fg, a.rect); const w = Math.max(1.5, Math.min(v.width, v.height) * 0.14);` then for `check` one polyline through the view points `(0.2w, 0.55h) (0.38w, 0.8h) (0.85w, 0.2h)` of the rect, for `cross` two polylines `(0.2w, 0.2h)–(0.8w, 0.8h)` and `(0.8w, 0.2h)–(0.2w, 0.8h)`, each drawn with `c.polyline(points.map(p => viewToPdf(fg, p)), { color: a.color, width: w, opacity: op })` — mirror how the note's bubble is drawn just below. If `c.polyline` supports a round cap option (check `src/lib/render/draw.ts`), set it; otherwise leave the defaults.

- [x] **Step 5: Export**: in the `'stamp'` case of `writeNativeAnnotation` (annotIO.ts), when `a.kind` is set, set `/Name` to `SIGN_MARK_NAMES[a.kind]` (import from `./fillSign`); keep the existing name/label handling untouched otherwise.

- [x] **Step 6: Import**: in the stamp branch of `fromStandard` (annotIO.ts), when the `/Name` text is `Checkmark` or `Cross`, include `kind: 'check' | 'cross'` in the returned stamp (label stays whatever that branch already derives).

- [x] **Step 7: Run `npm test -- tests/fillSign.test.ts` — expect PASS.**

- [x] **Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/appearance.ts src/lib/annotIO.ts tests/fillSign.test.ts
git commit -m "Fill & Sign: check and cross marks as vector stamp kinds"
```

### Task 3: The four tools on the page

**Files:**
- Modify: `src/lib/types.ts` (Tool union)
- Modify: `src/store/store.ts` (DEFAULT_STYLES)
- Modify: `src/components/AnnotationLayer.tsx` (DRAW_TOOLS, click placement)
- Modify: `src/components/Ribbon.tsx` (Comment tab)
- Modify: `src/components/Dialogs.tsx` (SignatureDialog: "Keep as initials")
- Modify: `src/store/extras.ts` (initials storage helpers)
- Modify: `src/locales/de/ui.ts`
- Test: `tests/fillSign.test.ts` (locale coverage runs via `tests/locales.test.ts`)

**Interfaces:**
- Consumes: `formatSignedDate`, `materializeStampLabel` (Task 1); `createNote` placement pattern (`AnnotationLayer.tsx:167`); `customStamps`/`saveStamps` localStorage pattern (`contentActions.ts:335`); `useDialog` (`Dialogs.tsx:40`).
- Produces: `Tool` values `'signCheck' | 'signCross' | 'signDate' | 'signInitials'`; `savedInitials(): { src: string; width: number; height: number } | null` and `saveInitials(src: string): void` in `src/store/extras.ts` (localStorage key `awesome-pdf.initials`, JSON `{ src, width, height }`; `saveInitials` measures nothing — width/height come from the dialog's cropped image).

- [x] **Step 1: Model and styles.** Add the four `Tool` values to the union in `types.ts` (with short doc comments: check/cross = vector marks, date = text box with today's date, initials = saved initials image). Add four `DEFAULT_STYLES` entries in `store.ts` after `stamp`: `signCheck { color: '#2e7d32', fill: null, width: 2, opacity: 1, fontSize: 12, stampLabel: '' }`, `signCross { color: '#e53935', … }`, `signDate { color: '#111111', …, fontSize: 12 }`, `signInitials { color: '#0d47a1', …, fontSize: 12 }` (copy the entry shape from `stamp`).

- [x] **Step 2: Placement** in `AnnotationLayer.tsx`:
  - Add the four tools to `DRAW_TOOLS` (line ~38).
  - In the pointer-down handler next to the `tool === 'note'` case, add:
    - `signCheck` / `signCross`: create `{ ...base(tool), type: 'stamp', kind: tool === 'signCheck' ? 'check' : 'cross', rect: 18×18 pt centred on the click (viewToPdf of `p.x - 9`, `p.y - 9`), rot: geom.rotation, label: 'Check' | 'Cross' }`; then `setTool('select')` and `select(...)` like `createNote` does (no popup).
    - `signDate`: create `{ ...base('signDate'), type: 'text', rect: { x, y, w: 110, h: fontSize * 1.6 }, rot: geom.rotation, text: formatSignedDate(useLang.getState().lang), fontSize: styleFor('text').fontSize, border: false }`; select it, then `setPopupOpen(pageId, a.id, true, { focus: true })` like a text box deserves (mirror how new text boxes are handled two cases below).
    - `signInitials`: `const saved = savedInitials();` — if it returns an image, place `{ ...base('signInitials'), type: 'image', rect: fitted to height 24 pt at the click keeping the image's aspect ratio, rot: geom.rotation, src: saved.src, signature: true }` and select; otherwise `useStore.getState().notify('Draw or type your initials with the Signature tool first (Comment › Signature).')` and `setTool('select')`.
- [x] **Step 3: Signature dialog saves initials.** In `SignatureDialog` (`Dialogs.tsx:250`): add a checkbox `Check` labelled "Keep as initials" (default on) shown above the place button; where the dialog crops/places the signature image, when the box is ticked also call `saveInitials(src)` with the cropped data URL. Find the placement handler by searching the dialog body for where the image is handed over (it builds `{ src, width, height }` — reuse exactly that object for `saveInitials`).

- [x] **Step 4: Ribbon** — in the Comment tab after the Stamp group, add:

```tsx
<Group label="Fill & Sign">
  <ToolBtn tool="signCheck" icon={<Check size={L} />} label="Check" />
  <ToolBtn tool="signCross" icon={<X size={L} />} label="Cross" />
  <ToolBtn tool="signDate" icon={<CalendarDays size={L} />} label="Date" />
  <ToolBtn tool="signInitials" icon={<PenLine size={L} />} label="Initials" />
</Group>
```

Add `Check, X, CalendarDays, PenLine` to the lucide-react import list (verify they are exported there; pick near-equivalents if a name clashes with an existing import).

- [x] **Step 5: German strings** in `src/locales/de/ui.ts`: `Check: 'Häkchen'`, `Cross: 'Kreuz'`, `Date: 'Datum'`, `Initials: 'Paraphe'`, `'Fill & Sign': 'Ausfüllen & Signieren'`, `'Draw or type your initials with the Signature tool first (Comment › Signature).': 'Zeichne oder tippe deine Paraphe zuerst mit dem Signaturwerkzeug (Anmerkungen › Signatur).'`, `'Keep as initials': 'Als Paraphe behalten'`.

- [x] **Step 6: Run `npm test` — all green** (the locales test now covers the new keys; nothing else should have moved).

- [x] **Step 7: Commit**

```bash
git add src/lib/types.ts src/store/store.ts src/components/AnnotationLayer.tsx src/components/Ribbon.tsx src/components/Dialogs.tsx src/store/extras.ts src/locales/de/ui.ts
git commit -m "Fill & Sign tools: check, cross, date and initials on the page"
```

### Task 4: Dynamic stamps

**Files:**
- Modify: `src/components/Ribbon.tsx` (stamp menu)
- Modify: `src/components/AnnotationLayer.tsx` (materialize at placement)
- Test: `tests/fillSign.test.ts` (already covered by Task 1's materialize tests; this task is wiring only — verify with typecheck)

**Interfaces:**
- Consumes: `materializeStampLabel` (Task 1); the stamp placement at `AnnotationLayer.tsx:271-273`; the stamp menu at `Ribbon.tsx` (Group "Stamp", `STAMPS.map(...)`).

- [x] **Step 1: Menu** — in the stamp tool's `menu()` in Ribbon.tsx, after the `STAMPS.map(...)` spread, insert a dynamic section:

```tsx
...['Approved', 'Reviewed', 'Received'].map((l): MenuItem => ({ label: `${l} (dynamic)`, checked: stampLabel === `dynamic:${l}`, onClick: () => { usePendingStamp.setState({ stamp: null }); S().setStyle('stamp', { stampLabel: `dynamic:${l}` }); S().setTool('stamp'); } })),
null,
```

- [x] **Step 2: Placement** — in AnnotationLayer.tsx change the stamp creation label to `label: materializeStampLabel(st.stampLabel || 'Approved', useStore.getState().author, useLang.getState().lang)` (import `materializeStampLabel` from `../lib/fillSign` and `useLang` from `../lib/i18n` — check what the file already imports).

- [x] **Step 3: German strings**: `'Approved (dynamic)': 'Genehmigt (dynamisch)'`, `'Reviewed (dynamic)': 'Geprüft (dynamisch)'`, `'Received (dynamic)': 'Eingegangen (dynamisch)'` in `de/ui.ts`.

- [x] **Step 4: Run `npm run typecheck` and `npm test` — green. Commit:**

```bash
git add src/components/Ribbon.tsx src/components/AnnotationLayer.tsx src/locales/de/ui.ts
git commit -m "Dynamic stamps: author and date fill in when the stamp is placed"
```

### Task 5: Roadmap and README

**Files:**
- Modify: `ROADMAP.md`
- Modify: `README.md`

- [x] **Step 1: ROADMAP.md** — Next up item 4 becomes ✅ with one sentence naming the four tools and the dynamic variants. Update the rows "Create Customized Dynamic Stamps (and via JavaScript console)" (section 3) and "Create Customized Dynamic Stamps" (section 16) to 🟡 with the note "(dynamic variants of standard stamps; no appearance editor)".

- [x] **Step 2: README.md** — find the paragraph describing stamps/comments in the feature list and add one or two sentences: check, cross, date and initials for forms without fields, and dynamic stamps that fill in name and date.

- [x] **Step 3: Commit**

```bash
git add ROADMAP.md README.md
git commit -m "Roadmap and README: fill & sign tools and dynamic stamps"
```

### Task 6: Final verification

- [x] **Step 1:** `npm run typecheck` — no errors.
- [x] **Step 2:** `npm test` — the whole suite passes.
- [x] **Step 3:** `npm run build` — succeeds.
- [x] **Step 4:** Check off every box in this plan as it was completed (this file is committed, so just commit the checked version with `git commit -am "Plan: mark completed tasks"` — or fold the check-offs into each task's commit as you go, whichever happened).
