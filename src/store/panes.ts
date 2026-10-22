/**
 * Split view: the document in two panes, each with its own zoom and position. The active
 * pane (the one last clicked) uses the main store's scale, fit and current page, so every
 * command acts on it; the other pane's are kept here and swapped in when it is clicked.
 */
import { create } from 'zustand';
import { useStore } from './store';

export type Split = 'none' | 'sideBySide' | 'stacked';
export type Pane = 0 | 1;

export interface PaneView {
  scale: number;
  fit: 'width' | 'page' | null;
  currentPage: number;
}

interface Panes {
  split: Split;
  active: Pane;
  /** The inactive pane's view. */
  other: PaneView;
}

export const usePanes = create<Panes>()(() => ({ split: 'none', active: 0, other: { scale: 1, fit: 'width', currentPage: 0 } }));

const mine = (): PaneView => {
  const s = useStore.getState();
  return { scale: s.scale, fit: s.fit, currentPage: s.currentPage };
};

export function setSplit(split: Split) {
  const p = usePanes.getState();
  if (p.split === split) return;
  // A new second pane starts where the first one is.
  usePanes.setState(p.split === 'none' ? { split, other: mine() } : { split });
}

/** Make `pane` the active one (a click into it). */
export function activatePane(pane: Pane) {
  const p = usePanes.getState();
  if (p.split === 'none' || p.active === pane) return;
  const now = mine();
  useStore.setState({ scale: p.other.scale, fit: p.other.fit, currentPage: Math.min(p.other.currentPage, Math.max(0, useStore.getState().pageIds.length - 1)) });
  usePanes.setState({ active: pane, other: now });
}

/** Changes to the inactive pane's view (it was resized, or scrolled). */
export function setOtherView(patch: Partial<PaneView>) {
  const o = usePanes.getState().other;
  if (Object.entries(patch).some(([k, v]) => o[k as keyof PaneView] !== v)) usePanes.setState({ other: { ...o, ...patch } });
}
