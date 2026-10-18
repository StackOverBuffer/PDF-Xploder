/** Print dialog like PDF-XChange's: what to print, paper, scaling, pages per sheet, with a preview. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Modal, parseRange } from './Dialogs';
import { useStore } from '../store/store';
import { printPreviewSheet, printWithOptions, releasePrintCache } from '../store/printCommands';
import { DEFAULT_PRINT, PAPERS, type Paper, type PerSheet, type PrintOptions } from '../lib/printLayout';
import { openPdf, renderToCanvas } from '../lib/pdfjs';
import { tf, useT } from '../lib/i18n';

type Settings = Omit<PrintOptions, 'pages'>;
type Scope = 'all' | 'current' | 'selected' | 'range';

const STORAGE_KEY = 'pdf-xploder.print';
const NOFLEX = { flex: 'none' } as const;
const PREVIEW_BOX = 300;

function initialSettings(): Settings {
  try {
    return { ...DEFAULT_PRINT, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_PRINT };
  }
}

function storeSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

const PAPER_NAMES: Record<Paper, string> = { document: 'Same as page', A3: 'A3', A4: 'A4', A5: 'A5', Letter: 'Letter', Legal: 'Legal' };

/** Render one prepared sheet into the preview box. */
function Preview({ o }: { o: PrintOptions }) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState(0);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const key = JSON.stringify(o);
  useEffect(() => setSheet(0), [key]);
  useEffect(() => {
    let live = true;
    setBusy(true);
    // Short pause so typing a range or margin does not rebuild on every key.
    const timer = setTimeout(async () => {
      try {
        const res = await printPreviewSheet(o, sheet);
        if (!live) return;
        setCount(res?.count ?? 0);
        if (!res) return host.current?.replaceChildren();
        const { pdf } = await openPdf(res.bytes, () => null);
        const page = await pdf.getPage(1);
        const vp = page.getViewport({ scale: 1 });
        const scale = Math.min(PREVIEW_BOX / vp.width, PREVIEW_BOX / vp.height) * (window.devicePixelRatio || 1);
        const canvas = await renderToCanvas(page, scale);
        pdf.destroy();
        if (!live) return;
        canvas.style.width = `${canvas.width / (window.devicePixelRatio || 1)}px`;
        host.current?.replaceChildren(canvas);
      } catch (e) {
        console.warn('Print preview failed', e);
      } finally {
        if (live) setBusy(false);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // The options are compared by value (key).
  }, [key, sheet]);

  return (
    <div className="print-preview">
      <div className={`print-sheet ${busy ? 'busy' : ''}`} ref={host} aria-label={t('Preview')} />
      {count === 0 && <p className="muted">{t('There are no pages to print.')}</p>}
      {!!count && (
        <div className="print-nav">
          <button className="icon-btn" disabled={sheet <= 0} aria-label={t('Previous sheet')} onClick={() => setSheet(sheet - 1)}><ChevronLeft size={16} /></button>
          <span>{tf('Sheet {n} of {count}', { n: sheet + 1, count })}</span>
          <button className="icon-btn" disabled={sheet >= count - 1} aria-label={t('Next sheet')} onClick={() => setSheet(sheet + 1)}><ChevronRight size={16} /></button>
        </div>
      )}
    </div>
  );
}

export function PrintDialog({ close }: { close: () => void }) {
  const t = useT();
  const count = useStore((s) => s.pageIds.length);
  const current = useStore((s) => s.currentPage);
  const selected = useStore((s) => s.selectedPages);
  const [o, setO] = useState<Settings>(initialSettings);
  const [scope, setScope] = useState<Scope>(selected.length > 1 ? 'selected' : 'all');
  const [range, setRange] = useState(() => `1-${count}`);
  const set = (patch: Partial<Settings>) => setO({ ...o, ...patch });

  useEffect(() => () => releasePrintCache(), []);

  const pages = useMemo(() => {
    if (scope === 'current') return [current];
    if (scope === 'selected') return [...selected].sort((a, b) => a - b);
    if (scope === 'range') return parseRange(range, count);
    return Array.from({ length: count }, (_, i) => i);
  }, [scope, current, selected, range, count]);
  const options: PrintOptions = { ...o, pages };

  const ok = () => {
    storeSettings(o);
    close();
    printWithOptions(options);
  };

  return (
    <Modal
      title={t('Print')}
      wide
      onClose={close}
      footer={<><span className="muted small print-hint">{t('Printer, copies and two-sided printing are chosen in the browser’s print dialog.')}</span><button onClick={close}>{t('Cancel')}</button><button className="primary" disabled={!pages.length} onClick={ok}>{t('Print…')}</button></>}
    >
      <div className="print-layout">
        <div className="print-options">
          <h3 className="section">{t('Pages')}</h3>
          <label className="row"><input type="radio" style={NOFLEX} checked={scope === 'all'} onChange={() => setScope('all')} /> {t('All pages')}</label>
          <label className="row"><input type="radio" style={NOFLEX} checked={scope === 'current'} onChange={() => setScope('current')} /> {tf('Current page ({n})', { n: current + 1 })}</label>
          {selected.length > 1 && <label className="row"><input type="radio" style={NOFLEX} checked={scope === 'selected'} onChange={() => setScope('selected')} /> {tf('Selected pages ({n})', { n: selected.length })}</label>}
          <label className="row">
            <input type="radio" style={NOFLEX} checked={scope === 'range'} onChange={() => setScope('range')} />
            <input aria-label={t('Page range')} value={range} placeholder={t('e.g. 1-3, 5')} onFocus={() => setScope('range')} onChange={(e) => setRange(e.target.value)} />
          </label>
          <label className="row"><span>{t('Subset')}</span>
            <select aria-label={t('Subset')} value={o.subset} onChange={(e) => set({ subset: e.target.value as Settings['subset'] })}>
              <option value="all">{t('All pages in range')}</option>
              <option value="odd">{t('Odd pages only')}</option>
              <option value="even">{t('Even pages only')}</option>
            </select>
          </label>
          <label className="row"><input type="checkbox" style={NOFLEX} checked={o.reverse} onChange={(e) => set({ reverse: e.target.checked })} /> {t('Reverse order')}</label>
          <label className="row"><input type="checkbox" style={NOFLEX} checked={o.comments} onChange={(e) => set({ comments: e.target.checked })} /> {t('Print comments')}</label>

          <h3 className="section">{t('Paper')}</h3>
          <label className="row"><span>{t('Size')}</span>
            <select aria-label={t('Size')} value={o.paper} onChange={(e) => set({ paper: e.target.value as Paper })}>
              {(['document', ...Object.keys(PAPERS)] as Paper[]).map((p) => <option key={p} value={p}>{t(PAPER_NAMES[p])}</option>)}
            </select>
          </label>
          <label className="row"><span>{t('Orientation')}</span>
            <select aria-label={t('Orientation')} value={o.orientation} onChange={(e) => set({ orientation: e.target.value as Settings['orientation'] })}>
              <option value="auto">{t('Automatic')}</option>
              <option value="portrait">{t('Portrait')}</option>
              <option value="landscape">{t('Landscape')}</option>
            </select>
          </label>
          <label className="row"><span>{t('Margins (mm)')}</span><input aria-label={t('Margins (mm)')} type="number" min={0} max={50} value={o.margin} onChange={(e) => set({ margin: Math.max(0, Number(e.target.value) || 0) })} /></label>

          <h3 className="section">{t('Layout')}</h3>
          <label className="row"><span>{t('Pages per sheet')}</span>
            <select aria-label={t('Pages per sheet')} value={o.perSheet} onChange={(e) => set({ perSheet: Number(e.target.value) as PerSheet })}>
              {[1, 2, 4, 6, 9, 16].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {o.perSheet > 1 && (
            <>
              <label className="row"><span>{t('Page order')}</span>
                <select aria-label={t('Page order')} value={o.order} onChange={(e) => set({ order: e.target.value as Settings['order'] })}>
                  <option value="horizontal">{t('Horizontal')}</option>
                  <option value="vertical">{t('Vertical')}</option>
                </select>
              </label>
              <label className="row"><input type="checkbox" style={NOFLEX} checked={o.borders} onChange={(e) => set({ borders: e.target.checked })} /> {t('Page borders')}</label>
            </>
          )}
          <label className="row"><span>{t('Scaling')}</span>
            <select aria-label={t('Scaling')} value={o.scaling} onChange={(e) => set({ scaling: e.target.value as Settings['scaling'] })}>
              <option value="fit">{t('Fit to paper')}</option>
              <option value="shrink">{t('Shrink oversized pages')}</option>
              <option value="actual">{t('Actual size')}</option>
              <option value="custom">{t('Custom scale')}</option>
            </select>
          </label>
          {o.scaling === 'custom' && <label className="row"><span>{t('Scale (%)')}</span><input aria-label={t('Scale (%)')} type="number" min={1} max={800} value={o.customScale} onChange={(e) => set({ customScale: Math.max(1, Number(e.target.value) || 100) })} /></label>}
        </div>
        <Preview o={options} />
      </div>
    </Modal>
  );
}
