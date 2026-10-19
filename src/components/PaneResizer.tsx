/** A drag handle between a side pane and the page view; the width is remembered. */
import { useRef } from 'react';
import { clampPane, setPrefs, usePrefs } from '../lib/prefs';
import { useT } from '../lib/i18n';

export function PaneResizer({ pane }: { pane: 'sidebar' | 'props' }) {
  const t = useT();
  const key = pane === 'sidebar' ? 'sidebarWidth' : 'propsWidth';
  const width = usePrefs((p) => p[key]);
  const drag = useRef<{ x: number; w: number } | null>(null);
  // The sidebar grows to the right, the properties pane to the left.
  const dir = pane === 'sidebar' ? 1 : -1;
  return (
    <div
      className={`pane-resizer pane-resizer-${pane}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('Resize pane')}
      aria-valuenow={width}
      tabIndex={0}
      title={t('Drag to resize; double-click for the standard width')}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width };
        document.body.classList.add('resizing-pane');
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        // Live while dragging (no storage writes until the end).
        usePrefs.setState({ [key]: clampPane(drag.current.w + dir * (e.clientX - drag.current.x)) });
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = null;
        document.body.classList.remove('resizing-pane');
        setPrefs({ [key]: usePrefs.getState()[key] });
      }}
      onDoubleClick={() => setPrefs({ [key]: pane === 'sidebar' ? 240 : 250 })}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        if (e.key === 'ArrowLeft') setPrefs({ [key]: clampPane(width - dir * step) });
        else if (e.key === 'ArrowRight') setPrefs({ [key]: clampPane(width + dir * step) });
        else return;
        e.preventDefault();
      }}
    />
  );
}
