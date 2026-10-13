import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { X } from 'lucide-react';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import * as cmd from '../store/commands';
import { getMetadata, type HeaderFooterOptions, type Metadata, type Position, type PageSelection } from '../lib/pdfOps';
import { fixAccessibility, runAccessibilityCheck } from '../store/extras';
import type { CheckResult } from '../lib/accessibility';
import { BarcodesDialog, RecompressDialog } from './ContentDialogs';
import { PermissionsDialog, SecurityDialog, SignDialog, type SignPlacement } from './SecurityDialogs';

export type DialogName = 'watermark' | 'headerFooter' | 'crop' | 'split' | 'metadata' | 'signature' | 'shortcuts' | 'goto' | 'security' | 'permissions' | 'sign' | 'accessibility' | 'recompress' | 'barcodes';

export const useDialog = create<{ open: DialogName | null; payload: unknown; show(d: DialogName, payload?: unknown): void; close(): void }>()((set) => ({
  open: null,
  payload: undefined,
  show: (open, payload) => set({ open, payload }),
  close: () => set({ open: null, payload: undefined }),
}));

export function Modal({ title, children, onClose, footer, wide }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
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
  return (
    <label className="row">
      <span>Pages</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="all, or e.g. 1-3, 5" />
    </label>
  );
}

function selection(range: string): PageSelection {
  const count = useStore.getState().pageIds.length;
  return !range.trim() || range.trim().toLowerCase() === 'all' ? 'all' : parseRange(range, count);
}

function defaultRange(): string {
  const sel = useStore.getState().selectedPages;
  if (sel.length > 1) return [...sel].sort((a, b) => a - b).map((i) => i + 1).join(', ');
  return 'all';
}

function WatermarkDialog({ close }: { close: () => void }) {
  const [o, setO] = useState({ text: 'CONFIDENTIAL', fontSize: 60, color: '#e53935', opacity: 0.25, angle: 45 });
  const [range, setRange] = useState(defaultRange);
  return (
    <Modal title="Add watermark" onClose={close} footer={<><button onClick={close}>Cancel</button><button className="primary" onClick={() => { close(); cmd.watermark({ ...o, pages: selection(range) }); }}>Apply</button></>}>
      <label className="row"><span>Text</span><input value={o.text} onChange={(e) => setO({ ...o, text: e.target.value })} /></label>
      <label className="row"><span>Font size</span><input type="number" min={6} max={300} value={o.fontSize} onChange={(e) => setO({ ...o, fontSize: Number(e.target.value) })} /></label>
      <label className="row"><span>Colour</span><input type="color" value={o.color} onChange={(e) => setO({ ...o, color: e.target.value })} /></label>
      <label className="row"><span>Opacity</span><input type="range" min={0.05} max={1} step={0.05} value={o.opacity} onChange={(e) => setO({ ...o, opacity: Number(e.target.value) })} /><span className="muted">{Math.round(o.opacity * 100)}%</span></label>
      <label className="row"><span>Angle</span><input type="number" min={-180} max={180} value={o.angle} onChange={(e) => setO({ ...o, angle: Number(e.target.value) })} /></label>
      <PageRange value={range} onChange={setRange} />
    </Modal>
  );
}

const POSITIONS: Position[] = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];

function HeaderFooterDialog({ close }: { close: () => void }) {
  const [o, setO] = useState<Omit<HeaderFooterOptions, 'pages'>>({
    template: 'Page {page} of {pages}', position: 'bottom-center', fontSize: 10, color: '#000000', margin: 24, startNumber: 1, batesPrefix: '', batesDigits: 6,
  });
  const [range, setRange] = useState(defaultRange);
  return (
    <Modal title="Header, footer & Bates numbering" onClose={close} footer={<><button onClick={close}>Cancel</button><button className="primary" onClick={() => { close(); cmd.headerFooter({ ...o, pages: selection(range) }); }}>Apply</button></>}>
      <label className="row"><span>Text</span><input value={o.template} onChange={(e) => setO({ ...o, template: e.target.value })} /></label>
      <p className="muted small">Placeholders: <code>{'{page}'}</code> <code>{'{pages}'}</code> <code>{'{date}'}</code> <code>{'{title}'}</code> <code>{'{bates}'}</code></p>
      <div className="row">
        <span>Presets</span>
        <div className="chips">
          <button onClick={() => setO({ ...o, template: 'Page {page} of {pages}' })}>Page X of Y</button>
          <button onClick={() => setO({ ...o, template: '{page}' })}>Number only</button>
          <button onClick={() => setO({ ...o, template: '{bates}', batesPrefix: o.batesPrefix || 'DOC-', position: 'bottom-right' })}>Bates</button>
        </div>
      </div>
      <label className="row"><span>Position</span>
        <select value={o.position} onChange={(e) => setO({ ...o, position: e.target.value as Position })}>
          {POSITIONS.map((p) => <option key={p} value={p}>{p.replace('-', ' ')}</option>)}
        </select>
      </label>
      <label className="row"><span>Font size</span><input type="number" min={4} max={72} value={o.fontSize} onChange={(e) => setO({ ...o, fontSize: Number(e.target.value) })} /></label>
      <label className="row"><span>Colour</span><input type="color" value={o.color} onChange={(e) => setO({ ...o, color: e.target.value })} /></label>
      <label className="row"><span>Margin (pt)</span><input type="number" min={0} value={o.margin} onChange={(e) => setO({ ...o, margin: Number(e.target.value) })} /></label>
      <label className="row"><span>Start number</span><input type="number" min={0} value={o.startNumber} onChange={(e) => setO({ ...o, startNumber: Number(e.target.value) })} /></label>
      <label className="row"><span>Bates prefix</span><input value={o.batesPrefix} onChange={(e) => setO({ ...o, batesPrefix: e.target.value })} /></label>
      <label className="row"><span>Bates digits</span><input type="number" min={1} max={12} value={o.batesDigits} onChange={(e) => setO({ ...o, batesDigits: Number(e.target.value) })} /></label>
      <PageRange value={range} onChange={setRange} />
    </Modal>
  );
}

function CropDialog({ close }: { close: () => void }) {
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
    <Modal title="Crop pages" onClose={close} footer={<><button onClick={close}>Cancel</button><button className="primary" onClick={apply}>Crop</button></>}>
      <p className="muted small">Margins in points (72 pt = 1 inch), measured on the page as displayed.</p>
      {(['top', 'right', 'bottom', 'left'] as const).map((k) => (
        <label className="row" key={k}><span>{k[0].toUpperCase() + k.slice(1)}</span><input type="number" min={0} value={m[k]} onChange={(e) => setM({ ...m, [k]: Number(e.target.value) })} /></label>
      ))}
      <PageRange value={range} onChange={setRange} />
    </Modal>
  );
}

function SplitDialog({ close }: { close: () => void }) {
  const [n, setN] = useState(1);
  const count = useStore((s) => s.pageIds.length);
  return (
    <Modal title="Split document" onClose={close} footer={<><button onClick={close}>Cancel</button><button className="primary" onClick={() => { close(); cmd.split(n); }}>Split</button></>}>
      <label className="row"><span>Pages per file</span><input type="number" min={1} max={count} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value)))} /></label>
      <p className="muted small">Creates {Math.ceil(count / n)} file(s). Your browser may ask permission to download multiple files.</p>
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
  return (
    <Modal title="Document properties" onClose={close} footer={<><button onClick={close}>Cancel</button><button className="primary" disabled={!m || !editable} onClick={() => { close(); cmd.setMetadata(m!); }}>Save</button></>}>
      <p className="muted small">{name} · {pages} page(s) · {(size / 1024).toFixed(1)} KB</p>
      {!m ? <p>Loading…</p> : (Object.keys(m) as (keyof Metadata)[]).map((k) => (
        <label className="row" key={k}><span>{k[0].toUpperCase() + k.slice(1)}</span><input value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value })} /></label>
      ))}
    </Modal>
  );
}

function GotoDialog({ close }: { close: () => void }) {
  const count = useStore((s) => s.pageIds.length);
  const [v, setV] = useState(String(useStore.getState().currentPage + 1));
  const go = () => {
    close();
    useStore.getState().goToPage(Number(v) - 1);
  };
  return (
    <Modal title="Go to page" onClose={close} footer={<><button onClick={close}>Cancel</button><button className="primary" onClick={go}>Go</button></>}>
      <label className="row"><span>Page (1–{count})</span><input autoFocus type="number" min={1} max={count} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} /></label>
    </Modal>
  );
}

const SIG_FONTS = ['"Brush Script MT", cursive', '"Segoe Script", cursive', '"Snell Roundhand", cursive', 'cursive'];

function SignatureDialog({ close }: { close: () => void }) {
  const [mode, setMode] = useState<'draw' | 'type' | 'upload'>('draw');
  const [typed, setTyped] = useState(useStore.getState().author === 'Guest' ? '' : useStore.getState().author);
  const [font, setFont] = useState(SIG_FONTS[0]);
  const [color, setColor] = useState('#0d47a1');
  const [upload, setUpload] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

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

  /** Crop a canvas to its non-transparent pixels and return a PNG data URL. */
  const trimmed = (c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let [x0, y0, x1, y1] = [c.width, c.height, 0, 0];
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    if (x1 <= x0 || y1 <= y0) return null;
    const pad = 6;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + pad * 2;
    out.height = y1 - y0 + pad * 2;
    out.getContext('2d')!.drawImage(c, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
    return { src: out.toDataURL('image/png'), width: out.width, height: out.height };
  };

  const place = async () => {
    let img: { src: string; width: number; height: number } | null = null;
    if (mode === 'draw' && canvas.current) img = trimmed(canvas.current);
    if (mode === 'type' && typed.trim()) {
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 220;
      const g = c.getContext('2d')!;
      g.font = `110px ${font}`;
      g.fillStyle = color;
      g.textBaseline = 'middle';
      g.fillText(typed, 20, 110, 860);
      img = trimmed(c);
    }
    if (mode === 'upload' && upload) img = await cmd.normaliseImage(upload);
    if (!img) return;
    close();
    // Render at roughly 1/4 of canvas pixels so a signature is ~150pt wide.
    cmd.placeImage(img.src, img.width / 4, img.height / 4, { signature: true, maxW: 220, maxH: 90 });
  };

  return (
    <Modal title="Add signature" wide onClose={close} footer={<><button onClick={close}>Cancel</button><button className="primary" onClick={place}>Place signature</button></>}>
      <div className="tabs">
        {(['draw', 'type', 'upload'] as const).map((m) => <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>)}
        <span className="spacer" />
        {mode !== 'upload' && <label className="inline">Ink <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>}
      </div>
      {mode === 'draw' && (
        <>
          <canvas
            ref={canvas}
            className="sig-pad"
            width={900}
            height={260}
            onPointerDown={(e) => { drawing.current = true; canvas.current!.setPointerCapture(e.pointerId); const c = ctx(); c.beginPath(); c.moveTo(...pos(e)); }}
            onPointerMove={(e) => { if (!drawing.current) return; const c = ctx(); c.lineTo(...pos(e)); c.stroke(); setHasInk(true); }}
            onPointerUp={() => (drawing.current = false)}
          />
          <div className="row"><span className="muted small">Sign above with your mouse, pen or finger.</span><span className="spacer" /><button disabled={!hasInk} onClick={() => { const c = canvas.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setHasInk(false); }}>Clear</button></div>
        </>
      )}
      {mode === 'type' && (
        <>
          <input className="sig-typed" value={typed} placeholder="Your name" onChange={(e) => setTyped(e.target.value)} style={{ fontFamily: font, color }} />
          <div className="chips">{SIG_FONTS.map((f) => <button key={f} className={font === f ? 'active' : ''} style={{ fontFamily: f }} onClick={() => setFont(f)}>{typed || 'Signature'}</button>)}</div>
        </>
      )}
      {mode === 'upload' && (
        <div className="sig-upload">
          <input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setUpload(await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(f); })); }} />
          {upload && <img src={upload} alt="Signature preview" />}
        </div>
      )}
      <p className="muted small">This places a visual signature image. Cryptographic (certificate-based) digital signatures are on the roadmap.</p>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl+O', 'Open'], ['Ctrl+S', 'Save'], ['Ctrl+P', 'Print'], ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+F', 'Find'], ['Ctrl+G', 'Go to page'],
  ['Ctrl + / Ctrl −', 'Zoom in / out'], ['Ctrl+0', 'Fit width'], ['Delete', 'Delete selected annotation'], ['Esc', 'Select tool / deselect'],
  ['V', 'Edit comments'], ['X', 'Select text'], ['G', 'Snapshot'], ['H', 'Hand'], ['Shift+H', 'Highlight'], ['U', 'Underline'], ['K', 'Strikeout'], ['P', 'Pencil'], ['R', 'Rectangle'], ['O', 'Ellipse'],
  ['L', 'Line'], ['A', 'Arrow'], ['T', 'Text box'], ['N', 'Sticky note'], ['S', 'Stamp'], ['PageUp / PageDown', 'Previous / next page'],
];

function ShortcutsDialog({ close }: { close: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={close}>
      <table className="shortcuts"><tbody>{SHORTCUTS.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
    </Modal>
  );
}

const STATUS_ICON = { pass: '✓', warn: '!', fail: '✕' } as const;

function AccessibilityDialog({ close }: { close: () => void }) {
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [error, setError] = useState('');
  const canModify = useCan('modify');
  const docVersion = useStore((s) => s.docVersion);
  useEffect(() => {
    let live = true;
    runAccessibilityCheck().then((r) => live && setResults(r)).catch((e) => live && setError(String((e as Error).message ?? e)));
    return () => {
      live = false;
    };
  }, [docVersion]);
  const fails = results?.filter((r) => r.status !== 'pass').length ?? 0;
  return (
    <Modal title="Accessibility check" onClose={close} footer={<button className="primary" onClick={close}>Close</button>}>
      {error ? <p className="error-text">{error}</p> : !results ? <p className="muted">Checking…</p> : (
        <>
          <p className="muted small">{fails ? `${fails} of ${results.length} checks need attention.` : 'All checks passed.'} This is a quick structural check, not a full PDF/UA validation.</p>
          <ul className="a11y-results">
            {results.map((r) => (
              <li key={r.id} className={`a11y-${r.status}`}>
                <span className="a11y-icon" aria-label={r.status}>{STATUS_ICON[r.status]}</span>
                <div>
                  <div className="a11y-label">{r.label}</div>
                  <div className="muted small">{r.detail}</div>
                </div>
                {r.fix && <button disabled={!canModify} onClick={() => fixAccessibility(r.fix!)}>Fix</button>}
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
    case 'sign': return <SignDialog close={close} placement={useDialog.getState().payload as SignPlacement | undefined} />;
    default: return null;
  }
}
