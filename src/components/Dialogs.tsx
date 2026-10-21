import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { X } from 'lucide-react';
import { uid, useStore } from '../store/store';
import { useCan } from '../store/permissions';
import * as cmd from '../store/commands';
import { getMetadata, type HeaderFooterOptions, type Metadata, type Position, type PageSelection } from '../lib/pdfOps';
import { fixAccessibility, runAccessibilityCheck } from '../store/extras';
import type { CheckResult } from '../lib/accessibility';
import { tf, tr, useLang, useT } from '../lib/i18n';
import type { SignPlacement } from './SecurityDialogs';
import type { Annotation } from '../lib/types';
import type { OrganizeDialogName } from './OrganizeDialogs';
import type { BookmarkDialogName } from './BookmarkDialogs';
import { PrefsDialog } from './PrefsDialog';
import '../signatureFonts.css';
import { placeCustomStamp } from '../store/contentActions';

// The bigger dialogs load the first time they are opened, not with the app.
const BarcodesDialog = lazy(() => import('./ContentDialogs').then((m) => ({ default: m.BarcodesDialog })));
const RecompressDialog = lazy(() => import('./ContentDialogs').then((m) => ({ default: m.RecompressDialog })));
const PermissionsDialog = lazy(() => import('./SecurityDialogs').then((m) => ({ default: m.PermissionsDialog })));
const SecurityDialog = lazy(() => import('./SecurityDialogs').then((m) => ({ default: m.SecurityDialog })));
const SignDialog = lazy(() => import('./SecurityDialogs').then((m) => ({ default: m.SignDialog })));
const OrganizeDialog = lazy(() => import('./OrganizeDialogs').then((m) => ({ default: m.OrganizeDialog })));
const BookmarkDialog = lazy(() => import('./BookmarkDialogs').then((m) => ({ default: m.BookmarkDialog })));
const OcrDialog = lazy(() => import('./OcrDialog').then((m) => ({ default: m.OcrDialog })));
const ScaleDialog = lazy(() => import('./MeasureDialogs').then((m) => ({ default: m.ScaleDialog })));
const CalibrateDialog = lazy(() => import('./MeasureDialogs').then((m) => ({ default: m.CalibrateDialog })));
const BarcodeDialog = lazy(() => import('./BarcodeDialog').then((m) => ({ default: m.BarcodeDialog })));
const PrintDialog = lazy(() => import('./PrintDialog').then((m) => ({ default: m.PrintDialog })));

export type DialogName = 'watermark' | 'headerFooter' | 'crop' | 'split' | 'metadata' | 'signature' | 'shortcuts' | 'goto' | 'security' | 'permissions' | 'sign' | 'accessibility' | 'recompress' | 'barcodes' | 'ocr' | 'print' | 'measureScale' | 'calibrate' | 'insertBarcode' | 'preferences' | OrganizeDialogName | BookmarkDialogName;

export const useDialog = create<{ open: DialogName | null; payload: unknown; show(d: DialogName, payload?: unknown): void; close(): void }>()((set) => ({
  open: null,
  payload: undefined,
  show: (open, payload) => set({ open, payload }),
  close: () => set({ open: null, payload: undefined }),
}));

// Dialogs work on the active document: close them when another tab becomes active.
useStore.subscribe((s, prev) => {
  if (s.activeTab !== prev.activeTab && useDialog.getState().open) useDialog.getState().close();
});

export function Modal({ title, children, onClose, footer, wide, className = '' }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean; className?: string }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('Close')} title={t('Close')}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Parse "1-3, 5" (1-based) into 0-based indices. */
export function parseRange(text: string, count: number): number[] {
  const out = new Set<number>();
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= count) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}

function PageRange({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <label className="row">
      <span>{t('Pages')}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('all, or e.g. 1-3, 5')} />
    </label>
  );
}

function selection(range: string): PageSelection {
  const count = useStore.getState().pageIds.length;
  const r = range.trim().toLowerCase();
  return !r || r === 'all' || r === tr('all').toLowerCase() ? 'all' : parseRange(range, count);
}

function defaultRange(): string {
  const sel = useStore.getState().selectedPages;
  if (sel.length > 1) return [...sel].sort((a, b) => a - b).map((i) => i + 1).join(', ');
  return tr('all');
}

function WatermarkDialog({ close }: { close: () => void }) {
  const t = useT();
  // The default text is page content, so it follows the interface language.
  const [o, setO] = useState(() => ({ text: tr('CONFIDENTIAL'), fontSize: 60, color: '#e53935', opacity: 0.25, angle: 45 }));
  const [range, setRange] = useState(defaultRange);
  return (
    <Modal title={t('Add watermark')} onClose={close} footer={<><button onClick={close}>{t('Cancel')}</button><button className="primary" onClick={() => { close(); cmd.watermark({ ...o, pages: selection(range) }); }}>{t('Apply')}</button></>}>
      <label className="row"><span>{t('Text')}</span><input value={o.text} onChange={(e) => setO({ ...o, text: e.target.value })} /></label>
      <label className="row"><span>{t('Font size')}</span><input type="number" min={6} max={300} value={o.fontSize} onChange={(e) => setO({ ...o, fontSize: Number(e.target.value) })} /></label>
      <label className="row"><span>{t('Colour')}</span><input type="color" value={o.color} onChange={(e) => setO({ ...o, color: e.target.value })} /></label>
      <label className="row"><span>{t('Opacity')}</span><input type="range" min={0.05} max={1} step={0.05} value={o.opacity} onChange={(e) => setO({ ...o, opacity: Number(e.target.value) })} /><span className="muted">{Math.round(o.opacity * 100)}%</span></label>
      <label className="row"><span>{t('Angle')}</span><input type="number" min={-180} max={180} value={o.angle} onChange={(e) => setO({ ...o, angle: Number(e.target.value) })} /></label>
      <PageRange value={range} onChange={setRange} />
    </Modal>
  );
}

const POSITIONS: Position[] = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];

function HeaderFooterDialog({ close }: { close: () => void }) {
  const t = useT();
  const pageOf = tr('Page {page} of {pages}');
  const [o, setO] = useState<Omit<HeaderFooterOptions, 'pages'>>({
    template: pageOf, position: 'bottom-center', fontSize: 10, color: '#000000', margin: 24, startNumber: 1, batesPrefix: '', batesDigits: 6,
  });
  const [range, setRange] = useState(defaultRange);
  return (
    <Modal title={t('Header, footer & Bates numbering')} onClose={close} footer={<><button onClick={close}>{t('Cancel')}</button><button className="primary" onClick={() => { close(); cmd.headerFooter({ ...o, pages: selection(range) }); }}>{t('Apply')}</button></>}>
      <label className="row"><span>{t('Text')}</span><input value={o.template} onChange={(e) => setO({ ...o, template: e.target.value })} /></label>
      <p className="muted small">{t('Placeholders:')} <code>{'{page}'}</code> <code>{'{pages}'}</code> <code>{'{date}'}</code> <code>{'{title}'}</code> <code>{'{bates}'}</code></p>
      <div className="row">
        <span>{t('Presets')}</span>
        <div className="chips">
          <button onClick={() => setO({ ...o, template: pageOf })}>{t('Page X of Y')}</button>
          <button onClick={() => setO({ ...o, template: '{page}' })}>{t('Number only')}</button>
          <button onClick={() => setO({ ...o, template: '{bates}', batesPrefix: o.batesPrefix || 'DOC-', position: 'bottom-right' })}>Bates</button>
        </div>
      </div>
      <label className="row"><span>{t('Position')}</span>
        <select value={o.position} onChange={(e) => setO({ ...o, position: e.target.value as Position })}>
          {POSITIONS.map((p) => <option key={p} value={p}>{t(p.replace('-', ' '))}</option>)}
        </select>
      </label>
      <label className="row"><span>{t('Font size')}</span><input type="number" min={4} max={72} value={o.fontSize} onChange={(e) => setO({ ...o, fontSize: Number(e.target.value) })} /></label>
      <label className="row"><span>{t('Colour')}</span><input type="color" value={o.color} onChange={(e) => setO({ ...o, color: e.target.value })} /></label>
      <label className="row"><span>{t('Margin (pt)')}</span><input type="number" min={0} value={o.margin} onChange={(e) => setO({ ...o, margin: Number(e.target.value) })} /></label>
      <label className="row"><span>{t('Start number')}</span><input type="number" min={0} value={o.startNumber} onChange={(e) => setO({ ...o, startNumber: Number(e.target.value) })} /></label>
      <label className="row"><span>{t('Bates prefix')}</span><input value={o.batesPrefix} onChange={(e) => setO({ ...o, batesPrefix: e.target.value })} /></label>
      <label className="row"><span>{t('Bates digits')}</span><input type="number" min={1} max={12} value={o.batesDigits} onChange={(e) => setO({ ...o, batesDigits: Number(e.target.value) })} /></label>
      <PageRange value={range} onChange={setRange} />
    </Modal>
  );
}

function CropDialog({ close }: { close: () => void }) {
  const t = useT();
  const [m, setM] = useState({ top: 36, right: 36, bottom: 36, left: 36 });
  const [range, setRange] = useState(() => {
    const s = useStore.getState();
    return (s.selectedPages.length ? s.selectedPages : [s.currentPage]).map((i) => i + 1).join(', ');
  });
  const apply = () => {
    const sel = selection(range);
    const pages = sel === 'all' ? useStore.getState().pageIds.map((_, i) => i) : sel;
    close();
    cmd.crop(m, pages);
  };
  return (
    <Modal title={t('Crop pages')} onClose={close} footer={<><button onClick={close}>{t('Cancel')}</button><button className="primary" onClick={apply}>{t('Crop')}</button></>}>
      <p className="muted small">{t('Margins in points (72 pt = 1 inch), measured on the page as displayed.')}</p>
      {(['top', 'right', 'bottom', 'left'] as const).map((k) => (
        <label className="row" key={k}><span>{t(k[0].toUpperCase() + k.slice(1))}</span><input type="number" min={0} value={m[k]} onChange={(e) => setM({ ...m, [k]: Number(e.target.value) })} /></label>
      ))}
      <PageRange value={range} onChange={setRange} />
    </Modal>
  );
}

function SplitDialog({ close }: { close: () => void }) {
  const t = useT();
  const [n, setN] = useState(1);
  const count = useStore((s) => s.pageIds.length);
  return (
    <Modal title={t('Split document')} onClose={close} footer={<><button onClick={close}>{t('Cancel')}</button><button className="primary" onClick={() => { close(); cmd.split(n); }}>{t('Split')}</button></>}>
      <label className="row"><span>{t('Pages per file')}</span><input type="number" min={1} max={count} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value)))} /></label>
      <p className="muted small">{tf('Creates {n} file(s). Your browser may ask permission to download multiple files.', { n: Math.ceil(count / n) })}</p>
    </Modal>
  );
}

function MetadataDialog({ close }: { close: () => void }) {
  const [m, setM] = useState<Metadata | null>(null);
  const name = useStore((s) => s.fileName);
  const pages = useStore((s) => s.pageIds.length);
  const size = useStore((s) => s.bytes?.length ?? 0);
  useEffect(() => {
    const b = useStore.getState().bytes;
    if (b) getMetadata(b).then(setM).catch(() => setM({ title: '', author: '', subject: '', keywords: '', creator: '', producer: '' }));
  }, []);
  const editable = useCan('modify');
  const t = useT();
  const lang = useLang((l) => l.lang);
  return (
    <Modal title={t('Document properties')} onClose={close} footer={<><button onClick={close}>{t('Cancel')}</button><button className="primary" disabled={!m || !editable} onClick={() => { close(); cmd.setMetadata(m!); }}>{t('Save')}</button></>}>
      <p className="muted small">{name} · {tf('{n} page(s)', { n: pages })} · {(size / 1024).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB</p>
      {!m ? <p>{t('Loading…')}</p> : (Object.keys(m) as (keyof Metadata)[]).map((k) => (
        <label className="row" key={k}><span>{t(k[0].toUpperCase() + k.slice(1))}</span><input value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value })} /></label>
      ))}
    </Modal>
  );
}

function GotoDialog({ close }: { close: () => void }) {
  const count = useStore((s) => s.pageIds.length);
  const [v, setV] = useState(String(useStore.getState().currentPage + 1));
  const t = useT();
  const go = () => {
    close();
    useStore.getState().goToPage(Number(v) - 1);
  };
  return (
    <Modal title={t('Go to page')} onClose={close} footer={<><button onClick={close}>{t('Cancel')}</button><button className="primary" onClick={go}>{t('Go')}</button></>}>
      <label className="row"><span>{tf('Page (1–{count})', { count })}</span><input autoFocus type="number" min={1} max={count} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} /></label>
    </Modal>
  );
}

/** Bundled handwriting fonts (signatureFonts.css): the same choice on every system, also offline. */
const SIG_FONTS = ["'Dancing Script', cursive", "'Great Vibes', cursive", "'Caveat', cursive", "'Allura', cursive"];

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function SignatureDialog({ close }: { close: () => void }) {
  const [mode, setMode] = useState<'draw' | 'type' | 'upload'>('draw');
  const [typed, setTyped] = useState(useStore.getState().author === 'Guest' ? '' : useStore.getState().author);
  const [font, setFont] = useState(SIG_FONTS[0]);
  const [color, setColor] = useState('#0d47a1');
  const [upload, setUpload] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  /** The box the strokes cover, kept while drawing (canvas pixels). */
  const inkBox = useRef<Box | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const t = useT();

  const ctx = () => {
    const c = canvas.current!.getContext('2d')!;
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = color;
    return c;
  };
  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [((e.clientX - r.left) * canvas.current!.width) / r.width, ((e.clientY - r.top) * canvas.current!.height) / r.height] as const;
  };

  const grow = (x: number, y: number) => {
    const b = inkBox.current;
    inkBox.current = b ? { x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) } : { x0: x, y0: y, x1: x, y1: y };
  };

  /**
   * Crop a canvas to `box` (plus a margin) and return a PNG data URL. The box comes from
   * the strokes or the measured text, not from reading pixels back: Firefox's
   * fingerprinting protection alters what a page reads from a canvas.
   */
  const cropped = (c: HTMLCanvasElement, box: Box | null) => {
    if (!box) return null;
    const pad = 6;
    const x0 = Math.max(0, Math.floor(box.x0 - pad));
    const y0 = Math.max(0, Math.floor(box.y0 - pad));
    const x1 = Math.min(c.width, Math.ceil(box.x1 + pad));
    const y1 = Math.min(c.height, Math.ceil(box.y1 + pad));
    if (x1 <= x0 || y1 <= y0) return null;
    const out = document.createElement('canvas');
    out.width = x1 - x0;
    out.height = y1 - y0;
    out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return { src: out.toDataURL('image/png'), width: out.width, height: out.height };
  };

  const place = async () => {
    try {
      let img: { src: string; width: number; height: number } | null = null;
      if (mode === 'draw' && canvas.current) {
        const b = inkBox.current;
        // Half the line width around the stroke centres.
        img = cropped(canvas.current, b && { x0: b.x0 - 2, y0: b.y0 - 2, x1: b.x1 + 2, y1: b.y1 + 2 });
      }
      if (mode === 'type' && typed.trim()) {
        // The canvas does not wait for a web font: load it first.
        await document.fonts.load(`110px ${font}`, typed).catch(() => undefined);
        const c = document.createElement('canvas');
        const g = c.getContext('2d')!;
        g.font = `110px ${font}`;
        const m = g.measureText(typed);
        // Room for swashes that reach beyond the advance width.
        const left = Math.max(m.actualBoundingBoxLeft, 0) + 20;
        c.width = Math.ceil(left + Math.max(m.actualBoundingBoxRight, m.width) + 20);
        c.height = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + 40);
        const baseline = m.actualBoundingBoxAscent + 20;
        g.font = `110px ${font}`;
        g.fillStyle = color;
        g.fillText(typed, left, baseline);
        img = cropped(c, { x0: left - m.actualBoundingBoxLeft, y0: baseline - m.actualBoundingBoxAscent, x1: left + Math.max(m.actualBoundingBoxRight, m.width), y1: baseline + m.actualBoundingBoxDescent });
      }
      if (mode === 'upload' && upload) img = await cmd.normaliseImage(upload);
      if (!img) return useStore.getState().notify(t(mode === 'type' ? 'Type your name first.' : mode === 'draw' ? 'Draw your signature first.' : 'Choose an image first.'), 'error');
      close();
      // About 1/4 of the canvas pixels (a typed name is ~150 pt wide), at most 220 × 90 pt.
      const k = Math.min(1, 220 / (img.width / 4), 90 / (img.height / 4)) / 4;
      // It hangs on the pointer like a stamp until a click places it.
      placeCustomStamp({ id: uid('sig'), name: t('Signature'), src: img.src, width: img.width * k, height: img.height * k, signature: true });
    } catch (e) {
      console.error(e);
      useStore.getState().notify(`${t('Could not place the signature')}: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <Modal title={t('Add signature')} wide onClose={close} footer={<><span className="muted small print-hint">{t('Then click on the page to place it.')}</span><button onClick={close}>{t('Cancel')}</button><button className="primary" onClick={place}>{t('Place signature')}</button></>}>
      <div className="tabs">
        {(['draw', 'type', 'upload'] as const).map((m) => <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>{t(m[0].toUpperCase() + m.slice(1))}</button>)}
        <span className="spacer" />
        {mode !== 'upload' && <label className="inline">{t('Ink')} <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>}
      </div>
      {mode === 'draw' && (
        <>
          <canvas
            ref={canvas}
            className="sig-pad"
            width={900}
            height={260}
            onPointerDown={(e) => { drawing.current = true; canvas.current!.setPointerCapture(e.pointerId); const c = ctx(); c.beginPath(); c.moveTo(...pos(e)); grow(...pos(e)); }}
            onPointerMove={(e) => { if (!drawing.current) return; const c = ctx(); c.lineTo(...pos(e)); c.stroke(); grow(...pos(e)); setHasInk(true); }}
            onPointerUp={() => (drawing.current = false)}
          />
          <div className="row"><span className="muted small">{t('Sign above with your mouse, pen or finger.')}</span><span className="spacer" /><button disabled={!hasInk} onClick={() => { const c = canvas.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); inkBox.current = null; setHasInk(false); }}>{t('Clear')}</button></div>
        </>
      )}
      {mode === 'type' && (
        <>
          <input className="sig-typed" value={typed} placeholder={t('Your name')} onChange={(e) => setTyped(e.target.value)} style={{ fontFamily: font, color }} />
          <div className="chips sig-fonts">{SIG_FONTS.map((f) => <button key={f} className={font === f ? 'active' : ''} style={{ fontFamily: f }} onClick={() => setFont(f)}>{typed || t('Signature')}</button>)}</div>
        </>
      )}
      {mode === 'upload' && (
        <div className="sig-upload">
          <input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setUpload(await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(f); })); }} />
          {upload && <img src={upload} alt={t('Signature preview')} />}
        </div>
      )}
      <p className="muted small">{t('This places an image of your signature. For a certificate-based digital signature use Protect → Sign.')}</p>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl+O', 'Open'], ['Ctrl+S', 'Save'], ['Ctrl+P', 'Print'], ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+F', 'Find'], ['Ctrl+K', 'Search commands'], ['Ctrl+G', 'Go to page'],
  ['Ctrl + / Ctrl −', 'Zoom in / out'], ['Ctrl+0', 'Fit width'], ['Delete', 'Delete selected annotation'], ['Esc', 'Select tool / deselect'],
  ['V', 'Edit comments'], ['X', 'Select text'], ['G', 'Snapshot'], ['H', 'Hand'], ['Shift+H', 'Highlight'], ['U', 'Underline'], ['K', 'Strikeout'], ['P', 'Pencil'], ['R', 'Rectangle'], ['O', 'Ellipse'],
  ['L', 'Line'], ['A', 'Arrow'], ['Y', 'Polygon'], ['J', 'Polyline'], ['W', 'Cloud'], ['T', 'Text box'], ['N', 'Sticky note'], ['S', 'Stamp'], ['PageUp / PageDown', 'Previous / next page'],
];

/** German keyboards label the keys differently. */
const DE_KEYS: [RegExp, string][] = [[/Ctrl/g, 'Strg'], [/Shift/g, 'Umschalt'], [/^Delete$/, 'Entf'], [/PageUp/g, 'Bild↑'], [/PageDown/g, 'Bild↓']];

function ShortcutsDialog({ close }: { close: () => void }) {
  const t = useT();
  const lang = useLang((l) => l.lang);
  const keys = (k: string) => (lang === 'de' ? DE_KEYS.reduce((s, [re, to]) => s.replace(re, to), k) : k);
  return (
    <Modal title={t('Keyboard shortcuts')} onClose={close}>
      <table className="shortcuts"><tbody>{SHORTCUTS.map(([k, v]) => <tr key={k}><td><kbd>{keys(k)}</kbd></td><td>{t(v)}</td></tr>)}</tbody></table>
    </Modal>
  );
}

const STATUS_ICON = { pass: '✓', warn: '!', fail: '✕' } as const;
const A11Y_STATUS = { pass: 'Passed', warn: 'Warning', fail: 'Failed' } as const;

function AccessibilityDialog({ close }: { close: () => void }) {
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [error, setError] = useState('');
  const canModify = useCan('modify');
  const docVersion = useStore((s) => s.docVersion);
  const lang = useLang((l) => l.lang);
  const t = useT();
  useEffect(() => {
    let live = true;
    runAccessibilityCheck().then((r) => live && setResults(r)).catch((e) => live && setError(String((e as Error).message ?? e)));
    return () => {
      live = false;
    };
    // Results are worded in the interface language, so re-run when it changes.
  }, [docVersion, lang]);
  const fails = results?.filter((r) => r.status !== 'pass').length ?? 0;
  return (
    <Modal title={t('Accessibility check')} onClose={close} footer={<button className="primary" onClick={close}>{t('Close')}</button>}>
      {error ? <p className="error-text">{t(error)}</p> : !results ? <p className="muted">{t('Checking…')}</p> : (
        <>
          <p className="muted small">{fails ? tf('{n} of {count} checks need attention.', { n: fails, count: results.length }) : t('All checks passed.')} {t('This is a quick structural check, not a full PDF/UA validation.')}</p>
          <ul className="a11y-results">
            {results.map((r) => (
              <li key={r.id} className={`a11y-${r.status}`}>
                <span className="a11y-icon" aria-label={t(A11Y_STATUS[r.status])}>{STATUS_ICON[r.status]}</span>
                <div>
                  <div className="a11y-label">{r.label}</div>
                  <div className="muted small">{r.detail}</div>
                </div>
                {r.fix && <button disabled={!canModify} onClick={() => fixAccessibility(r.fix!)}>{t('Fix')}</button>}
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

export function Dialogs() {
  const { open, close } = useDialog();
  return <Suspense fallback={null}>{dialogFor(open, close)}</Suspense>;
}

function dialogFor(open: DialogName | null, close: () => void) {
  // Bookmark dialogs are all named bm…
  if (open && /^bm[A-Z]/.test(open)) return <BookmarkDialog name={open as BookmarkDialogName} close={close} />;
  switch (open) {
    case 'watermark': return <WatermarkDialog close={close} />;
    case 'headerFooter': return <HeaderFooterDialog close={close} />;
    case 'crop': return <CropDialog close={close} />;
    case 'split': return <SplitDialog close={close} />;
    case 'metadata': return <MetadataDialog close={close} />;
    case 'signature': return <SignatureDialog close={close} />;
    case 'shortcuts': return <ShortcutsDialog close={close} />;
    case 'goto': return <GotoDialog close={close} />;
    case 'security': return <SecurityDialog close={close} />;
    case 'permissions': return <PermissionsDialog close={close} />;
    case 'accessibility': return <AccessibilityDialog close={close} />;
    case 'recompress': return <RecompressDialog close={close} />;
    case 'barcodes': return <BarcodesDialog close={close} />;
    case 'ocr': return <OcrDialog close={close} />;
    case 'print': return <PrintDialog close={close} />;
    case 'measureScale': return <ScaleDialog close={close} />;
    case 'insertBarcode': return <BarcodeDialog close={close} />;
    case 'preferences': return <PrefsDialog close={close} />;
    case 'calibrate': return <CalibrateDialog close={close} annotation={useDialog.getState().payload as Annotation} />;
    case 'sign': return <SignDialog close={close} placement={useDialog.getState().payload as SignPlacement | undefined} />;
    case 'orgInsertBlank': case 'orgInsertFile': case 'orgMerge': case 'orgImagePages': case 'orgDelete': case 'orgExtract': case 'orgMove': case 'orgSplit':
    case 'orgDuplicate': case 'orgReplace': case 'orgSwap': case 'orgOverlay': case 'orgNormalize': case 'orgFindDuplicates': case 'orgRotate': case 'orgCrop':
    case 'orgAutoCrop': case 'orgResize': case 'orgMargins': case 'orgWatermark': case 'orgBackground': case 'orgHeaderFooter': case 'orgBates': case 'orgPageLabels':
      return <OrganizeDialog name={open} close={close} />;
    default: return null;
  }
}
