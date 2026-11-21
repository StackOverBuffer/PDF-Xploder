# Image export formats and rasterize pages implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roadmap item 7 — export pages as PNG/JPEG/WebP/TIFF (one file or ZIP) and rasterize pages in place.

**Architecture:** A pure TIFF encoder in `src/lib/tiff.ts` over RGBA pixels; the store command `exportPageImages` renders pages with the existing `renderToCanvas`/`exportWithAnnotations` pipeline and either downloads one blob or packs a ZIP with `lib/zip.ts`; a new dialog collects pages/format/DPI/quality. Rasterize reuses the `applyRedactions` machinery (render → PNG → `replacePagesWithImages`) without the redaction specifics.

**Tech Stack:** TypeScript, React, zustand, `@cantoo/pdf-lib`, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-21-image-export-rasterize-design.md`

## Global Constraints

- No package installs of any kind (`AGENTS.md`); test with `npm test -- <file>`, full suite `npm test`, typecheck `npm run typecheck`.
- Every user-visible string: English key in code, German entry in `src/locales/de/ui.ts` (placeholders `{…}` must survive; `tests/locales.test.ts` checks).
- Match the surrounding code style (2-space indent, single quotes, semicolons, comments explain why).
- Branch `image-export` in this worktree. Never push; commit locally per task with the exact messages below. Never run `git checkout`/`reset`/`rebase`/`stash`.
- Never touch `.npmrc`, `osv-scanner.toml`, `scripts/supply-chain/`, `.github/`, `package.json`, `package-lock.json`.
- Do not run `npm run corpus`, the perf scripts, `npm audit`, or a dev server.

## Review Focus

1. A TIFF written here must open in mainstream viewers: the structural test in Task 1 pins header, tag order (ascending), strip counts and resolution tags.
2. Exported images must show the page as the user sees it, comments included — `exportPageImages` follows `exportPageImage` (commands.ts:315) and exports annotations first. Pinned by code review, no node test possible (canvas is browser-only).
3. Rasterizing a page with comments must not lose those comments: they are flattened into the image first (like redactions do). Pinned by reading the implementation against `applyRedactions` (commands.ts:381) — no node test possible.
4. WebP on a browser without WebP encoding must not produce a zero-byte download: the dialog disables the option (Task 2, verified by reading the guard — no harness for dialogs).
5. Very large DPI (600 on A3) must not produce a canvas bigger than the browser allows: clamp the scaled canvas area to the same limit the renderer already enforces (`IMAGE_MAX_AREA_BYTES` in `src/lib/render/protocol.ts`) or document the failure path — decide when implementing Task 2 and note it in the code comment.

---

### Task 1: The TIFF encoder

**Files:**
- Create: `src/lib/tiff.ts`
- Test: `tests/tiff.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `export interface TiffOptions { dpi?: number; grayscale?: boolean; }` (dpi default 72)
  - `export function encodeTiff(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray, o: TiffOptions = {}): Uint8Array`
  - Baseline TIFF, little-endian (`II`, 42), single uncompressed strip, tags in ascending order: 256 ImageWidth, 257 ImageLength, 258 BitsPerSample (SHORT×3 external for RGB, inline for grey), 259 Compression=1, 262 Photometric (2 RGB / 1 BlackIsZero), 273 StripOffsets, 277 SamplesPerPixel, 278 RowsPerStrip=height, 279 StripByteCounts, 282/283 X/YResolution (RATIONAL dpi/1), 296 ResolutionUnit=2.
  - Grey: luma `Math.round(0.299 r + 0.587 g + 0.114 b)`; if `src/lib/greyscale.ts` exports a luma helper, reuse it instead of a private copy (check first).
  - Note (builder): `greyscale.ts` does export `luma`, but only over 0–1 components, and importing it would pull the whole greyscale/optimize graph (pdf-lib, image codecs) into the eagerly loaded bundle — `greyscale` is deliberately lazy-loaded today (Ribbon imports `cleanupCommands` on first use). So the encoder keeps the three weights local, with a comment pointing at `greyscale.ts`, to honour the "Consumes: nothing (pure module)" contract above.

- [x] **Step 1: Write the failing tests** in `tests/tiff.test.ts` with a small reader that walks the IFD:

```ts
import { describe, expect, it } from 'vitest';
import { encodeTiff } from '../src/lib/tiff';

function ifd(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(dv.getUint8(0)).toBe(0x49); expect(dv.getUint8(1)).toBe(0x49); // II
  expect(dv.getUint16(2, true)).toBe(42);
  const count = dv.getUint16(8, true);
  const tags = new Map<number, { type: number; count: number; value: number | number[] }>();
  for (let i = 0; i < count; i++) {
    const at = 10 + i * 12;
    const tag = dv.getUint16(at, true), type = dv.getUint16(at + 2, true), n = dv.getUint32(at + 4, true);
    if (type === 3 && n === 1) tags.set(tag, { type, count: n, value: dv.getUint16(at + 8, true) });
    else if (type === 4 && n === 1) tags.set(tag, { type, count: n, value: dv.getUint32(at + 8, true) });
    else tags.set(tag, { type, count: n, value: -1 });
  }
  return { tags, count };
}

it('writes a little-endian baseline RGB TIFF with the expected tags', () => {
  const px = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  const tiff = encodeTiff(2, 2, px, { dpi: 300 });
  const { tags } = ifd(tiff);
  expect(tags.get(256)!.value).toBe(2);   // ImageWidth
  expect(tags.get(257)!.value).toBe(2);   // ImageLength
  expect(tags.get(259)!.value).toBe(1);   // no compression
  expect(tags.get(262)!.value).toBe(2);   // RGB
  expect(tags.get(277)!.value).toBe(3);   // SamplesPerPixel
  expect(tags.get(278)!.value).toBe(2);   // RowsPerStrip
  const strip = tags.get(273)!.value as number;
  expect(tags.get(279)!.value).toBe(12);  // 2*2*3 bytes
  expect([...tiff.slice(strip, strip + 12)]).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
});

it('grayscales with Rec.601 luma and records the resolution', () => {
  const tiff = encodeTiff(1, 1, new Uint8Array([255, 0, 0, 255]), { dpi: 150, grayscale: true });
  const { tags } = ifd(tiff);
  expect(tags.get(262)!.value).toBe(1);   // BlackIsZero
  expect(tags.get(277)!.value).toBe(1);
  expect(tags.get(279)!.value).toBe(1);   // 1 byte
  // 0.299*255 = 76 (rounded)
  const strip = tags.get(273)!.value as number;
  expect(tiff[strip]).toBe(76);
});

it('orders tags ascending and sizes one strip', () => {
  const tiff = encodeTiff(3, 2, new Uint8Array(3 * 2 * 4));
  const { count } = ifd(tiff);
  // count = number of tags, always 12 for RGB
  expect(count).toBe(12);
});
```

(If your tag set differs from the pinned 12, adjust the test to the implementation — but Photometric, Compression=1, SamplesPerPixel, StripByteCounts and the resolution tags must hold, and tags must be ascending as the spec requires.)

- [x] **Step 2: Run `npm test -- tests/tiff.test.ts` — expect FAIL** (module does not exist).

- [x] **Step 3: Implement `encodeTiff`** exactly per the interface above. Layout: 8-byte header, IFD (2-byte count, 12-byte entries, 4-byte next-IFD offset 0), then the external `BitsPerSample` array (RGB only), then the RATIONALs for X/YResolution if they do not fit inline (they never do: 8 bytes), then the pixel strip. Compute offsets; keep the code small and commented.

- [x] **Step 4: Run `npm test -- tests/tiff.test.ts` — expect PASS.**

- [x] **Step 5: Commit**

```bash
git add src/lib/tiff.ts tests/tiff.test.ts
git commit -m "TIFF encoder: baseline uncompressed RGB or greyscale with resolution tags"
```

### Task 2: Export pages as images (PNG/JPEG/WebP/TIFF, ZIP for many)

**Files:**
- Modify: `src/store/commands.ts` (generalize `exportPageImage`)
- Create: `src/components/ExportImageDialog.tsx`
- Modify: `src/components/Dialogs.tsx` (registry)
- Modify: `src/components/Ribbon.tsx` (Convert tab + File menu)
- Modify: `src/locales/de/ui.ts`
- Test: `tests/locales.test.ts` via the suite (UI-only); the format plumbing is browser-only, so correctness here is typecheck + review.

**Interfaces:**
- Consumes: `renderToCanvas`, `openPdf`, `closePdf` (`src/lib/pdfjs.ts`); `exportWithAnnotations` and `annotationsByPage` (as in `exportPageImage`, commands.ts:315-331); `zip(entries)` and `ZipEntry` (`src/lib/zip.ts:22-37`); `downloadBlob` (`src/lib/download.ts`); `targetPages()` (commands.ts:20); `Modal` and the dialog helpers of an existing small dialog (`GotoDialog`, Dialogs.tsx:228).
- Produces:
  - `export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'tiff';`
  - `export async function exportPageImages(o: { pages: number[]; format: ImageFormat; dpi: number; quality?: number }): Promise<void>` in `src/store/commands.ts` (replaces the body of `exportPageImage`, which stays as a thin wrapper `exportPageImage(page?, dpi?)` calling it with `{ pages: [page], format: 'png', dpi }` for the File-menu path).
  - `export function webpSupported(): boolean` — `document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp')` (guard `typeof document`, so node tests never touch it).
  - Dialog name `'exportImage'`.

- [x] **Step 1: Store command.** Replace the body of `exportPageImage` with the general version:

  Note (builder): `quality` arrives as a percentage (the dialog's 10–100 slider) and is divided by 100 before `canvas.toBlob`, which takes a 0–1 fraction — the plan's literal `toBlob(…, quality)` would clamp to 1 and make the slider a no-op.
  Note (builder, review focus 5): decided to clamp — `scaleFor` in `commands.ts` caps the render scale so a page's canvas stays within `IMAGE_MAX_AREA_BYTES / 4` pixels (the limit `src/lib/pdfjs.ts` already hands to pdf.js as `canvasMaxAreaInBytes`), and a toast names the reduced resolution when that happened; the TIFF records the resolution actually rendered.

```ts
const MIME: Record<ImageFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', tiff: 'image/tiff' };
const EXT: Record<ImageFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', tiff: 'tiff' };
```

Render each page once at `dpi / 72` from the annotation-flattened bytes (exactly the existing `exportPageImage` prelude); for `tiff` take `canvas.getContext('2d')!.getImageData(0, 0, c.width, c.height).data` into `encodeTiff(c.width, c.height, data, { dpi })`, for the others `await new Promise<Blob>(res => canvas.toBlob(b => res(b!), MIME[format], quality))` → `new Uint8Array(await blob.arrayBuffer())`. One page → `downloadBlob(bytes, `${base}-p${n}.${ext}`, MIME[format])`; several → `downloadBlob(zip([{ name, data }...]), `${base}-images.zip`, 'application/zip')`. Keep `reportProgress`-style feedback if the loop is long (see `applyRedactions`).

- [x] **Step 2: Dialog.** `src/components/ExportImageDialog.tsx` following the small-dialog pattern (Modal + rows): page choice (`Current page` / `Selected pages ({n})` disabled when the thumbnail selection is empty / `All pages`), format radios (PNG, JPEG, WebP — disabled with a title hint when `!webpSupported()` — TIFF), DPI number input (default 150, min 72, max 600), quality range 10–100 (default 85) shown only for JPEG/WebP. OK → `cmd.exportPageImages({ pages, format, dpi, quality })` and close. Register `'exportImage'` in the `DialogName` union and case list of `Dialogs.tsx` (direct import like `OrganizeDialogs`, or `lazy(() => import(...))` if that is the local pattern for similar dialogs — check and follow).

- [x] **Step 3: Ribbon** — Convert tab: change the "To image" button to `onClick={() => show('exportImage')}` with title "Save pages as PNG, JPEG, WebP or TIFF images". File menu: point "Save page as image" at `show('exportImage')` as well (it presets the current page — pass nothing, the dialog defaults to current page).

- [x] **Step 4: German strings** in `de/ui.ts` for every new key (labels, titles, `Current page`, `Selected pages`, `All pages`, `Resolution (DPI)`, `Quality`, `WebP is not supported by this browser.` …).

- [x] **Step 5: `npm run typecheck` and `npm test` — green. Commit:**

  Note (builder): typecheck clean; of the suite only the two OCR tests fail here, both pre-existing in this environment and untouched by this feature (`git diff b7d799d -- src/lib/ocr tests/ocr.test.ts` is empty, and their import graph does not reach any file of this change): `tests/ocrEngine.test.ts` needs symlink rights that Windows denies without developer mode (EPERM), and `tests/ocr.test.ts`'s slant assertion (0.058 vs < 0.05) depends on `@napi-rs/canvas` text rasterisation. All 39 other test files pass.

```bash
git add src/store/commands.ts src/components/ExportImageDialog.tsx src/components/Dialogs.tsx src/components/Ribbon.tsx src/locales/de/ui.ts
git commit -m "Export pages as PNG, JPEG, WebP or TIFF, one file or a ZIP"
```

### Task 3: Rasterize pages

**Files:**
- Modify: `src/store/commands.ts` (new command next to `applyRedactions`)
- Modify: `src/components/Ribbon.tsx` (Convert tab)
- Modify: `src/locales/de/ui.ts`
- Test: typecheck + suite (the pipeline is browser-only; the pure part was already tested by the redaction corpus).

**Interfaces:**
- Consumes: `applyRedactions` (commands.ts:381) as the blueprint; `ops.replacePagesWithImages` (`src/lib/pdfOps.ts:467`); `targetPages()`.
- Produces: `export async function rasterizePages(indices: number[] = targetPages(), dpi = 200)`.

- [x] **Step 1: Command.** Guard `requirePermission('modify')`; if any target page has no content the command still works (rasterizing a blank page yields a blank image — no special case). Confirm first:

```ts
if (!(await ask({ title: 'Rasterize pages', message: tf('Rasterize {n} page(s)? They become images: their text will no longer be selectable or searchable, and form fields on them are removed. Comments on those pages are burnt into the image.', { n: indices.length }), ok: 'Rasterize', danger: true }))) return;
```

Then mirror `applyRedactions`: flatten the pages' annotations into the render (`exportWithAnnotations` with `flatten: true` for the target pages' lists only), render each at `dpi / 72`, collect `{ index, png }`, `replacePagesWithImages`, drop the target pages from the model's annotations, filter `formValues` by `removedFields`, `commitBytes`, notify `Rasterized {n} page(s).`.

- [x] **Step 2: Ribbon** — Convert tab, next to "Extract images": `<Btn icon={<Frame size={L} />} label="Rasterize" title="Turn the selected pages into images (text, fields and comments become part of the picture)" disabled={!canModify} onClick={() => cmd.rasterizePages()} />` (pick `Frame` or another unused lucide icon; add it to the import list).

- [x] **Step 3: German strings**: `'Rasterize': 'Zu Bild umwandeln'`, `'Rasterize pages': 'Seiten in Bilder umwandeln'`, and the confirmation string above.

- [x] **Step 4: `npm run typecheck` and `npm test` — green. Commit:**

  Note (builder): the render reuses Task 2's `scaleFor` clamp, so a large `dpi` argument cannot overshoot the browser's canvas limit either.

```bash
git add src/store/commands.ts src/components/Ribbon.tsx src/locales/de/ui.ts
git commit -m "Rasterize pages: render them and replace their content with the image"
```

### Task 4: Roadmap and README

- [ ] **Step 1: ROADMAP.md** — Next up item 7 becomes ✅ ("greyscale, sanitize, extract images, rasterize and export as JPEG/WebP/TIFF done"). Rows: "Export PDFs to WebP / TIFF Images" (section 5) → ✅; "Rasterize Pages" (section 10) → ✅.
- [ ] **Step 2: README.md** — extend the Convert/output section with one or two sentences (formats, ZIP, rasterize with the warning).
- [ ] **Step 3: Commit** `git commit -m "Roadmap and README: image export formats and rasterize"` (add the two files).

### Task 5: Final verification

- [ ] `npm run typecheck`, `npm test`, `npm run build` — all green. Check off completed steps in this plan as you go and commit the check-offs.
