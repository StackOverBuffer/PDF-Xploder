# Interleave duplex scans, booklet imposition, poster and Save as PDF — design

Date: 2025-11-20 · Status: approved (human picked "go, via subagent")

## Intent and why

Roadmap "Next up" item 1: three related document-arrangement features, in one branch:

1. **Interleave** — merge a front-sides scan and a back-sides scan into one document
   (Organize tab). The counterpart (splitting into odd/even) already exists via
   Extract Pages with a subset, so only the merge direction is missing.
2. **Booklet imposition** — reorder pages so that the browser's two-sided printing
   folds the stack into a saddle-stitched booklet (Print dialog).
3. **Poster + Save as PDF** — tile one page over several sheets, and a "Save as
   PDF…" action in the Print dialog so N-up sheets, booklets and posters can be
   saved as files, not only printed.

## Goals

- Interleave with a picked file: choose which document starts, reverse the other
  file (re-fed stacks scan backs in reverse), unequal page counts keep their
  leftovers appended at the end.
- Booklet: saddle-stitch order, two pages per sheet, blanks pad the count to a
  multiple of 4; paper, orientation, margins, scaling and page borders from the
  print dialog still apply.
- Poster: the page is enlarged to cover a chosen number of sheet columns; rows
  follow from the page height; neighbouring tiles may overlap (mm). Nothing is
  cropped, no gaps appear.
- Save as PDF: downloads the exact sheet layout the print preview shows, with a
  telling file name.

## Non-goals / anti-goals

- No signature signatures, no divide-pages, no booklet per-signature sizes
  (8/16/32-page signatures for professional printing) — plain saddle-stitch only.
- No new npm dependencies; everything builds on `printLayout.ts`,
  `organize.ts`/`arrange`, pdf-lib and existing helpers.
- The browser's print dialog keeps handling duplex, copies and printer choice.

## Constraints

- `AGENTS.md`: never run package installs; `npm test` / `npm run typecheck` only.
- Every user-visible string needs an English source and a German translation
  (`src/locales/de/*.ts`, keyed by the English text).
- Pure, testable logic lives in `src/lib/`; store commands and dialogs stay thin.

## Approaches considered

- **A (chosen): extend the existing seam.** `PrintOptions` gains an
  `imposition` field; `planSheets` dispatches to the existing grid (none), a
  booklet ordering fed through the same grid math, and a poster planner that
  emits clipped placements `buildPrintPdf` already crops. Interleave is a pure
  layout function fed to the existing `arrange`. Everything (preview, print,
  save) flows through the one options object.
- **B: separate dialogs per output** (booklet dialog, poster dialog, N-up save
  dialog). Rejected: duplicates the option plumbing (paper, margins, scaling)
  and the preview three times.
- **C: booklet as a page-reorder command** producing a new document. Rejected:
  users would then have to print it 1-up themselves and the print preview could
  not show the imposed result; PDF-XChange puts booklet in the print dialog too.

## Decisions

- Booklet ignores Subset and Reverse order (hidden in the dialog); it binds the
  chosen page scope as given.
- Poster derives rows from the scaled height (user picks columns 1–10 and the
  overlap); sheets use the chosen paper, portrait unless "landscape" is picked.
- `Save as PDF…` is disabled exactly when `Print…` is (no pages), and for a
  plain 1-up document saves the current document bytes (no re-layout).
- File name: `<document> (booklet).pdf`, `… (poster).pdf`, `… (2-up).pdf`,
  plain `… .pdf`.
- Three feature commits + one roadmap/README commit, on branch
  `interleave-booklet-poster`.

## What's left to the builder

Exact signatures, formulas and test lists are in
`docs/superpowers/plans/2025-11-20-interleave-booklet-poster.md`. German wording
is the implementer's call (suggestions are in the plan); idiomatic style follows
the surrounding files.
