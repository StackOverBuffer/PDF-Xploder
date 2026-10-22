/**
 * Comment popups: where a popup window sits on the page. Its rect is in user space, like
 * the /Popup annotation in the file; its size is in points at 100 % and stays the same on
 * screen at any zoom (popups do not scale with the page).
 */
import { pdfRectToView, viewRectToPdf, viewSize, type VRect } from './geometry';
import { viewBounds } from './annotGeom';
import type { Annotation, PageGeom, Rect } from './types';

export const POPUP_W = 240;
export const POPUP_H = 150;
export const POPUP_MIN_W = 160;
export const POPUP_MIN_H = 90;

/** Text boxes show their text on the page, and redaction marks have none to show. */
export const hasPopup = (a: Annotation) => a.type !== 'text' && a.type !== 'redact';

/** The text a popup shows and edits: a note's text, otherwise the comment. */
export const popupText = (a: Annotation) => (a.type === 'note' ? a.text : a.comment ?? '');

/** Whether the comment has anything to read (for "open all popups"). */
export const hasText = (a: Annotation) => hasPopup(a) && (!!popupText(a).trim() || !!a.replies?.length);

/** The page's quarter turns: popups stay upright, so their size is not turned with the page. */
const turned = (g: PageGeom) => g.rotation % 180 !== 0;

/** Where a popup is first placed: right of the comment, kept on the page where it fits. */
export function defaultPopupRect(a: Annotation, g: PageGeom): Rect {
  const b = viewBounds(a, g);
  const page = viewSize(g);
  let left = b.left + b.width + 12;
  if (left + POPUP_W > page.width) left = Math.max(0, Math.min(b.left - POPUP_W - 12, page.width - POPUP_W));
  const top = Math.max(0, Math.min(b.top, page.height - POPUP_H));
  return toRect(g, left, top, POPUP_W, POPUP_H);
}

/** The popup's top-left corner on the page (view space at scale 1) and its size on screen. */
export function popupBox(rect: Rect, g: PageGeom): VRect {
  const v = pdfRectToView(g, rect);
  return { left: v.left, top: v.top, width: rect.w, height: rect.h };
}

/** A popup at `left, top` (view space at scale 1) with an on-screen size, as a user-space rect. */
export function toRect(g: PageGeom, left: number, top: number, width: number, height: number): Rect {
  const r = viewRectToPdf(g, { left, top, width: turned(g) ? height : width, height: turned(g) ? width : height });
  return { ...r, w: width, h: height };
}
