import { useRef, useState } from 'react';
import { Modal, parseRange, useDialog } from './Dialogs';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import { runOcr, type OcrOptions, type PageProgress, type PageStatus } from '../store/ocrCommands';
import { DEFAULT_THREADS, OCR_LANGUAGES } from '../lib/ocr/config';
import type { OutputMode } from '../lib/ocr/writer';
import { useT } from '../lib/i18n';

type Settings = Omit<OcrOptions, 'pages'>;

const STORAGE_KEY = 'awesome-pdf.ocr';
/** Dialog rows stretch their inputs; check boxes and radios keep their size. */
const NOFLEX = { flex: 'none' } as const;
const INLINE = { display: 'inline-flex', alignItems: 'center', gap: 4 } as const;

function initialSettings(): Settings {
  const defaults: Settings = {
    langs: ['deu', 'eng'],
    mode: 'searchable',
    dpi: 300,
    detectSkew: true,
    correctSkew: false,
    detectRotation: true,
    correctRotation: true,
    styles: true,
    tables: true,
    threads: DEFAULT_THREADS(),
    includeTextPages: false,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Settings> | null;
    return saved ? { ...defaults, ...saved, threads: defaults.threads } : defaults;
  } catch {
    return defaults;
  }
}

const OUTPUTS: { mode: OutputMode; label: string; hint: string }[] = [
  { mode: 'searchable', label: 'Searchable Image', hint: 'Keeps the page as it is and adds invisible text, so it can be searched, selected and copied.' },
  { mode: 'editable', label: 'Editable Text and Images', hint: 'Recognised text becomes editable text and tables become lines; the rest of the page stays an image.' },
  { mode: 'fine', label: 'Fine Page Content', hint: 'Replaces the page with the recognised text, table lines and pictures on a white background.' },
];

const STATUS: Record<PageStatus, string> = {
  queued: 'Waiting',
  rendering: 'Rendering',
  analysing: 'Analysing layout',
  recognising: 'Recognising',
  writing: 'Writing',
  done: 'Done',
  skipped: 'Skipped',
  failed: 'Recognition failed',
};

/** Page OCR, modelled on PDF-XChange Editor's OCR dialog. */
export function OcrDialog({ close }: { close: () => void }) {
  const t = useT();
  const count = useStore((s) => s.pageIds.length);
  const canModify = useCan('modify');
  const [o, setO] = useState(initialSettings);
  const [scope, setScope] = useState<'all' | 'current' | 'range'>(() => {
    const p = (useDialog.getState().payload as { pages?: number[] } | undefined)?.pages;
    return p?.length || useStore.getState().selectedPages.length > 1 ? 'range' : 'all';
  });
  const [range, setRange] = useState(() => {
    const p = (useDialog.getState().payload as { pages?: number[] } | undefined)?.pages ?? (useStore.getState().selectedPages.length > 1 ? useStore.getState().selectedPages : []);
    return p.length ? [...p].sort((a, b) => a - b).map((i) => i + 1).join(', ') : `1-${useStore.getState().pageIds.length}`;
  });
  const [progress, setProgress] = useState<PageProgress[] | null>(null);
  const [engine, setEngine] = useState<{ status: string; progress: number } | undefined>();
  const abort = useRef<AbortController | null>(null);
  const set = (patch: Partial<Settings>) => setO((v) => ({ ...v, ...patch }));

  const pages = scope === 'all' ? Array.from({ length: count }, (_, i) => i) : scope === 'current' ? [useStore.getState().currentPage] : parseRange(range, count);
  const running = progress !== null;
  const maxThreads = Math.max(4, Math.min(16, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4));

  const start = async () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...o, threads: undefined }));
    } catch {
      /* storage unavailable */
    }
    abort.current = new AbortController();
    setProgress(pages.map((page) => ({ page, status: 'queued', progress: 0 })));
    await runOcr({ ...o, pages }, (p, e) => {
      setProgress(p);
      setEngine(e);
    }, abort.current.signal);
    close();
  };
  const cancel = () => (running ? abort.current?.abort() : close());

  const check = (key: keyof Settings, label: string, disabled = false) => (
    <label className="inline" style={INLINE}><input type="checkbox" style={NOFLEX} checked={o[key] as boolean} disabled={disabled || running} onChange={(e) => set({ [key]: e.target.checked })} /> {t(label)}</label>
  );
  const total = progress?.length ? progress.reduce((s, p) => s + p.progress, 0) / progress.length : 0;

  return (
    <Modal
      title={t('OCR Pages')}
      wide
      onClose={cancel}
      footer={
        <>
          <button onClick={cancel}>{t('Cancel')}</button>
          {!running && <button className="primary" disabled={!pages.length || !o.langs.length || !canModify} onClick={start}>{t('Recognise')}</button>}
        </>
      }
    >
      {!running ? (
        <>
          <div className="row">
            <span>{t('Pages')}</span>
            <label className="inline" style={INLINE}><input type="radio" style={NOFLEX} checked={scope === 'all'} onChange={() => setScope('all')} /> {t('All')}</label>
            <label className="inline" style={INLINE}><input type="radio" style={NOFLEX} checked={scope === 'current'} onChange={() => setScope('current')} /> {t('Current page')}</label>
            <label className="inline" style={INLINE}><input type="radio" style={NOFLEX} checked={scope === 'range'} onChange={() => setScope('range')} /> {t('Range')}</label>
            <input value={range} disabled={scope !== 'range'} onChange={(e) => setRange(e.target.value)} placeholder={t('e.g. 1-3, 5')} style={{ flex: 1, minWidth: 0 }} />
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span>{t('Languages')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
              {OCR_LANGUAGES.map((l) => (
                <label key={l.code} className="inline" style={INLINE}>
                  <input type="checkbox" style={NOFLEX} checked={o.langs.includes(l.code)} onChange={(e) => set({ langs: e.target.checked ? [...o.langs, l.code] : o.langs.filter((c) => c !== l.code) })} /> {t(l.label)}
                </label>
              ))}
            </div>
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span>{t('Output')}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {OUTPUTS.map((x) => (
                <label key={x.mode} className="inline" style={INLINE} title={t(x.hint)}>
                  <input type="radio" style={NOFLEX} name="ocr-output" checked={o.mode === x.mode} onChange={() => set({ mode: x.mode })} /> {t(x.label)}
                </label>
              ))}
              <span className="muted small">{t(OUTPUTS.find((x) => x.mode === o.mode)!.hint)}</span>
            </div>
          </div>
          <label className="row">
            <span>{t('Resolution')}</span>
            <select value={o.dpi} onChange={(e) => set({ dpi: Number(e.target.value) })}>
              {[150, 200, 300, 400].map((d) => <option key={d} value={d}>{d} dpi</option>)}
            </select>
          </label>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span>{t('Options')}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {check('detectSkew', 'Auto-detect image skew')}
              <div style={{ paddingLeft: 20 }}>{check('correctSkew', 'Correct auto-detected image skew', !o.detectSkew || o.mode !== 'searchable')}</div>
              {check('detectRotation', 'Auto-detect incorrect page rotation')}
              <div style={{ paddingLeft: 20 }}>{check('correctRotation', 'Correct auto-detected page rotation', !o.detectRotation)}</div>
              {check('styles', 'Recognise text styles (colour, bold, italic, underline, font)')}
              {check('tables', 'Recognise tables and lines')}
              {check('includeTextPages', 'Also process pages that already contain text')}
            </div>
          </div>
          <label className="row">
            <span>{t('Threads')}</span>
            <input type="number" min={1} max={maxThreads} value={o.threads} onChange={(e) => set({ threads: Math.max(1, Math.min(maxThreads, Number(e.target.value) || 1)) })} />
          </label>
          {o.mode !== 'searchable' && <p className="muted small">{t('Skew is always corrected for this output type.')}</p>}
          {!canModify && <p className="error-text">{t('This document cannot be changed.')}</p>}
        </>
      ) : (
        <>
          <div className="row">
            <span>{t('Total')}</span>
            <progress value={total} max={1} style={{ flex: 1 }} />
            <span className="muted small">{Math.round(total * 100)}%</span>
          </div>
          {engine && engine.progress < 1 && (
            <div className="row"><span>{engine.status}</span><progress value={engine.progress} max={1} style={{ flex: 1 }} /></div>
          )}
          <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }} aria-label={t('Progress')}>
            {progress.map((p) => (
              <div key={p.page} className="row" data-ocr-page={p.page + 1} data-status={p.status}>
                <span>{t('Page')} {p.page + 1}</span>
                <progress value={p.progress} max={1} style={{ width: 120 }} />
                <span className={p.status === 'failed' ? 'error-text small' : 'muted small'}>{t(STATUS[p.status])}{p.detail ? ` · ${p.detail}` : ''}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
