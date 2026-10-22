import { useEffect, useState } from 'react';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { useStore } from '../store/store';
import { turnPage } from '../store/viewActions';
import { pageRot, viewSize } from '../lib/geometry';
import { formatPercent, tf, useLang, useT } from '../lib/i18n';

export function StatusBar() {
  const t = useT();
  const lang = useLang((l) => l.lang);
  const current = useStore((s) => s.currentPage);
  const count = useStore((s) => s.pageIds.length);
  const scale = useStore((s) => s.scale);
  const geom = useStore((s) => s.geoms[s.currentPage]);
  const busy = useStore((s) => s.busy);
  const progress = useStore((s) => s.progress);
  const pdf = useStore((s) => s.pdf);
  // Page labels (e.g. "iv", "A-3"), shown like PDF-XChange: label in the box, number after it.
  const [labels, setLabels] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    setLabels(null);
    pdf?.getPageLabels().then((l) => live && setLabels(l && l.some((x, i) => x !== String(i + 1)) ? l : null)).catch(() => {});
    return () => {
      live = false;
    };
  }, [pdf]);
  const shown = (i: number) => labels?.[i] || String(i + 1);
  const [text, setText] = useState(shown(current));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setText(shown(current)), [current, labels]);
  const go = () => {
    const byLabel = labels?.indexOf(text.trim()) ?? -1;
    S().goToPage(byLabel >= 0 ? byLabel : Number(text) - 1);
  };
  const S = useStore.getState;
  const size = geom ? viewSize(geom) : null;
  const inches = (pt: number) => (pt / 72).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <footer className="statusbar">
      <div className="nav">
        <button onClick={() => S().goToPage(0)} disabled={current === 0} title={t('First page')}><ChevronFirst size={16} /></button>
        <button onClick={() => turnPage(-1)} disabled={current === 0} title={t('Previous page')}><ChevronLeft size={16} /></button>
        <input
          aria-label={t('Page number')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          onBlur={() => setText(shown(current))}
        />
        <span>{labels ? `(${current + 1} / ${count})` : `/ ${count}`}</span>
        <button onClick={() => turnPage(1)} disabled={current >= count - 1} title={t('Next page')}><ChevronRight size={16} /></button>
        <button onClick={() => S().goToPage(count - 1)} disabled={current >= count - 1} title={t('Last page')}><ChevronLast size={16} /></button>
      </div>
      <div className="muted small">
        {busy ? `${busy}${progress ? ` ${progress.done + 1} / ${progress.total}` : ''}` : (size ? `${inches(size.width)} × ${inches(size.height)} in${pageRot(geom) ? ` · ${tf('rotated {deg}°', { deg: pageRot(geom) })}` : ''}${geom.pageRotation !== undefined ? ` · ${t('view rotated')}` : ''}` : '')}
      </div>
      <div className="zoom">
        <button onClick={() => S().setScale(scale / 1.2)} title={t('Zoom out')}><ZoomOut size={16} /></button>
        <select value={String(Math.round(scale * 100))} onChange={(e) => {
          const v = e.target.value;
          if (v === 'width' || v === 'page') S().setScale(scale, v);
          else S().setScale(Number(v) / 100);
        }}>
          {![25, 50, 75, 100, 125, 150, 200, 300, 400].includes(Math.round(scale * 100)) && <option value={String(Math.round(scale * 100))}>{formatPercent(lang, scale)}</option>}
          {[25, 50, 75, 100, 125, 150, 200, 300, 400].map((z) => <option key={z} value={String(z)}>{formatPercent(lang, z / 100)}</option>)}
          <option value="width">{t('Fit width')}</option>
          <option value="page">{t('Fit page')}</option>
        </select>
        <button onClick={() => S().setScale(scale * 1.2)} title={t('Zoom in')}><ZoomIn size={16} /></button>
      </div>
    </footer>
  );
}
