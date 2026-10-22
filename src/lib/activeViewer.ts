/** The viewer element of the active pane in a split view (the only one without a split). */
export function activeViewer(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>('.viewer:not(.inactive)');
}

/** Whether an element is in the active pane (for keyboard handlers of page layers). */
export function inActivePane(el: Element | null | undefined): boolean {
  return !el?.closest('.viewer.inactive');
}
