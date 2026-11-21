# Comment review workflow — design

## Intent

Roadmap "Next up" item 5: a review loop over comments.

- **Review status** on every comment: None, Accepted, Rejected, Cancelled, Completed,
  Reopened — set from the comments panel, shown at a glance, filterable.
- **Comment summary**: a generated PDF document listing every comment with author, date,
  status and text (and replies), laid out with the existing Markdown-to-PDF pipeline,
  opened as a new document.
- **Comments CSV** export for spreadsheets.
- FDF/XFDF import and export stays open (follow-up work).

## Goals, non-goals, anti-goals

Goals: status survives save/load round trips (our files lossless, other viewers through
the standard `/State` `/StateModel 'Review'` reply annotation); summary looks like a
document someone can attach to an email; CSV opens in Excel/LibreOffice with a BOM.

Non-goals: FDF/XFDF, status workflows beyond the six review states (no "Marked" model of
our own), changing status from the page popup, per-status colours.

Anti-goals: status that only lives in our private dict (other tools would lose it), a
summary that renders user comment text as Markdown markup.

## Approaches considered

1. **Status as a private-dict-only field** — lossless for us, invisible to Acrobat.
   Rejected: the status must survive a round trip through other editors.
2. **Status as a standard review-state reply annotation** (chosen) — exactly how Acrobat
   stores review status: a `/Text` annotation with `/IRT`, `/RT 'R'`, `/State` and
   `/StateModel 'Review'`. Our private dict strips `status` like it strips `replies`, and
   both are restored from the standard structure on import.
3. **Summary as hand-drawn pdf-lib pages** — duplicates the Markdown pipeline that already
   produces headings-as-bookmarks, links and wrapping. Rejected.

## Decisions

- `AnnotBase.status?: 'Accepted' | 'Rejected' | 'Cancelled' | 'Completed' | 'Reopened'`
  (undefined = not reviewed; the type has no `'None'` member).
- Export: after the real replies, one state dict per annotated comment: `Subtype 'Text'`,
  `IRT` → comment, `RT 'R'`, `State`, `StateModel 'Review'`, `T` = the current user
  (threaded into `exportWithAnnotations` options as `author`), `Contents` omitted, same
  `F` flags as replies. Skipped when flattening.
- Import: a reply dict with `State` + `StateModel 'Review'` sets (or, for `State 'None'`,
  clears) the root annotation's status and is removed from the file like our replies are.
  A `StateModel 'Marked'` dict is left in the file untouched and is not imported as a
  reply (it would otherwise become a ghost reply with empty text).
- The summary escapes Markdown syntax in user text (backslash-escapes) so comments render
  literally; headings and bookmarks come from the Markdown pipeline.
- CSV columns: page, type, author, date (ISO), status, text. BOM first, like the
  measurements CSV.

## Left to the builder

Wording of German strings, the exact visual of the status dropdown (a native `<select>`
is fine), where in the Review tab the new buttons sit.
