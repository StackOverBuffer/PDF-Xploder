/**
 * Context menus modelled on PDF-XChange Editor: for page objects (Edit
 * Objects tool), for text selected with the Select Text tool, and for the page.
 */
import {
  ImageUp, Images, FileArchive, Download, Stamp, ScanText, ScanBarcode, BookmarkPlus, Link2, Layers, Hand, Camera, TextSelect,
  ZoomIn, Scissors, Copy, ClipboardPaste, Trash2, BringToFront, BoxSelect, SquareX, LayoutGrid, FilePlus2, FileOutput, Settings2,
  Pencil, Highlighter, Underline, Strikethrough, Search, MousePointer2, Type, MessageSquareText, MessageSquareOff,
} from 'lucide-react';
import type { MenuItem } from './Menu';
import { tr } from '../lib/i18n';
import { useStore } from '../store/store';
import { can } from '../store/permissions';
import { applyContentEdits, exportRegionAsImage } from '../store/content';
import * as ca from '../store/contentActions';
import { copyPageImage } from '../store/extras';
import { copyBoxText, markupBox, selectAllText, useTextBox } from './TextBoxSelect';
import { useDialog } from './Dialogs';
import { normaliseImage } from '../store/commands';
import { imageBytes } from '../store/content';
import { pickFile, readAsDataUrl } from '../lib/download';
import { pdfRectToView, viewToPdf } from '../lib/geometry';
import { about, rotate, scale as scaleM } from '../lib/content/matrix';
import { toUser } from './ContentLayer';
import type { LayerInfo, ObjectInfo } from '../lib/content/page';
import type { Annotation, PageGeom, Pt, Rect } from '../lib/types';
import { annotationsAt } from '../lib/annotHit';
import { hasPopup } from '../lib/popups';
import { popupCounts, setAllPopups, setPopupOpen } from '../store/popups';
import { ANNOT_LABELS, annotSummary, viewBounds } from '../lib/annotGeom';
import { askText } from '../lib/ask';

const S = () => useStore.getState();
const i = (C: typeof Hand) => <C size={14} />;

export const showProperties = () => window.dispatchEvent(new Event('awesome-pdf:show-properties'));

/** Tools offered in every page context menu, as in PDF-XChange. */
function toolItems(): MenuItem[] {
  const tool = S().tool;
  return [
    { label: 'Hand', icon: i(Hand), checked: tool === 'hand' || undefined, onClick: () => S().setTool('hand') },
    {
      label: 'Snapshot', icon: i(Camera), submenu: [
        { label: 'Snapshot tool', icon: i(Camera), hint: 'G', disabled: !can('copy'), onClick: () => S().setTool('snapshot') },
        { label: 'Copy page as image', icon: i(Copy), disabled: !can('copy'), onClick: () => copyPageImage() },
      ],
    },
    { label: 'Select Text', icon: i(TextSelect), hint: 'X', onClick: () => S().setTool('selectText') },
    { label: 'Zoom tool', icon: i(ZoomIn), hint: 'Z', onClick: () => S().setTool('zoom') },
  ];
}

const pageBox = (g: PageGeom): Rect => ({ x: g.view[0], y: g.view[1], w: g.view[2] - g.view[0], h: g.view[3] - g.view[1] });

function linkSubmenu(page: number, rect: Rect): MenuItem[] {
  const ok = can('annotate');
  return [
    { label: 'To a page in this document…', disabled: !ok, onClick: () => ca.addLinkAt(page, rect, 'page') },
    { label: 'To a web address…', disabled: !ok, onClick: () => ca.addLinkAt(page, rect, 'url') },
  ];
}

async function replaceImage(page: number, id: number) {
  const [f] = await pickFile('image/*');
  if (!f) return;
  const img = await normaliseImage(await readAsDataUrl(f));
  await applyContentEdits(page, [{ type: 'replaceImage', id, image: imageBytes(img.src) }]);
}

/** Menu for page objects; `chosen` is the selection, `layers` the document's layers. */
export function objectMenu(page: number, geom: PageGeom, chosen: ObjectInfo[], layers: LayerInfo[], at: Pt): MenuItem[] {
  const modify = can('modify');
  const copy = can('copy');
  const ids = chosen.map((o) => o.id);
  const one = chosen.length === 1 ? chosen[0] : undefined;
  const image = one?.kind === 'image' ? one : undefined;
  const box = chosen.length ? ca.union(chosen.map((o) => o.bbox)) : null;
  const edit = (...edits: Parameters<typeof applyContentEdits>[1]) => applyContentEdits(page, edits);
  const viewRot = (deg: number) => {
    const v = pdfRectToView(geom, box!);
    return toUser(geom, about(rotate(deg), v.left + v.width / 2, v.top + v.height / 2));
  };
  // Flips, like rotations, act as seen on screen (the page may be rotated).
  const flip = (sx: number, sy: number) => {
    const v = pdfRectToView(geom, box!);
    return toUser(geom, about(scaleM(sx, sy), v.left + v.width / 2, v.top + v.height / 2));
  };
  const userAt = viewToPdf(geom, at);
  const text = chosen.filter((o) => o.kind === 'text').map((o) => o.text).join(' ');
  const layerRefs = new Set(chosen.map((o) => o.layer ?? ''));
  const layerName = layerRefs.size > 1 ? 'mixed' : layers.find((l) => l.ref === [...layerRefs][0])?.name;

  if (!chosen.length) {
    return [
      { label: 'Paste', icon: i(ClipboardPaste), hint: 'Ctrl+V', disabled: !modify || !ca.hasObjectClipboard(), onClick: () => ca.pasteObjects(page, { at: userAt }) },
      { label: 'Paste in place', hint: 'Ctrl+Shift+V', disabled: !modify || !ca.hasObjectClipboard(), onClick: () => ca.pasteObjects(page, { inPlace: true }) },
      null,
      ...selectItems(page),
      null,
      { label: 'Add Bookmark', icon: i(BookmarkPlus), hint: 'Ctrl+Shift+B', disabled: !modify, onClick: () => ca.addBookmarkAt(page, userAt.y, '') },
      null,
      ...toolItems(),
      null,
      { label: 'Properties…', icon: i(Settings2), onClick: showProperties },
    ];
  }

  const items: MenuItem[] = [];
  if (image) {
    items.push(
      {
        label: 'Edit Image', icon: i(Pencil), disabled: !modify, submenu: [
          { label: 'Rotate left', onClick: () => edit({ type: 'transform', ids, m: viewRot(-90) }) },
          { label: 'Rotate right', onClick: () => edit({ type: 'transform', ids, m: viewRot(90) }) },
          { label: 'Flip horizontally', onClick: () => edit({ type: 'transform', ids, m: flip(-1, 1) }) },
          { label: 'Flip vertically', onClick: () => edit({ type: 'transform', ids, m: flip(1, -1) }) },
          null,
          { label: 'Convert to greyscale', onClick: () => ca.grayscaleImage(page, image.id) },
          { label: 'Remove clipping', disabled: !image.clipped, onClick: () => edit({ type: 'removeClip', ids }) },
        ],
      },
      { label: 'Replace Image…', icon: i(ImageUp), disabled: !modify, onClick: () => replaceImage(page, image.id) },
      { label: 'Recompress Image…', icon: i(FileArchive), disabled: !modify, onClick: () => useDialog.getState().show('recompress', { page, id: image.id }) },
      null,
      { label: 'Save Image As…', icon: i(Download), disabled: !copy, onClick: () => ca.saveImageAs(page, image.id) },
      null,
      { label: 'Save Logo…', icon: i(Stamp), disabled: !copy, onClick: () => ca.stampFromSelection(page, ids, { image: true }) },
      null,
      { label: 'Recognize Text in Images…', icon: i(ScanText), disabled: !modify, onClick: () => useDialog.getState().show('ocr', { pages: [page] }) },
      { label: 'Recognize Barcodes…', icon: i(ScanBarcode), disabled: !copy, onClick: async () => {
        const codes = await ca.detectBarcodes(page, image.id);
        if (codes) useDialog.getState().show('barcodes', codes);
      } },
      null,
    );
  }
  if (one?.kind === 'text') {
    items.push(
      { label: 'Edit Text', icon: i(Type), disabled: !modify, onClick: () => useStore.setState({ contentEditing: { page, id: one.id } }) },
      { label: 'Copy Text', icon: i(Copy), disabled: !copy, onClick: () => navigator.clipboard?.writeText(one.text ?? '') },
      null,
    );
  }
  items.push(
    { label: 'Add Bookmark', icon: i(BookmarkPlus), hint: 'Ctrl+Shift+B', disabled: !modify, onClick: () => ca.addBookmarkAt(page, box!.y + box!.h, text) },
    { label: 'Add Link', icon: i(Link2), disabled: !can('annotate'), submenu: linkSubmenu(page, box!) },
    null,
    {
      label: 'Layer:', icon: i(Layers), value: layerName === 'mixed' ? '—' : layerName ?? tr('not set'), disabled: !modify, submenu: [
        { label: 'not set', checked: !layerName, onClick: () => ca.setObjectsLayer(page, ids, null) },
        ...layers.map((l): MenuItem => ({ label: l.name, checked: layerName === l.name, onClick: () => ca.setObjectsLayer(page, ids, { ref: l.ref }) })),
        null,
        { label: 'New layer…', onClick: async () => {
          const name = (await askText({ title: 'New layer', message: tr('Layer name:'), value: tr('Layer') + ` ${layers.length + 1}` }))?.trim();
          if (name) ca.setObjectsLayer(page, ids, { name });
        } },
      ],
    },
    null,
    ...toolItems(),
    null,
    { label: 'Cut', icon: i(Scissors), hint: 'Ctrl+X', disabled: !modify || !copy, onClick: ca.cutObjects },
    { label: 'Copy', icon: i(Copy), hint: 'Ctrl+C', disabled: !copy, onClick: ca.copyObjects },
    { label: 'Paste', icon: i(ClipboardPaste), hint: 'Ctrl+V', disabled: !modify || !ca.hasObjectClipboard(), onClick: () => ca.pasteObjects(page, { at: userAt }) },
    { label: 'Paste in place', hint: 'Ctrl+Shift+V', disabled: !modify || !ca.hasObjectClipboard(), onClick: () => ca.pasteObjects(page, { inPlace: true }) },
    null,
    { label: 'Delete', icon: i(Trash2), hint: 'Delete', disabled: !modify, onClick: () => edit({ type: 'delete', ids }) },
    null,
    {
      label: 'Arrange', icon: i(BringToFront), disabled: !modify, submenu: [
        { label: 'Bring to front', onClick: () => edit({ type: 'arrange', ids, to: 'front' }) },
        { label: 'Bring forward', onClick: () => edit({ type: 'arrange', ids, to: 'forward' }) },
        { label: 'Send backward', onClick: () => edit({ type: 'arrange', ids, to: 'backward' }) },
        { label: 'Send to back', onClick: () => edit({ type: 'arrange', ids, to: 'back' }) },
        null,
        {
          label: 'Align', submenu: (['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map((h): MenuItem => ({
            label: { left: 'Left', hcenter: 'Centre', right: 'Right', top: 'Top', vcenter: 'Middle', bottom: 'Bottom' }[h],
            onClick: () => edit(...ca.alignEdits(chosen, h, pageBox(geom))),
          })),
        },
        {
          label: 'Centre on page', submenu: [
            { label: 'Horizontally', onClick: () => edit(...ca.centerOnPageEdits(chosen, pageBox(geom), 'x')) },
            { label: 'Vertically', onClick: () => edit(...ca.centerOnPageEdits(chosen, pageBox(geom), 'y')) },
            { label: 'Both', onClick: () => edit(...ca.centerOnPageEdits(chosen, pageBox(geom), 'both')) },
          ],
        },
        {
          label: 'Distribute', disabled: chosen.length < 3, submenu: [
            { label: 'Horizontally', onClick: () => edit(...ca.distributeEdits(chosen, 'x')) },
            { label: 'Vertically', onClick: () => edit(...ca.distributeEdits(chosen, 'y')) },
          ],
        },
        {
          label: 'Make same size', disabled: chosen.length < 2, submenu: [
            { label: 'Width', onClick: () => edit(...ca.sameSizeEdits(chosen, 'w')) },
            { label: 'Height', onClick: () => edit(...ca.sameSizeEdits(chosen, 'h')) },
          ],
        },
        null,
        { label: 'Rotate left', onClick: () => edit({ type: 'transform', ids, m: viewRot(-90) }) },
        { label: 'Rotate right', onClick: () => edit({ type: 'transform', ids, m: viewRot(90) }) },
        { label: 'Flip horizontally', onClick: () => edit({ type: 'transform', ids, m: flip(-1, 1) }) },
        { label: 'Flip vertically', onClick: () => edit({ type: 'transform', ids, m: flip(1, -1) }) },
      ],
    },
    null,
    { label: 'Select', icon: i(BoxSelect), submenu: selectItems(page) },
    { label: 'Deselect', icon: i(SquareX), hint: 'Esc', onClick: () => useStore.setState({ contentSelection: null }) },
    { label: 'Select Page Thumbnail', icon: i(LayoutGrid), onClick: () => { S().setSidebar('pages'); S().setSelectedPages([page]); } },
    null,
    { label: 'New Stamp from Selection…', icon: i(Stamp), disabled: !copy, onClick: () => ca.stampFromSelection(page, ids) },
    { label: 'New Document from Selection…', icon: i(FilePlus2), disabled: !copy, onClick: () => ca.newDocumentFromSelection(page, ids) },
    null,
    {
      label: 'Export', icon: i(FileOutput), disabled: !copy, submenu: [
        { label: 'As PNG image…', onClick: () => ca.exportSelection(page, ids, 'png') },
        { label: 'As JPEG image…', onClick: () => ca.exportSelection(page, ids, 'jpeg') },
        { label: 'As PDF…', onClick: () => ca.newDocumentFromSelection(page, ids) },
        null,
        { label: 'Area with background as PNG…', onClick: () => exportRegionAsImage(page, box!, 'area') },
      ],
    },
    null,
    { label: 'Properties…', icon: i(Settings2), onClick: showProperties },
  );
  return items;
}

function selectItems(page: number): MenuItem[] {
  return [
    { label: 'Select all', icon: i(BoxSelect), hint: 'Ctrl+A', onClick: () => ca.selectObjects(page, 'all') },
    { label: 'Text objects', onClick: () => ca.selectObjects(page, 'text') },
    { label: 'Image objects', onClick: () => ca.selectObjects(page, 'image') },
    { label: 'Shape objects', onClick: () => ca.selectObjects(page, 'shape') },
    { label: 'Invert selection', onClick: () => ca.selectObjects(page, 'invert') },
  ];
}

/** Menu for the Select Text tool. */
export function textSelectionMenu(page: number, geom: PageGeom, at: Pt): MenuItem[] {
  const sel = useTextBox.getState().sel;
  const has = !!sel && sel.page === page && !!sel.text;
  const annotate = can('annotate');
  const rect = has ? ca.union(sel!.rects.map((r) => {
    const p1 = viewToPdf(geom, { x: r.left, y: r.top });
    const p2 = viewToPdf(geom, { x: r.left + r.width, y: r.top + r.height });
    return { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y) };
  })) : null;
  const userAt = viewToPdf(geom, at);
  return [
    { label: 'Copy', icon: i(Copy), hint: 'Ctrl+C', disabled: !has || !can('copy'), onClick: copyBoxText },
    { label: 'Select all', hint: 'Ctrl+A', onClick: () => selectAllText(page) },
    { label: 'Deselect', icon: i(SquareX), hint: 'Esc', disabled: !has, onClick: () => useTextBox.setState({ sel: null }) },
    null,
    { label: 'Highlight', icon: i(Highlighter), disabled: !has || !annotate, onClick: () => markupBox('highlight') },
    { label: 'Underline', icon: i(Underline), disabled: !has || !annotate, onClick: () => markupBox('underline') },
    { label: 'Strikeout', icon: i(Strikethrough), disabled: !has || !annotate, onClick: () => markupBox('strikeout') },
    null,
    { label: 'Add Bookmark', icon: i(BookmarkPlus), hint: 'Ctrl+Shift+B', disabled: !can('modify'), onClick: () => ca.addBookmarkAt(page, rect ? rect.y + rect.h : userAt.y, has ? sel!.text.split('\n')[0] : '') },
    { label: 'Add Link', icon: i(Link2), disabled: !has || !annotate, submenu: rect ? linkSubmenu(page, rect) : [] },
    { label: 'Search for selected text', icon: i(Search), disabled: !has, onClick: () => {
      S().setSearch({ query: sel!.text.split('\n')[0].slice(0, 100) });
      S().setSidebar('search');
      window.dispatchEvent(new CustomEvent('awesome-pdf:run-search', { detail: sel!.text.split('\n')[0].slice(0, 100) }));
    } },
    null,
    ...toolItems(),
    { label: 'Edit Comments', icon: i(MousePointer2), hint: 'V', onClick: () => S().setTool('select') },
    null,
    { label: 'Properties…', icon: i(Settings2), onClick: showProperties },
  ];
}

/** Menu on the page for the other tools. */
/** "Select ▸": every comment under the pointer (overlapping or hidden ones too). */
function selectUnder(page: number, geom: PageGeom, at: Pt): MenuItem[] {
  const s = S();
  const pageId = s.pageIds[page];
  const under = annotationsAt(s.annotations[pageId] ?? [], geom, at, 5 / s.scale);
  if (!under.length) return [];
  const snippet = (a: Annotation) => {
    const text = (a.type === 'text' || a.type === 'note' ? a.text : a.comment ?? annotSummary(a)).trim().replace(/\s+/g, ' ');
    return text.length > 32 ? `${text.slice(0, 30)}…` : text;
  };
  const size = (a: Annotation) => {
    const v = viewBounds(a, geom);
    return `${Math.round(v.width)} × ${Math.round(v.height)} pt`;
  };
  return [
    {
      label: 'Select', icon: i(MousePointer2), submenu: under.map((a): MenuItem => ({
        label: a.subject ?? ANNOT_LABELS[a.type],
        // Without text, the size tells otherwise equal entries apart.
        value: `– ${snippet(a) || size(a)}`,
        checked: s.selected?.id === a.id,
        onClick: () => {
          S().setTool('select');
          S().select({ pageId, id: a.id });
        },
      })),
    },
    null,
  ];
}

/** The popup of the comment under the pointer, and all popups. */
function popupItems(page: number, geom: PageGeom, at: Pt): MenuItem[] {
  const s = S();
  const pageId = s.pageIds[page];
  const top = annotationsAt(s.annotations[pageId] ?? [], geom, at, 5 / s.scale).find(hasPopup);
  const counts = popupCounts(s.annotations);
  if (!top && !counts.withText && !counts.open) return [];
  return [
    ...(top
      ? [top.popup?.open
          ? { label: 'Close Popup', icon: i(MessageSquareOff), onClick: () => setPopupOpen(pageId, top.id, false) }
          : { label: 'Open Popup', icon: i(MessageSquareText), onClick: () => setPopupOpen(pageId, top.id, true, { focus: true }) }]
      : []),
    { label: 'Open All Popups', icon: i(MessageSquareText), disabled: !counts.withText, onClick: () => setAllPopups(true) },
    { label: 'Close All Popups', icon: i(MessageSquareOff), disabled: !counts.open, onClick: () => setAllPopups(false) },
    null,
  ];
}

export function pageMenu(page: number, geom: PageGeom, at: Pt): MenuItem[] {
  const userAt = viewToPdf(geom, at);
  const sel = window.getSelection();
  const selected = sel && !sel.isCollapsed ? sel.toString() : '';
  return [
    ...selectUnder(page, geom, at),
    ...popupItems(page, geom, at),
    { label: 'Copy', icon: i(Copy), hint: 'Ctrl+C', disabled: !selected || !can('copy'), onClick: () => navigator.clipboard?.writeText(selected) },
    { label: 'Add Bookmark', icon: i(BookmarkPlus), hint: 'Ctrl+Shift+B', disabled: !can('modify'), onClick: () => ca.addBookmarkAt(page, userAt.y, selected) },
    null,
    ...toolItems(),
    { label: 'Edit Comments', icon: i(MousePointer2), hint: 'V', onClick: () => S().setTool('select') },
    { label: 'Edit Objects', icon: i(Images), onClick: () => S().setTool('content') },
    null,
    { label: 'Properties…', icon: i(Settings2), onClick: showProperties },
  ];
}

