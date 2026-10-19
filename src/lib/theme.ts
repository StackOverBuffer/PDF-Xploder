/**
 * The colour theme of the interface: following the system, or always light or dark.
 * Applied as data-theme on <html> (index.html applies the stored choice before the
 * first paint); pages keep their own colours (see "Invert colours" for those).
 */
import { create } from 'zustand';

export type Theme = 'system' | 'light' | 'dark';
const KEY = 'pdf-xploder.theme';

function stored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(theme: Theme) {
  if (typeof document === 'undefined') return;
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export const useTheme = create<{ theme: Theme }>()(() => ({ theme: stored() }));
apply(useTheme.getState().theme);

export function setTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable: the choice lasts for this visit */
  }
  apply(theme);
  useTheme.setState({ theme });
}
