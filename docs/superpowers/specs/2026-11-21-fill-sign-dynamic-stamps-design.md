# Fill & Sign and dynamic stamps — design

## Intent

Roadmap "Next up" item 4: tools to fill in printed forms that have no form fields, and
stamps whose text fills itself in at placement time, like PDF-XChange's dynamic stamps.

- **Check** and **Cross** place a vector mark with one click (for paper-style checkboxes).
- **Date** places a borderless text box with today's date, still editable like any text box.
- **Initials** places the saved initials image; if there are none yet, the user is pointed
  to the Signature dialog, which can keep an image as initials for reuse.
- **Dynamic stamps**: the stamp menu gains dynamic variants of Approved, Reviewed and
  Received that materialize `Label – author – date` at the moment they are placed.

## Goals, non-goals, anti-goals

Goals: one-click marks with the tool's own colour style; German and English UI; round trip
(our own files keep the exact model through the private /AwesomePDF dict; other viewers see
standard `/Stamp` annotations with `/Name` and an appearance stream).

Non-goals: turning marks into real form fields, an appearance editor for custom dynamic
stamps, per-document initials, JavaScript-driven dynamic stamps.

Anti-goals (would make this a failure): marks that disappear on save, marks that other
viewers render as empty boxes, dates in the wrong language.

## Approaches considered

1. **New annotation type per mark** — most explicit, but duplicates the stamp's hit
   testing, popup, deletion and export plumbing for two glyphs. Rejected.
2. **StampAnnot with an optional `kind`** (chosen) — a stamp whose appearance draws a
   vector glyph instead of the boxed label. Everything around stamps keeps working;
   the private dict round-trips the new field automatically because the model is
   serialized as JSON.
3. **Generated PNG images** — would need a canvas at placement time, is untestable in the
   node-only test suite, and scales badly. Rejected.

Date and initials reuse existing annotation kinds (TextBoxAnnot, ImageAnnot) — no new
plumbing at all.

## Decisions

- `StampAnnot.kind?: 'check' | 'cross'`; drawn in `appearance.ts` inside the rect, no box.
- Exported as `/Subtype /Stamp` with `/Name` `Checkmark` / `Cross` (map in `lib/fillSign.ts`).
- Date format, hand-rolled so tests agree everywhere: de `DD.MM.YYYY`, en `MMM D, YYYY`.
- Dynamic templates are labels with a `dynamic:` prefix, materialized when placed, using
  the UI language and the author preference (`Guest` stays `Guest`).
- Initials are saved in `localStorage` under `awesome-pdf.initials` (JSON `{src, width,
  height}`), next to how custom stamps are stored.
- The Initials tool never opens dialogs from the annotation layer: without saved initials
  it notifies and switches to Select; the Signature dialog gains a "Keep as initials"
  checkbox that saves the image when a signature is placed.

## Left to the builder

Small choices within the plan's signatures: exact vector point lists for the glyphs (the
plan pins them), line cap support if the draw API has it, icon choices for the ribbon.
