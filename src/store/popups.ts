/** Opening, closing and placing comment popups (see lib/popups.ts). */
import { useStore } from './store';
import { activeViewer } from '../lib/activeViewer';
import { defaultPopupRect, hasPopup, hasText } from '../lib/popups';
import type { Annotation, Rect } from '../lib/types';

const S = () => useStore.getState();

function find(pageId: string, id: string): { a: Annotation; page: number } | null {
  const s = S();
  const a = s.annotations[pageId]?.find((x) => x.id === id);
  const page = s.pageIds.indexOf(pageId);
  return a && page >= 0 ? { a, page } : null;
}

/** Open (or close) a comment's popup; opening places it the first time. Not an undoable change. */
export function setPopupOpen(pageId: string, id: string, open: boolean, opts: { focus?: boolean } = {}) {
  const hit = find(pageId, id);
  if (!hit || !hasPopup(hit.a)) return;
  const rect = hit.a.popup?.rect ?? defaultPopupRect(hit.a, S().geoms[hit.page]);
  if (hit.a.popup?.open !== open) S().updateAnnotation(pageId, id, { popup: { open, rect } }, { quiet: true });
  if (open && opts.focus) focusPopup(id);
}

export function togglePopup(pageId: string, id: string) {
  const hit = find(pageId, id);
  if (hit) setPopupOpen(pageId, id, !hit.a.popup?.open, { focus: !hit.a.popup?.open });
}

/** Put the cursor into a popup's text once it is on screen. */
export function focusPopup(id: string) {
  requestAnimationFrame(() => requestAnimationFrame(() => activeViewer()?.querySelector<HTMLTextAreaElement>(`.annot-popup[data-id="${id}"] textarea.popup-text`)?.focus()));
}

/** Move or resize a popup (a change to the document, like moving the comment). */
export function placePopup(pageId: string, id: string, rect: Rect, opts: { history?: boolean } = {}) {
  const hit = find(pageId, id);
  if (hit) S().updateAnnotation(pageId, id, { popup: { open: hit.a.popup?.open ?? true, rect } }, opts);
}

/** Open the popups of every comment with text ("Open All Popups"), or close them all; in one update. */
export function setAllPopups(open: boolean) {
  const s = S();
  const annotations = { ...s.annotations };
  s.pageIds.forEach((pid, page) => {
    const list = s.annotations[pid];
    if (!list?.some((a) => (open ? hasText(a) && !a.popup?.open : a.popup?.open))) return;
    annotations[pid] = list.map((a) => {
      if (open ? !hasText(a) || a.popup?.open : !a.popup?.open) return a;
      return { ...a, popup: { open, rect: a.popup?.rect ?? defaultPopupRect(a, s.geoms[page]) } } as Annotation;
    });
  });
  // Like opening one popup: no undo point, no unsaved change.
  useStore.setState({ annotations });
}

/** How many popups are open, and how many comments have text (for the commands' state). */
export function popupCounts(annotations: Record<string, Annotation[]>): { open: number; withText: number } {
  let open = 0;
  let withText = 0;
  for (const list of Object.values(annotations)) {
    for (const a of list) {
      if (a.popup?.open) open++;
      if (hasText(a)) withText++;
    }
  }
  return { open, withText };
}
