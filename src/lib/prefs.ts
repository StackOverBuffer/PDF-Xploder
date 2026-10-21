/**
 * Preferences that outlive a visit: the layout of the window (pane widths, which
 * panes are open, the ribbon tab) and how documents open. Kept in this browser only.
 */
import { create } from 'zustand';

export type DefaultZoom = 'width' | 'page' | 'actual';

export interface Prefs {
  /** Zoom of newly opened documents. */
  defaultZoom: DefaultZoom;
  showProps: boolean;
  sidebarWidth: number;
  propsWidth: number;
  /** The ribbon tab shown last (File is never remembered). */
  ribbonTab: string;
  /**
   * Draw pages in a background thread (render/offscreen.ts): 'auto' for documents slow to
   * draw, 'off', or 'always' (every document; for testing, not offered in the interface).
   */
  backgroundDrawing: 'auto' | 'off' | 'always';
}

const KEY = 'pdf-xploder.prefs';
export const DEFAULT_PREFS: Prefs = { defaultZoom: 'width', showProps: true, sidebarWidth: 240, propsWidth: 250, ribbonTab: 'Home', backgroundDrawing: 'auto' };

export const PANE_MIN = 180;
export const PANE_MAX = 520;
export const clampPane = (w: number) => Math.round(Math.min(PANE_MAX, Math.max(PANE_MIN, w)));

function load(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...v, sidebarWidth: clampPane(v.sidebarWidth ?? DEFAULT_PREFS.sidebarWidth), propsWidth: clampPane(v.propsWidth ?? DEFAULT_PREFS.propsWidth) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export const usePrefs = create<Prefs>()(() => load());

export function setPrefs(patch: Partial<Prefs>): void {
  usePrefs.setState(patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(usePrefs.getState()));
  } catch {
    /* storage unavailable: the change lasts for this visit */
  }
}

/** The zoom state a newly opened document starts with. */
export function openingZoom(): { fit: 'width' | 'page' | null; scale?: number } {
  const z = usePrefs.getState().defaultZoom;
  return z === 'actual' ? { fit: null, scale: 1 } : { fit: z };
}
