/** Zooming around a point or into a box (Zoom tool, context menu). */
import { useStore } from './store';
import { viewSize, type VRect } from '../lib/geometry';
import type { Pt } from '../lib/types';

const S = () => useStore.getState();

/** After the next render, scroll so `p` (page view space, scale 1) is at the viewer's centre. */
function centreOn(page: number, p: Pt) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const viewer = document.querySelector<HTMLElement>('.viewer');
      const pageEl = viewer?.querySelector<HTMLElement>(`.page[data-index="${page}"]`);
      if (!viewer || !pageEl) return;
      const vr = viewer.getBoundingClientRect();
      const pr = pageEl.getBoundingClientRect();
      const scale = S().scale;
      viewer.scrollLeft += pr.left - vr.left + p.x * scale - viewer.clientWidth / 2;
      viewer.scrollTop += pr.top - vr.top + p.y * scale - viewer.clientHeight / 2;
    }),
  );
}

export function zoomAt(page: number, p: Pt, factor: number) {
  S().setScale(S().scale * factor);
  centreOn(page, p);
}

/** Zoom so that a box on the page fills the viewer. */
export function zoomToBox(page: number, box: VRect) {
  const viewer = document.querySelector<HTMLElement>('.viewer');
  if (!viewer || box.width < 1 || box.height < 1) return;
  const g = S().geoms[page];
  const fit = Math.min((viewer.clientWidth - 40) / box.width, (viewer.clientHeight - 40) / box.height);
  // Never zoom out past the whole page.
  const page1 = viewSize(g);
  S().setScale(Math.max(fit, Math.min(viewer.clientWidth / page1.width, 1) * 0.5));
  centreOn(page, { x: box.left + box.width / 2, y: box.top + box.height / 2 });
}
