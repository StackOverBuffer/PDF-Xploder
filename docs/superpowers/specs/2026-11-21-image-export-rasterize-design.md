# Image export formats and rasterize pages — design

## Intent

Roadmap "Next up" item 7, the last open parts: export pages as JPEG, WebP or TIFF (PNG
and single-page PNG already exist) and rasterize pages (turn a page into a picture of
itself, for example to make edited content inert or to shrink vector-heavy pages).

- **Export pages as images**: current page, the thumbnail selection, or all pages; PNG,
  JPEG, WebP or TIFF; DPI choice (72–600, default 150); quality for JPEG/WebP; one file,
  or a ZIP for several pages.
- **Rasterize pages**: the selected pages (or the current page) are rendered and replace
  their own content, exactly like Apply redactions already does internally, minus the
  redaction marks.

## Goals, non-goals, anti-goals

Goals: the TIFF is a standards-reading baseline TIFF (little-endian, uncompressed, one
strip) that Photoshop, Preview, GIMP and Windows Photos open; JPEG/WebP honour the
quality setting; the ZIP reuses the existing `lib/zip.ts`; rasterized pages keep their
size and are indistinguishable in the viewer.

Non-goals: TIFF compression (LZW/Deflate), multipage TIFF, CMYK TIFF, animation/WebP in
PDFs, re-compressing existing images (that is Compress).

Anti-goals: exporting the un-annotated page when comments are visible (exports must show
what the user sees: annotations are included, as the existing PNG export does), a
rasterize that silently drops comments.

## Approaches considered

1. **TIFF via a new npm encoder** — forbidden by the dependency policy and unnecessary:
   baseline uncompressed TIFF is ~100 lines.
2. **Baseline uncompressed TIFF encoder in `lib/tiff.ts`** (chosen) — pure function over
   RGBA pixels, fully unit-testable in node without a canvas.
3. **Rasterize as "export + insert image" in the store** (chosen) — `pdfOps.replacePagesWithImages`
   already does the whole job (it is how redactions work); reuse it, burn existing
   comments into the image first so nothing is lost.

## Decisions

- `encodeTiff(width, height, rgba, { dpi?, grayscale? })` — RGB (Photometric 2) or 8-bit
  grey (Photometric 1, Rec.601 luma); X/YResolution tags carry the DPI.
- Formats: `png` (existing path), `jpeg`, `webp`, `tiff`. WebP is offered only when the
  browser can encode it (`canvas.toDataURL('image/webp')` check), with a disabled option
  and a hint otherwise.
- Multiple pages go into one ZIP named `<document>-images.zip`; a single page downloads
  directly as `<document>-p<n>.<ext>`.
- The dialog lives in `src/components/ExportImageDialog.tsx` and replaces the direct
  PNG export behind both "To image" (Convert tab) and "Save page as image" (File menu),
  preset to the current page.
- Rasterize uses DPI 200 by default (same as redactions), burns the pages' comments into
  the image (they would otherwise be dropped with the page's annotations) and warns about
  lost text, fields and comments in the confirmation dialog.

## Left to the builder

Icon choice for Rasterize, exact dialog layout within the Modal pattern, German wording.
