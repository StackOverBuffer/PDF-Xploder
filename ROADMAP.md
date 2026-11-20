# PDF-Xploder roadmap

The feature list of PDF-XChange Editor (and Editor Plus), and where PDF-Xploder stands on each.

✅ available · 🟡 partly available · 🔧 in progress · ⬜ planned · 🚫 not applicable to a browser app (reason given)

## Next up

Roughly in order of everyday usefulness versus effort (callouts are still open from the measure/markup group):

1. ✅ **Interleave duplex scans and booklet printing**: done (Organize › Interleave Pages… combines a front-sides and a back-sides scan, in reverse order too, for stacks that were re-fed; Print › Imposition: Booklet orders the pages so two-sided printing folds them into a saddle-stitched booklet; Poster tiles a page over several sheets with an overlap for gluing; Save as PDF stores every print layout — N-up, booklet, poster — as a file).
2. ✅ **Optimize / compress documents**: done (File › Compress, Share › Compress): presets plus custom quality and resolution, images downsampled by their resolution on the page, CMYK/JPEG 2000 images converted through pdf.js (except for the print preset), duplicate fonts and images merged, unused objects, thumbnails and metadata removed, object streams; size before and after with Undo. Still open: subsetting fully embedded fonts.
3. **Compare documents**: side by side, with changed text and changed areas marked.
4. **Fill & Sign and dynamic stamps**: checkmark, cross, date and initials tools for forms without fields; stamps like "Approved – {name} – {date}".
5. **Comment workflow**: review status (accepted, rejected…), comment summary, FDF/XFDF import and export (replies are done).
6. **Batch processing**: one action (OCR, watermark, compress, Bates numbers) on many files, results as a ZIP; later, a saved chain of several actions.
7. 🟡 **Whole-document outputs**: greyscale (Convert › Greyscale), sanitize (Protect › Sanitize) and extract all images (Convert › Extract images, as a ZIP) are done. Still open: rasterize pages, export pages as JPEG/WebP/TIFF.

## 1. New in recent PDF-XChange versions

| Feature | Status |
|---|---|
| Add Placeholder Tool | ⬜ |
| Enhanced 3D Plugin | ⬜ (3D/PRC rendering is a large separate project) |
| Enhanced Open/Save File Dialog Boxes | 🟡 system open/save dialogs; Save writes back to the opened file in Chrome/Edge (download elsewhere); drag & drop to open |
| FreeSign Tool | 🟡 signature images (drawn, typed or uploaded) as comments |
| Optimize Document Enhancements | 🟡 compress with presets (see Optimize Documents); no font subsetting or linearization yet |
| Search Feature for Files in Cloud Storage | 🚫 needs cloud accounts (see section 11) |
| Additional Improvements and Bug Fixes | — |

## 2. Accessibility

| Feature | Status |
|---|---|
| Determine the Reading Order of Documents | ⬜ |
| Perform Accessibility Checks on Documents | 🟡 quick check (tags, language, title, text, field tooltips, permissions) with fixes |
| Set Alternate Text Descriptions for Document Content | ⬜ |
| Accessibility Checker/Report Pane | 🟡 report dialog; no dedicated pane yet |
| Tags Pane to Create/View/Edit Structured PDF Information | ⬜ |

## 3. Annotate documents

| Feature | Status |
|---|---|
| 3D Comment Support | ⬜ |
| Area, Distance and Perimeter Measurement Annotations | ✅ with live values, labels on the page, standard /Measure dictionaries |
| Audio File Annotations | ⬜ |
| Callout Annotations | ⬜ |
| Caret Annotations | ⬜ |
| Cloud Annotations | ✅ scalloped border, fills like the polygon tool |
| File Attachment Annotations | 🟡 document-level attachments (pane); no attachment icon on the page yet |
| Freehand Annotations | ✅ Pencil |
| Highlight, Underline and Strikeout Annotations | ✅ from text selection, search hits or the Select Text rectangle |
| Line and Arrow Annotations | ✅ |
| Link Annotations | ✅ to pages and web addresses, from objects or selected text |
| Oval and Rectangle Annotations | ✅ |
| Polygon and Polyline Annotations | ✅ click vertices, double-click to finish; also exported as standard /Polygon and /PolyLine |
| Stamps | ✅ standard stamps and custom image stamps that hang on the pointer; stamps from other programs keep their own drawing |
| Sticky Note Annotations | ✅ |
| Text Box Annotations | ✅ |
| Typewriter Annotations | 🟡 borderless text boxes |
| Video/Sound Rich Media Annotations | ⬜ |
| Clear Measurements / convert lines, polygons, polylines and rectangles to measurements | ⬜ (with measurement tools) |
| Control the Thickness of Underline and Strikeout | ⬜ |
| Create Customized Dynamic Stamps (and via JavaScript console) | ⬜ |
| Cross Section Support for 3D PDFs | ⬜ |
| Customize/Localize the Fonts Used for Default Stamps | ⬜ |
| Export Comments to Data File (FDF/XFDF) / Export Selected Comments | ⬜ |
| Export Measurements to CSV | ✅ |
| Fit Box by Text Content | ⬜ |
| Flatten Comments | ✅ |
| Summarize Comments (with font customization) | ⬜ |
| Open All Comment Popups that Contain Text | ✅ popups on the page (double-click a comment), open/close all, saved as /Popup with position and open state |
| Comment Replies (threads) | ✅ shown, added and saved as standard /IRT replies |
| Comment Review Status | ⬜ |
| Support for Existing Screen Annotations | ⬜ |
| Inline Captions for Line/Dimension Annotations | ⬜ |
| Eraser Tool for Freehand Annotations | ⬜ |
| Thin Lines Feature | ⬜ |
| Comment Styles Palette | 🟡 per-tool colour, width, opacity, fill |
| Paragraph Properties for Annotations | ⬜ |

## 4. Bookmarks

| Feature | Status |
|---|---|
| Bookmarks Pane to View and Edit Bookmarks | ✅ add (also as child), rename, delete, drag to reorder or nest, indent/outdent, move, set destination to the current view, bold/italic/colour, keyboard navigation |
| Add from Bookmark When Setting Link Targets | ⬜ |
| Add Text to Bookmark Titles / Change Case / Find and Replace / Regex | ✅ |
| Bookmark Every Nth Page | ✅ |
| Build a Table of Contents from Bookmarks | ✅ contents pages with leader dots, page numbers and links |
| Convert Bookmark ↔ Named Destinations | ⬜ |
| Create Links from Bookmarks | ⬜ |
| Export Bookmarks to HTML / Text | ✅ |
| Generate Bookmarks from Page Text / Table of Contents / Text File | ✅ headings by font size, TOC entries with numbering/indent levels and page offset, indented text |
| Merge Duplicate Bookmarks | ✅ |
| Remove Actions from Bookmarks | ✅ |
| Remove Pages that Bookmarks Point to | ✅ from the bookmark's context menu |
| Set the Zoom Type for Bookmarks | ⬜ |
| Sort Document Pages by Bookmarks | ✅ |
| Use Selected Text to Update Bookmark Targets | 🟡 new bookmarks take the selected text as title |
| Validate Bookmarks | ✅ |
| Search Bookmark Titles (filter the tree, nested matches keep their parents) | ✅ search box in the Bookmarks pane, ignoring case and accents |

## 5. Convert documents to and from PDF

| Feature | Status |
|---|---|
| PDF to Word / Excel / PowerPoint | ⬜ |
| PDF to PDF/A / PDF/X | ⬜ |
| PDF to Plain Text | ⬜ |
| Export PDFs to WebP / TIFF Images | ⬜ (PNG/JPEG export exists) |
| Image Files to PDF | ✅ images as new pages (Organize → Insert); ⬜ HEIC, TIFF (multi-page) and SVG |
| Text, Markdown, CSV, RTF to PDF | 🟡 Markdown (GitHub flavour: tables, task lists, code, links, headings as bookmarks) and plain text, opened as new documents or inserted as pages; ⬜ CSV, RTF |
| Word, Excel, PowerPoint to PDF | ⬜ possible offline with LibreOffice compiled to WebAssembly, loaded only when used (large download) |
| Publisher, Visio to PDF | 🚫 no converter that runs in the browser |
| EPUB, CBZ (comic archives), email (EML) to PDF | ⬜ |
| Windows Metafiles / XPS to PDF | ⬜ |

## 6. Create documents

| Feature | Status |
|---|---|
| Create a New PDF File | ✅ |
| Combine Existing Files into a New PDF | ✅ open several files at once, or Merge Pages at a chosen position, with a bookmark per merged file and that file's own bookmarks nested underneath |
| Create a PDF from Clipboard Content | 🟡 insert a clipboard image as a page |
| Create a PDF from an Image File | 🟡 insert images as pages into a new document |
| Create a PDF from Text / Markdown / CSV / RTF | 🟡 Markdown and text files (File › New, Open, or drop them on the window); ⬜ CSV, RTF |
| Create a PDF from Scanned Content | 🟡 insert scans as pages and run OCR; scanner access is not available in browsers |
| Create New Documents from Web Page URLs | 🚫 cross-origin pages cannot be fetched from the browser |
| Create PDF Portfolio Files | ⬜ |
| Create PDFs from Email Files | ⬜ |

## 7. Fillable forms

| Feature | Status |
|---|---|
| Text, Check Box, Radio Button, Dropdown, List Box Fields | ✅ |
| Button, Date, Image, Barcode, Digital Signature Fields | ⬜ |
| Create/Edit Fillable Forms | ✅ Edit form mode with properties (read-only, required, locked, tooltip…) |
| Highlight Form Fields | ✅ |
| Fields Pane | ✅ |
| Reset Forms | 🟡 discard unsaved form edits |
| Rename Duplicated Form Fields | ⬜ |
| Identify Forms Automatically | ⬜ |
| Import/Export Form Data (FDF/XFDF/XML/CSV), Use CSV Files to Populate Forms | ⬜ |
| Email Form Data | ⬜ |
| Calculate / Validate Values (JavaScript) | ⬜ (run the form's scripts in a sandbox) |
| Field Tab Order | ⬜ |

## 8. User interface

| Feature | Status |
|---|---|
| Ribbon UI | ✅ PDF-XChange style tabs, groups, split buttons and menus |
| Quick Launch / search for commands | ✅ search box beside the ribbon tabs (Ctrl+K): finds every ribbon button and menu entry in English or German, shows where it lives and its shortcut, recently used first |
| Set the UI Language | ✅ German/English throughout, following the browser; ⬜ more languages (French, Spanish, …) |
| Dark Page Mode | ✅ dark interface (View → Theme: same as system, light, dark) and inverted page colours |
| Page Display Options / Default Page Layouts | ✅ single page, continuous, facing, continuous facing, cover page (View → Page layout; remembered) |
| Right-to-Left Page Layout | ⬜ |
| Tabbed Interface and Multiple Tab Groups | 🟡 document tabs (open several files, switch, reorder, close others/right/all, unsaved marker, per-tab undo, zoom and position; drag pages between tabs or onto "+" for a new document); ⬜ multiple tab groups |
| Desktop application, shell integration ("Open with", default PDF app) | ✅ installable app (own window, works offline, registered for PDFs; files opened from the system arrive as tabs in the running window) |
| Autosave/Autorecovery | ✅ open tabs and their unsaved changes are kept in browser storage and reopened at the next start (not for password-protected documents) |
| Save Current Session | ✅ restore session (File → Session), on by default |
| Customize Layout of Panes, Custom Toolbars/Ribbons, Quick Tools | 🟡 resizable side panes; pane widths, open panes and the ribbon tab are remembered; the ribbon folds groups into drop-downs in narrow windows; ⬜ custom toolbars |
| Export/Import/Reset Settings, Preferences | 🟡 Preferences dialog (theme, language, zoom when opening, author, session restore, layout reset); ⬜ export/import |
| Specify the Default Ribbon Tab | ⬜ |
| Touch-Optimized Layout | ⬜ |
| Custom Fonts for Signatures/Initials | 🟡 typed signatures |
| Launch Third-Party Applications, Browser Plugins, Per-Monitor DPI, Stroke Adjust, Vertical Toolbars | 🚫 desktop-only |

## 9. Edit documents

| Feature | Status |
|---|---|
| Edit the Base Content (text, vector objects, images) | ✅ Edit Text / Edit Objects |
| Add/Edit Document Text | ✅ |
| Arrange, Transform, Duplicate Selected Content | ✅ |
| Copy, Cut, Delete or Zoom to Selected Content | ✅ |
| Copy Base Content with Ctrl+Drag | ⬜ |
| Arrow Keys to Move Objects | ✅ (diagonal ⬜) |
| Create Custom Stamps / Stamps from Selected Content | ✅ |
| Create Documents from Selected Content | ✅ |
| Edit and Manipulate Images, Replace Images, Recompress Images | ✅ rotate, flip, greyscale, replace, recompress, save |
| Replace Images with Clipboard Content | ⬜ |
| Export Snapshots to Images from the Shortcut Menu / Take Snapshots | ✅ |
| Select Base Content Text, Multiple Word Selection Options | ✅ rectangle text selection like PDF-XChange |
| Select Highlighted Text | ⬜ |
| Find and Replace Text | ✅ replace the current match or all, match case, whole words; within one line of text, in the line's own font where possible |
| Spell Check | ✅ Spelling pane (F7) for the page text and comments: English (US/UK) and German, suggestions, change/change all, ignore, personal dictionary; the browser checks text while typing |
| Correct Text with the Text Correction Tool | 🟡 inline text editing |
| Font Replacement | 🟡 change the font of text objects |
| Enhanced Colour Options for Objects | 🟡 fill/stroke colours |
| Text List Formatting, Tab Stops, Overtype | ⬜ |
| Paragraph editing with reflow across lines, editing inside form XObjects, editing path points, convert text to curves | ⬜ |
| Paste Copied Text as Plain Text / Paste Options | 🟡 paste objects, paste in place |
| Crop Pages, Partial Cropping, Crop to White Margins | ✅ |
| Delete, Duplicate, Extract, Insert, Move, Rotate, Reverse, Split Pages | ✅ (also copy pages between open documents by dragging thumbnails onto another tab) |
| Interleave Pages (combine separately scanned front and back sides) | ✅ with a file, in reverse order too; leftover pages of the longer document are appended |
| Booklet Imposition | ✅ saddle-stitch in the print dialog (two pages per sheet, blanks padded to a multiple of 4); saved as a file too |
| Posterize (tile a large page over several sheets), Divide Pages (cut each page in halves/quarters) | 🟡 poster: the page enlarged over a chosen number of sheet columns, rows as needed, overlap for gluing, printed or saved; ⬜ divide pages |
| Rotate Pages by Any Angle (straighten scans) | ⬜ (90° steps and deskew with OCR exist) |
| Delete Empty Pages, Merge, Normalize, Overlay, Replace, Resize, Swap Pages, Set Margins, Split by Size | ✅ |
| Normalize Media Box Offsets | ✅ |
| Split Pages by Guide Lines | ⬜ |
| Select Pages Options for Thumbnails | 🟡 multi-select with Ctrl/Shift |
| Redact Documents | ✅ |
| Find and Redact, Redaction Code Sets, Blurred/Pixelated Overlays | 🟡 find and redact (exact boxes around every match); ⬜ code sets, blurred/pixelated overlays |
| Sanitize Documents | ✅ scripts (JavaScript, launch actions, XFA), form submission and remote actions, attachments, metadata, thumbnails and private data, each optional |
| Compare Documents | ⬜ |
| Layers Pane, Add/Edit/Merge/Remove/Reorder Layers, Links to Layers, Flatten Layers | 🟡 objects can be moved to existing or new layers; ⬜ layers pane |
| Attachments, Comments, Signatures, Thumbnails, Properties Panes | ✅ |
| Content, Destinations, Links, History, 3D Model Tree Panes | ⬜ |
| Guides, Rulers, Grid, Snapping | ⬜ |
| Format Tab | 🟡 properties panel |
| Correct/Deskew Scans, Draw Lines for Tables in OCR, Updated OCR Engine | ✅ |
| Rename Documents | ⬜ |
| Insert RTF/Text Files | ⬜ |
| Shrink Page Content in Headers/Footers/Bates | 🟡 resize pages / add margins first |
| Simultaneous Editing of Identical Images | ⬜ |
| Edit PDF Portfolios | ⬜ |
| Export Content to MS Office Formats | ⬜ |
| Macros | ⬜ |
| Multiple Document Windows | 🟡 several documents in tabs (one window) |
| Edit in Third-Party Applications | 🚫 desktop-only |

## 10. Enhance documents

| Feature | Status |
|---|---|
| Add/Remove Watermarks | ✅ |
| Add Backgrounds | ✅ colour or image, removable |
| Add Barcodes | ✅ QR code, Code 128, EAN-13 (placed like a stamp) |
| Add JavaScript | ⬜ |
| Convert Document Colours | 🟡 greyscale: page content, forms, comment appearances, gradients and images; ⬜ other colour conversions, spot colours |
| Deskew / Enhance Scanned Pages | 🟡 deskew with OCR; ⬜ enhance |
| Rasterize Pages | ⬜ |
| Recompress Document Images | ✅ whole document (File › Compress) or one image (context menu) |
| View/Edit Document Properties | ✅ |

## 11. Cloud services

| Feature | Status |
|---|---|
| OneDrive, SharePoint, Box, Dropbox, Google Drive | ⬜ possible via each provider's file picker API (needs registered app keys) |

## 12. Manipulate documents

| Feature | Status |
|---|---|
| Add Images | ✅ as comments or page content |
| Add/Remove Bates Numbering, Headers and Footers | ✅ |
| Create Number Ranges (page labels) | ✅ |
| Crop Documents | ✅ |
| Digitally Sign | ✅ PKCS#12 certificates, visible or invisible |
| Email Documents | 🟡 system share sheet where supported |
| Export Documents to Images | ✅ PNG |
| Export Links to CSV | ⬜ |
| Find / Search Text | ✅ |
| Move Content Items to a Selected Layer | ✅ |
| Import Pages to a Layer | ⬜ |
| Open Documents from a URL | ⬜ (works for servers that allow CORS) |
| Optimize Documents | 🟡 compress: recompress and downsample images, merge duplicates, remove unused objects, thumbnails and metadata, object streams; linearize for fast web view and repair damaged files still open |
| Print Documents | ✅ print dialog with preview: all / current / selected pages or a range, odd/even subset, reverse order, with or without comments, paper size and orientation, margins, fit / shrink / actual size / custom scale, 1–16 pages per sheet (horizontal or vertical order, page borders), booklet imposition for two-sided printing, poster tiling with overlap, Save as PDF for every layout; printer, copies and duplex in the browser's dialog |
| Autoscroll, Playback, Page Transitions, Full-Screen Mode | ⬜ |
| Split the Page View, Spreadsheet Split | 🟡 split view side by side or one above the other, each pane with its own zoom and position; ⬜ spreadsheet split (four panes) |
| Loupe Tool, Pan and Zoom Pane | ⬜ |
| Zoom Features | ✅ zoom box, presets, fit width/page, Zoom tool, rotate view |
| Calibrate Measurement Scales | ✅ drawing scale 1:n or calibration from a line of known length; applies to existing measurements |
| History Pane / Recent Documents | 🟡 recent files (start screen, File → Recent); ⬜ history pane |
| Webcam Images | ⬜ |
| Print All Open Documents, External Repositories, UI Automation | 🚫 desktop-only |

## 13. Miscellaneous

| Feature | Status |
|---|---|
| Add Signatures to Multiple Pages | ⬜ |
| Custom Document Properties, Advanced Metadata, Import/Export Metadata, Templates | 🟡 standard properties |
| Fonts and Security in Document Properties (every font, embedded or not; encryption method and each permission) | ✅ |
| Change Text Case Commands | ⬜ |
| Colorize Documents | ⬜ |
| Distribute Objects Horizontally/Vertically | ✅ |
| Edit the Layer Property of Images and XForms | ✅ |
| Find Duplicate Pages | ✅ by content or appearance |
| Generate Links from Barcodes | ⬜ (barcode recognition exists, Chrome on macOS/Android/ChromeOS) |
| Go to Next/Previous Bookmark Using Hotkeys | ✅ Alt+PageDown / Alt+PageUp |
| Password Strength Indicator | ⬜ |
| Remove Broken Named Destinations | ⬜ |
| Resize Pages to Match Existing Page Sizes | ✅ |
| Right-to-Left Text | ⬜ |
| Specify the Visibility of New Watermarks | ⬜ |
| Translate Documents | ⬜ |
| Type Your Signature | ✅ |
| Word Count / Document Statistics | ⬜ |
| Automation for scripts and AI agents (MCP server) | ⬜ the editing code in `src/lib/` is DOM-free (`bytes → bytes`), so a Node command-line tool and an opt-in MCP server over stdio can reuse it: open, inspect, extract text, organize pages, comment, fill forms, protect, save. Later, tools in the open app through WebMCP where browsers support it |
| Corpus test in CI (open, render and save the pdf.js test files; check saved files with qpdf) | ✅ all ~1,100 files in the pdf.js repository: every page drawn, comments imported, saved, reopened and checked with qpdf, in about 2 minutes; new problems fail CI (`scripts/corpus/`) |
| Continuous Zoom | ✅ Ctrl+wheel |
| Shell extensions, Terminal Server, command line, ARM64, Windows 11 corners, WebDAV, DocuSign, Azure Purview, tab-title and close-button options, recycle bin, WebP/MRC/PRC import… | 🚫 desktop/Windows-specific or third-party services |

## 14. OCR

| Feature | Status |
|---|---|
| Perform OCR on Documents | ✅ tesseract.js, runs locally in the browser (Convert → OCR Pages) |
| Enhanced OCR: style and table recognition, three output types, multithreading, skew/rotation detection and correction | ✅ |
| OCR Selected Region / Multiple Selected Images via the Context Menu | 🟡 OCR from an image's context menu (whole page); ⬜ region |
| Review Recognised Text Before Applying | ⬜ words coloured by confidence, jump between doubtful words, user dictionary, re-OCR a region, then apply |
| Clean Up Scans Before OCR (denoise, binarize) and OCR a Folder of Files | ⬜ |
| OCR when Converting to MS Office Formats | ⬜ (with the Office export) |

## 15. Secure documents

| Feature | Status |
|---|---|
| Add Digital Signatures | ✅ certificates from .p12/.pfx, visible or invisible, as incremental updates; ⬜ signing password-protected files |
| Validate Signatures | 🟡 integrity, signature and coverage are checked; ⬜ signer identity against trusted certificates (trust list, revocation) |
| Password Protection (AES-256/128) and Permissions | ✅ |
| Customize Security Options | ✅ |
| Certify Documents (with or without a visible signature) | ⬜ |
| Security Policies | ⬜ |
| Export/Import Signatures and Initials | ⬜ |
| Long-Term Validation, Timestamps | ⬜ (timestamping needs a TSA server reachable from the browser) |

## 16. Editor Plus features

| Feature | Status |
|---|---|
| Enhanced OCR Engine | ✅ |
| Create and Edit Fillable Forms | ✅ |
| Create Customized Dynamic Stamps | ⬜ |
| Compare Documents | ⬜ |
| Identify Forms Automatically | ⬜ |
| Add Placeholder Tool | ⬜ |
