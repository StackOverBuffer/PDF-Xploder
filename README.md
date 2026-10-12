# Awesome PDF

A browser-based PDF editor aiming for feature parity with **PDF-XChange Editor**.
Everything runs client-side: documents are never uploaded anywhere.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (geometry + PDF operations)
npm run build      # production build in dist/
```

Click **Try a sample** on the start screen for a document with text, a form and bookmarks.

## Architecture

| Layer | Where | What |
| --- | --- | --- |
| Rendering | `src/lib/pdfjs.ts`, `src/components/PageView.tsx` | [pdf.js](https://mozilla.github.io/pdf.js/) renders pages to canvas plus a selectable text layer. Pages are rendered lazily as they scroll into view. |
| Editing | `src/lib/pdfOps.ts` | [pdf-lib](https://pdf-lib.js.org/) implements every document change as `bytes → bytes`: page operations, watermarks, headers/footers, metadata, forms and flattening annotations on export. DOM-free and unit-tested. |
| State | `src/store/store.ts` | A zustand store holding the PDF bytes, a stable id per page and the annotations keyed by page id, so annotations follow their page through reorders. Every change pushes an immutable snapshot for undo/redo. |
| Commands | `src/store/commands.ts` | User-level actions (save, rotate, redact, …) that glue the UI, store and operations together. |
| Annotations | `src/components/AnnotationLayer.tsx` | An SVG overlay per page for drawing, selecting, moving and resizing annotations. |

Annotation geometry is stored in **PDF user space**. `src/lib/geometry.ts` maps it to the
rotated, scaled screen view and back, so annotations stay attached to content when pages are
rotated or cropped. Text, stamps, images and text markup also remember the page rotation they were
created at, and turn with the page like printed content would.

## Feature status vs. PDF-XChange Editor

✅ done · 🟡 partial · ⬜ not started

### View & navigate
- ✅ Continuous scrolling, lazy page rendering, HiDPI canvases
- ✅ Zoom in/out, presets, fit width, fit page, Ctrl+wheel zoom
- ✅ Hand (pan) and select tools, text selection & copy
- ✅ Page thumbnails, bookmarks (outline) pane, comments pane
- ✅ Find text with match list, next/previous, match case, highlight all matches
- ✅ Go to page, first/previous/next/last, keyboard shortcuts
- ⬜ Single-page / two-page / facing layouts, rotate view (without changing the file)
- ⬜ Clickable links and an interactive annotation layer for existing PDF annotations
- ⬜ Multiple documents in tabs, split view, full-screen / presentation mode

### Comment & markup
- ✅ Highlight, underline, strikeout from a text selection
- ✅ Pencil (freehand), rectangle, ellipse, line, arrow (Shift to constrain)
- ✅ Text box (typewriter) with inline editing, sticky notes
- ✅ Stamps (Approved, Draft, Confidential, … or custom text)
- ✅ Select, move, resize, restyle (colour, fill, thickness, opacity, font size), delete
- ✅ Comment text and author on every annotation; comments list
- ✅ Flatten annotations into page content
- 🟡 Export: annotations are flattened into the page on save; sticky notes are written as real PDF `/Text` annotations with an appearance stream
- ⬜ Save other markups as native, editable PDF annotations (`/Highlight`, `/Ink`, `/FreeText`, …)
- ⬜ Import and edit annotations already present in a PDF
- ⬜ Callouts, polygons, polylines, clouds, measurement tools (distance, perimeter, area)
- ⬜ Comment replies/status, summarize comments, import/export FDF/XFDF

### Organize pages
- ✅ Rotate, delete, duplicate, insert blank pages
- ✅ Insert pages from other PDFs, combine files (drop several PDFs at once)
- ✅ Reorder by drag and drop in thumbnails (multi-select with Ctrl/Shift), reverse order
- ✅ Extract pages to a new file, split every N pages
- ✅ Crop pages (margins measured as displayed)
- ⬜ Resize pages / change page boxes, N-up, interleave/merge odd–even scans

### Edit content
- ✅ Add text boxes, images and signatures (draw, type, or upload)
- ✅ Watermarks (text, size, colour, opacity, angle, page range)
- ✅ Headers/footers with page numbers, dates, title and Bates numbering
- ⬜ Edit existing page text and images in place
- ⬜ Background colours/images, add shapes as page content (non-annotation)
- ⬜ Unicode fonts for added text (currently the PDF standard fonts, so non-Latin characters become `?` on export)

### Forms
- ✅ Fill text fields, checkboxes, radio groups, dropdowns and list boxes
- ✅ Flatten forms
- ⬜ Fill fields directly on the page
- ⬜ Design forms (create/edit fields), JavaScript actions, calculations

### Protect & sign
- ✅ Secure redaction: marked pages are flattened and rasterised so the underlying text and graphics are really removed
- ✅ Visual signatures
- 🟡 Password-protected PDFs open read-only (pdf-lib cannot write encrypted files)
- ⬜ Encrypt with passwords/permissions, remove security
- ⬜ Certificate-based digital signatures and signature validation
- ⬜ Search & redact, sanitize document (metadata, hidden data)

### Document & output
- ✅ New blank document, open (picker or drag & drop), save, save as, print
- ✅ Document properties (title, author, subject, keywords, creator, producer)
- ✅ Export the current page as PNG
- ⬜ Export to other image formats / Office formats, optimize/compress, PDF/A
- ⬜ OCR for scanned documents
- ⬜ Persist annotations in progress (e.g. IndexedDB autosave)

## Keyboard shortcuts

`Ctrl+O` open · `Ctrl+S` save · `Ctrl+P` print · `Ctrl+Z`/`Ctrl+Y` undo/redo · `Ctrl+F` find ·
`Ctrl+G` go to page · `Ctrl +/-/0` zoom · `Del` delete selection · `Esc` select tool ·
`V` select · `H` hand · `Shift+H` highlight · `U` underline · `K` strikeout · `P` pencil ·
`R` rectangle · `O` ellipse · `L` line · `A` arrow · `T` text box · `N` note · `S` stamp
