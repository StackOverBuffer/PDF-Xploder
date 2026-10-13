import { useEffect, useState } from 'react';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { useStore } from '../store/store';
import { pageRot, viewSize } from '../lib/geometry';

export function StatusBar() {
  const current = useStore((s) => s.currentPage);
  const count = useStore((s) => s.pageIds.length);
  const scale = useStore((s) => s.scale);
  const geom = useStore((s) => s.geoms[s.currentPage]);
  const busy = useStore((s) => s.busy);
  const [text, setText] = useState(String(current + 1));
  useEffect(() => setText(String(current + 1)), [current]);
  const S = useStore.getState;
  const size = geom ? viewSize(geom) : null;

  return (
    <footer className="statusbar">
      <div className="nav">
        <button onClick={() => S().goToPage(0)} disabled={current === 0} title="First page"><ChevronFirst size={16} /></button>
        <button onClick={() => S().goToPage(current - 1)} disabled={current === 0} title="Previous page"><ChevronLeft size={16} /></button>
        <input
          aria-label="Page number"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && S().goToPage(Number(text) - 1)}
          onBlur={() => setText(String(current + 1))}
        />
        <span>/ {count}</span>
        <button onClick={() => S().goToPage(current + 1)} disabled={current >= count - 1} title="Next page"><ChevronRight size={16} /></button>
        <button onClick={() => S().goToPage(count - 1)} disabled={current >= count - 1} title="Last page"><ChevronLast size={16} /></button>
      </div>
      <div className="muted small">
        {busy ?? (size ? `${(size.width / 72).toFixed(2)} × ${(size.height / 72).toFixed(2)} in${pageRot(geom) ? ` · rotated ${pageRot(geom)}°` : ''}${geom.pageRotation !== undefined ? ' · view rotated' : ''}` : '')}
      </div>
      <div className="zoom">
        <button onClick={() => S().setScale(scale / 1.2)} title="Zoom out"><ZoomOut size={16} /></button>
        <select value={String(Math.round(scale * 100))} onChange={(e) => {
          const v = e.target.value;
          if (v === 'width' || v === 'page') S().setScale(scale, v);
          else S().setScale(Number(v) / 100);
        }}>
          {![25, 50, 75, 100, 125, 150, 200, 300, 400].includes(Math.round(scale * 100)) && <option value={String(Math.round(scale * 100))}>{Math.round(scale * 100)}%</option>}
          {[25, 50, 75, 100, 125, 150, 200, 300, 400].map((z) => <option key={z} value={String(z)}>{z}%</option>)}
          <option value="width">Fit width</option>
          <option value="page">Fit page</option>
        </select>
        <button onClick={() => S().setScale(scale * 1.2)} title="Zoom in"><ZoomIn size={16} /></button>
      </div>
    </footer>
  );
}
