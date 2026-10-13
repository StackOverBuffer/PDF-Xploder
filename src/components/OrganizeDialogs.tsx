/** Dialogs of the Organize ("Dokumentaufbau") tab. */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useStore } from '../store/store';
import * as cmd from '../store/commands';
import * as oc from '../store/organizeCommands';
import * as org from '../lib/organize';
import type { Position } from '../lib/pdfOps';
import { fileBytes, pickFile } from '../lib/download';
import { tr, useT } from '../lib/i18n';
import { Modal, parseRange, useDialog } from './Dialogs';

const S = useStore.getState;

const LIST: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 200, overflowY: 'auto' };
const ITEM: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 };
const GRID: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, 22px)', gap: 3 };
const CELL = (on: boolean): CSSProperties => ({ width: 22, height: 22, padding: 0, background: on ? 'var(--accent)' : undefined, borderColor: on ? 'var(--accent)' : undefined });
const NONE: CSSProperties = { flex: 'none', width: 'auto' };
const FULL: CSSProperties = { width: '100%', boxSizing: 'border-box' };
const TABLE: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' };

// ---------------------------------------------------------------- building blocks

type Close = { close: () => void };

const isAll = (text: string) => !text.trim() || ['all', tr('all').toLowerCase()].includes(text.trim().toLowerCase());

/** Page indices from a range like "1-3, 5" ("all" or empty: every page). */
export function resolvePages(text: string): number[] {
  const n = S().pageIds.length;
  return isAll(text) ? oc.allPages() : parseRange(text, n);
}

/** Initial range text: the thumbnail selection (or current page), or "all" unless several pages are selected. */
function initialRange(mode: 'selection' | 'all'): string {
  const s = S();
  if (mode === 'all' && s.selectedPages.length < 2) return tr('all');
  return org.rangeText(cmd.targetPages());
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  const t = useT();
  return <label className="row"><span>{t(label)}</span>{children}</label>;
}

function PagesRow({ value, onChange, label = 'Pages' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const t = useT();
  const n = resolvePages(value).length;
  return (
    <Row label={label}>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('all, or e.g. 1-3, 5')} />
      <span className="muted small">{n}</span>
    </Row>
  );
}

function Num({ value, onChange, min, max, step, style }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; style?: CSSProperties }) {
  return <input type="number" style={style} value={Number.isFinite(value) ? value : ''} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />;
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const t = useT();
  return (
    <label className="row">
      <span />
      <input type="checkbox" style={NONE} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{t(label)}</span>
    </label>
  );
}

function Choice<T extends string>({ value, onChange, options, style }: { value: T; onChange: (v: T) => void; options: [T, string][]; style?: CSSProperties }) {
  const t = useT();
  return (
    <select style={style} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
    </select>
  );
}

function Foot({ close, ok, label = 'OK', disabled }: Close & { ok: () => void; label?: string; disabled?: boolean }) {
  const t = useT();
  return (
    <>
      <button onClick={close}>{t('Cancel')}</button>
      <button className="primary" disabled={disabled} onClick={() => { close(); ok(); }}>{t(label)}</button>
    </>
  );
}

function Hint({ children }: { children: string }) {
  const t = useT();
  return <p className="muted small">{t(children)}</p>;
}

/** Where pages go: before/after a page, or at the start/end of the document. */
interface Where {
  mode: 'before' | 'after' | 'start' | 'end';
  page: number;
}

function whereIndex(w: Where): number {
  const n = S().pageIds.length;
  const p = Math.min(Math.max(1, Math.round(w.page) || 1), n);
  return w.mode === 'start' ? 0 : w.mode === 'end' ? n : w.mode === 'before' ? p - 1 : p;
}

const initialWhere = (): Where => ({ mode: 'after', page: S().currentPage + 1 });

function WhereRow({ value, onChange, label = 'Position' }: { value: Where; onChange: (w: Where) => void; label?: string }) {
  const n = useStore((s) => s.pageIds.length);
  return (
    <Row label={label}>
      <Choice value={value.mode} onChange={(mode) => onChange({ ...value, mode })} options={[['before', 'Before page'], ['after', 'After page'], ['start', 'At the start'], ['end', 'At the end']]} />
      {(value.mode === 'before' || value.mode === 'after') && <Num value={value.page} min={1} max={n} onChange={(page) => onChange({ ...value, page })} />}
    </Row>
  );
}

/** Choose a file; shows its name and (for PDFs) its page count. */
function FileRow({ label = 'File', accept, file, onChange }: { label?: string; accept: string; file: { name: string; pages?: number } | null; onChange: (f: File) => void }) {
  const t = useT();
  return (
    <Row label={label}>
      <button onClick={async () => { const [f] = await pickFile(accept); if (f) onChange(f); }}>{t('Choose…')}</button>
      <span className="muted small">{file ? `${file.name}${file.pages ? ` · ${file.pages} ${t('page(s)')}` : ''}` : t('No file chosen')}</span>
    </Row>
  );
}

/** A picked PDF with its bytes and page count. */
function usePdfFile() {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array; pages: number } | null>(null);
  const choose = async (f: File) => {
    const bytes = await fileBytes(f);
    const pages = await S().run(tr('Opening…'), () => oc.pageCountOf(bytes));
    if (pages) setFile({ name: f.name, bytes, pages });
  };
  return [file, choose] as const;
}

const PAPER: Record<string, [number, number]> = {
  A3: [841.89, 1190.55], A4: [595.28, 841.89], A5: [419.53, 595.28], Letter: [612, 792], Legal: [612, 1008], Tabloid: [792, 1224],
};
type Unit = 'mm' | 'in' | 'pt';
const UNIT: Record<Unit, number> = { mm: 72 / 25.4, in: 72, pt: 1 };
const toUnit = (pt: number, u: Unit) => Math.round((pt / UNIT[u]) * 100) / 100;

function UnitChoice({ value, onChange }: { value: Unit; onChange: (u: Unit) => void }) {
  return <Choice style={NONE} value={value} onChange={onChange} options={[['mm', 'mm'], ['in', 'in'], ['pt', 'pt']]} />;
}

function SizeRows({ size, onChange }: { size: [number, number]; onChange: (s: [number, number]) => void }) {
  const t = useT();
  const [unit, setUnit] = useState<Unit>('mm');
  const preset = Object.entries(PAPER).find(([, [w, h]]) => (Math.abs(w - size[0]) < 0.5 && Math.abs(h - size[1]) < 0.5) || (Math.abs(h - size[0]) < 0.5 && Math.abs(w - size[1]) < 0.5))?.[0] ?? 'custom';
  return (
    <>
      <Row label="Paper size">
        <select value={preset} onChange={(e) => {
          const p = PAPER[e.target.value];
          if (p) onChange(size[0] > size[1] ? [p[1], p[0]] : p);
        }}>
          {Object.keys(PAPER).map((k) => <option key={k} value={k}>{k}</option>)}
          <option value="custom">{t('Custom')}</option>
        </select>
        <button title={t('Swap width and height')} onClick={() => onChange([size[1], size[0]])}>{size[0] > size[1] ? t('Landscape') : t('Portrait')}</button>
      </Row>
      <Row label="Width">
        <Num value={toUnit(size[0], unit)} min={1} step={0.1} onChange={(v) => onChange([v * UNIT[unit], size[1]])} />
        <UnitChoice value={unit} onChange={setUnit} />
      </Row>
      <Row label="Height">
        <Num value={toUnit(size[1], unit)} min={1} step={0.1} onChange={(v) => onChange([size[0], v * UNIT[unit]])} />
      </Row>
    </>
  );
}

function MarginRows({ value, onChange }: { value: { top: number; right: number; bottom: number; left: number }; onChange: (m: typeof value) => void }) {
  const [unit, setUnit] = useState<Unit>('mm');
  return (
    <>
      {(['top', 'right', 'bottom', 'left'] as const).map((k, i) => (
        <Row key={k} label={k[0].toUpperCase() + k.slice(1)}>
          <Num value={toUnit(value[k], unit)} min={0} step={0.5} onChange={(v) => onChange({ ...value, [k]: Math.max(0, v) * UNIT[unit] })} />
          {i === 0 ? <UnitChoice value={unit} onChange={setUnit} /> : <span className="muted small">{unit}</span>}
        </Row>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- pages

function InsertBlankDialog({ close }: Close) {
  const t = useT();
  const [count, setCount] = useState(1);
  const [same, setSame] = useState(true);
  const [size, setSize] = useState<[number, number]>(PAPER.A4);
  const [where, setWhere] = useState(initialWhere);
  return (
    <Modal title={t('Insert blank pages')} onClose={close} footer={<Foot close={close} label="Insert" ok={() => oc.insertBlankPages(whereIndex(where), Math.max(1, Math.round(count)), same ? undefined : size)} />}>
      <Row label="Number of pages"><Num value={count} min={1} max={1000} onChange={setCount} /></Row>
      <Check checked={same} onChange={setSame} label="Same size as the neighbouring page" />
      {!same && <SizeRows size={size} onChange={setSize} />}
      <WhereRow value={where} onChange={setWhere} />
    </Modal>
  );
}

/** Insert pages from a PDF file, or (merge) all pages of several files. */
function InsertFileDialog({ close, merge }: Close & { merge?: boolean }) {
  const t = useT();
  const [file, choose] = usePdfFile();
  const [files, setFiles] = useState<File[]>([]);
  const [range, setRange] = useState(tr('all'));
  const [where, setWhere] = useState<Where>(merge ? { mode: 'end', page: 1 } : initialWhere);
  const move = (i: number, d: number) => setFiles((fs) => {
    const next = [...fs];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return next;
  });
  const ok = () => {
    if (merge) return oc.insertPdfFiles(files, whereIndex(where));
    if (!file) return;
    const pages = isAll(range) ? Array.from({ length: file.pages }, (_, i) => i) : parseRange(range, file.pages);
    oc.insertPagesFromFile(file.bytes, pages, whereIndex(where));
  };
  return (
    <Modal title={t(merge ? 'Merge files' : 'Insert pages from file')} onClose={close} footer={<Foot close={close} label={merge ? 'Merge' : 'Insert'} disabled={merge ? !files.length : !file} ok={ok} />}>
      {merge ? (
        <>
          <Hint>All pages of these PDF files are inserted into this document, in this order.</Hint>
          <ul style={LIST}>
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} style={ITEM}>
                <span className="spacer">{f.name}</span>
                <button className="icon-btn" disabled={i === 0} aria-label={t('Move up')} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                <button className="icon-btn" disabled={i === files.length - 1} aria-label={t('Move down')} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
                <button className="icon-btn" aria-label={t('Remove')} onClick={() => setFiles(files.filter((_, k) => k !== i))}><X size={14} /></button>
              </li>
            ))}
          </ul>
          <div className="row"><button onClick={async () => setFiles([...files, ...(await pickFile('application/pdf,.pdf', true))])}>{t('Add files…')}</button></div>
        </>
      ) : (
        <>
          <FileRow accept="application/pdf,.pdf" file={file} onChange={choose} />
          <Row label="Pages of the file"><input value={range} onChange={(e) => setRange(e.target.value)} placeholder={t('all, or e.g. 1-3, 5')} /></Row>
        </>
      )}
      <WhereRow value={where} onChange={setWhere} />
    </Modal>
  );
}

function ImagePagesDialog({ close }: Close) {
  const t = useT();
  const [files, setFiles] = useState<File[]>([]);
  const [paper, setPaper] = useState<'image' | 'A4' | 'Letter' | 'current'>('A4');
  const [margin, setMargin] = useState(0);
  const [where, setWhere] = useState(initialWhere);
  const ok = () => {
    const g = S().geoms[S().currentPage];
    const cur = g ? [g.view[2] - g.view[0], g.view[3] - g.view[1]] as [number, number] : PAPER.A4;
    const size = paper === 'image' ? null : paper === 'current' ? cur : PAPER[paper];
    oc.insertImagePages(files, whereIndex(where), { size, margin: margin * UNIT.mm });
  };
  return (
    <Modal title={t('Insert images as pages')} onClose={close} footer={<Foot close={close} label="Insert" disabled={!files.length} ok={ok} />}>
      <Row label="Images">
        <button onClick={async () => setFiles(await pickFile('image/*', true))}>{t('Choose…')}</button>
        <span className="muted small">{files.length ? files.map((f) => f.name).join(', ') : t('No file chosen')}</span>
      </Row>
      <Row label="Page size">
        <Choice value={paper} onChange={setPaper} options={[['image', 'Image size (96 dpi)'], ['A4', 'A4'], ['Letter', 'Letter'], ['current', 'Same as the current page']]} />
      </Row>
      <Row label="Margin (mm)"><Num value={margin} min={0} onChange={setMargin} /></Row>
      <Hint>Each image is fitted and centred on its own page, turned to match the image's orientation.</Hint>
      <WhereRow value={where} onChange={setWhere} />
    </Modal>
  );
}

function DeleteDialog({ close }: Close) {
  const t = useT();
  const [range, setRange] = useState(() => initialRange('selection'));
  const [subset, setSubset] = useState<org.Subset>('all');
  return (
    <Modal title={t('Delete pages')} onClose={close} footer={<Foot close={close} label="Delete" ok={() => oc.deletePageList(org.filterPages(resolvePages(range), subset))} />}>
      <PagesRow value={range} onChange={setRange} />
      <SubsetRow value={subset} onChange={setSubset} />
    </Modal>
  );
}

function SubsetRow({ value, onChange }: { value: org.Subset; onChange: (s: org.Subset) => void }) {
  return <Row label="Subset"><Choice value={value} onChange={onChange} options={[['all', 'All pages in range'], ['odd', 'Odd pages only'], ['even', 'Even pages only']]} /></Row>;
}

function ExtractDialog({ close }: Close) {
  const t = useT();
  const [range, setRange] = useState(() => initialRange('selection'));
  const [subset, setSubset] = useState<org.Subset>('all');
  const [o, setO] = useState<oc.ExtractOptions>({ separate: false, deleteAfter: false });
  return (
    <Modal title={t('Extract pages')} onClose={close} footer={<Foot close={close} label="Extract" ok={() => oc.extractPageList(org.filterPages(resolvePages(range), subset), o)} />}>
      <PagesRow value={range} onChange={setRange} />
      <SubsetRow value={subset} onChange={setSubset} />
      <Check checked={o.separate} onChange={(separate) => setO({ ...o, separate })} label="One file per page" />
      <Check checked={o.deleteAfter} onChange={(deleteAfter) => setO({ ...o, deleteAfter })} label="Delete the pages after extracting" />
      <Hint>The extracted pages are downloaded as new PDF files, with their comments.</Hint>
    </Modal>
  );
}

function MoveDialog({ close }: Close) {
  const t = useT();
  const [range, setRange] = useState(() => initialRange('selection'));
  const [where, setWhere] = useState<Where>({ mode: 'end', page: 1 });
  return (
    <Modal title={t('Move pages')} onClose={close} footer={<Foot close={close} label="Move" ok={() => cmd.movePages(resolvePages(range), whereIndex(where))} />}>
      <PagesRow value={range} onChange={setRange} />
      <WhereRow value={where} onChange={setWhere} label="Move to" />
    </Modal>
  );
}

type SplitKind = 'pages' | 'ranges' | 'bookmarks' | 'size' | 'single';

function SplitDialog({ close }: Close) {
  const t = useT();
  const count = useStore((s) => s.pageIds.length);
  const [kind, setKind] = useState<SplitKind>((useDialog.getState().payload as SplitKind | undefined) ?? 'pages');
  const [every, setEvery] = useState(1);
  const [ranges, setRanges] = useState('');
  const [mb, setMb] = useState(5);
  const ok = () => {
    if (kind === 'pages' || kind === 'single') return oc.splitDocument({ kind: 'pages', every: kind === 'single' ? 1 : every });
    if (kind === 'ranges') return oc.splitDocument({ kind: 'ranges', groups: ranges.split(';').map((r) => parseRange(r, count)).filter((g) => g.length) });
    if (kind === 'bookmarks') return oc.splitDocument({ kind: 'bookmarks' });
    return oc.splitDocument({ kind: 'size', megabytes: mb });
  };
  return (
    <Modal title={t('Split document')} onClose={close} footer={<Foot close={close} label="Split" ok={ok} />}>
      <Row label="Split by">
        <Choice value={kind} onChange={setKind} options={[['pages', 'Number of pages'], ['single', 'Single pages'], ['ranges', 'Page ranges'], ['bookmarks', 'Top-level bookmarks'], ['size', 'File size']]} />
      </Row>
      {kind === 'pages' && <><Row label="Pages per file"><Num value={every} min={1} max={count} onChange={(v) => setEvery(Math.max(1, v))} /></Row><p className="muted small">{t('Creates {n} file(s).').replace('{n}', String(Math.ceil(count / Math.max(1, every))))}</p></>}
      {kind === 'single' && <p className="muted small">{t('Creates {n} file(s).').replace('{n}', String(count))}</p>}
      {kind === 'ranges' && <><Row label="Ranges"><input value={ranges} placeholder="1-3; 4, 6; 7-9" onChange={(e) => setRanges(e.target.value)} /></Row><Hint>Separate the files with semicolons.</Hint></>}
      {kind === 'bookmarks' && <Hint>One file per top-level bookmark, from its page up to the next bookmark.</Hint>}
      {kind === 'size' && <Row label="Maximum size (MB)"><Num value={mb} min={0.1} step={0.5} onChange={setMb} /></Row>}
      <Hint>Your browser may ask permission to download multiple files.</Hint>
    </Modal>
  );
}

function DuplicateDialog({ close }: Close) {
  const t = useT();
  const [range, setRange] = useState(() => initialRange('selection'));
  const [copies, setCopies] = useState(1);
  const [where, setWhere] = useState<org.DuplicateWhere>('each');
  const [collate, setCollate] = useState(true);
  return (
    <Modal title={t('Duplicate pages')} onClose={close} footer={<Foot close={close} label="Duplicate" ok={() => oc.duplicatePageList(resolvePages(range), Math.max(1, copies), where, collate)} />}>
      <PagesRow value={range} onChange={setRange} />
      <Row label="Copies"><Num value={copies} min={1} max={100} onChange={setCopies} /></Row>
      <Row label="Insert copies"><Choice value={where} onChange={setWhere} options={[['each', 'After each page'], ['after', 'After the last page of the range'], ['start', 'At the start'], ['end', 'At the end']]} /></Row>
      {where !== 'each' && <Check checked={collate} onChange={setCollate} label="Collate (1, 2, 1, 2 instead of 1, 1, 2, 2)" />}
    </Modal>
  );
}

function ReplaceDialog({ close }: Close) {
  const t = useT();
  const [range, setRange] = useState(() => initialRange('selection'));
  const [file, choose] = usePdfFile();
  const [source, setSource] = useState('');
  const targets = resolvePages(range);
  const sourcePages = file ? (source.trim() ? (isAll(source) ? Array.from({ length: file.pages }, (_, i) => i) : parseRange(source, file.pages)) : Array.from({ length: Math.min(targets.length, file.pages) }, (_, i) => i)) : [];
  return (
    <Modal title={t('Replace pages')} onClose={close} footer={<Foot close={close} label="Replace" disabled={!file || !sourcePages.length} ok={() => file && oc.replacePageList(targets, file.bytes, sourcePages)} />}>
      <PagesRow label="Replace pages" value={range} onChange={setRange} />
      <FileRow label="With pages from" accept="application/pdf,.pdf" file={file} onChange={choose} />
      <Row label="Pages of the file"><input value={source} onChange={(e) => setSource(e.target.value)} placeholder={file ? org.rangeText(sourcePages) : ''} /></Row>
      <Hint>The replaced pages and their comments are removed; the new pages take the place of the first one.</Hint>
    </Modal>
  );
}

function SwapDialog({ close }: Close) {
  const t = useT();
  const sel = cmd.targetPages();
  const [a, setA] = useState(() => org.rangeText(sel.slice(0, Math.max(1, sel.length >> 1))));
  const [b, setB] = useState(() => (sel.length > 1 ? org.rangeText(sel.slice(Math.max(1, sel.length >> 1))) : ''));
  return (
    <Modal title={t('Swap pages')} onClose={close} footer={<Foot close={close} label="Swap" ok={() => oc.swapPageGroups(parseRange(a, S().pageIds.length), parseRange(b, S().pageIds.length))} />}>
      <PagesRow label="Pages" value={a} onChange={setA} />
      <PagesRow label="Swap with" value={b} onChange={setB} />
      <Hint>Each group of pages takes the place of the other.</Hint>
    </Modal>
  );
}

function OverlayDialog({ close }: Close) {
  const t = useT();
  const [file, choose] = usePdfFile();
  const [range, setRange] = useState(() => initialRange('all'));
  const [o, setO] = useState<Omit<org.OverlayOptions, 'pages'>>({ placement: 'over', mode: 'first', fit: true, opacity: 1 });
  return (
    <Modal title={t('Overlay pages')} onClose={close} footer={<Foot close={close} label="Apply" disabled={!file} ok={() => file && oc.overlayFromFile(file.bytes, { ...o, pages: resolvePages(range) })} />}>
      <FileRow label="Overlay file" accept="application/pdf,.pdf" file={file} onChange={choose} />
      <PagesRow label="On pages" value={range} onChange={setRange} />
      <Row label="Placement"><Choice value={o.placement} onChange={(placement) => setO({ ...o, placement })} options={[['over', 'In front of the page content'], ['under', 'Behind the page content']]} /></Row>
      <Row label="Pages to use"><Choice value={o.mode} onChange={(mode) => setO({ ...o, mode })} options={[['first', 'First page on every page'], ['match', 'Page by page, then stop'], ['cycle', 'Page by page, repeating']]} /></Row>
      <Check checked={o.fit} onChange={(fit) => setO({ ...o, fit })} label="Scale to fit the page" />
      <Row label="Opacity"><input type="range" min={0.05} max={1} step={0.05} value={o.opacity} onChange={(e) => setO({ ...o, opacity: Number(e.target.value) })} /><span className="muted">{Math.round(o.opacity * 100)}%</span></Row>
    </Modal>
  );
}

function NormalizeDialog({ close }: Close) {
  const t = useT();
  const [range, setRange] = useState(() => initialRange('all'));
  const [o, setO] = useState<Omit<org.NormalizeOptions, 'size'>>({ boxes: true, rotation: false, matchOrientation: true });
  const [sizeMode, setSizeMode] = useState<'none' | 'first' | 'largest' | 'smallest' | 'custom'>('none');
  const [size, setSize] = useState<[number, number]>(PAPER.A4);
  return (
    <Modal title={t('Normalize pages')} onClose={close} footer={<Foot close={close} label="Apply" ok={() => oc.normalize(resolvePages(range), { ...o, size: sizeMode === 'custom' ? size : sizeMode })} />}>
      <PagesRow value={range} onChange={setRange} />
      <Check checked={o.boxes} onChange={(boxes) => setO({ ...o, boxes })} label="Normalize page boxes (media box = crop box, origin at 0,0)" />
      <Check checked={o.rotation} onChange={(rotation) => setO({ ...o, rotation })} label="Remove page rotation (keep the pages' appearance)" />
      <Row label="Page size"><Choice value={sizeMode} onChange={setSizeMode} options={[['none', 'Keep'], ['first', 'Same as the first page'], ['largest', 'Same as the largest page'], ['smallest', 'Same as the smallest page'], ['custom', 'Custom']]} /></Row>
      {sizeMode === 'custom' && <SizeRows size={size} onChange={setSize} />}
      {sizeMode !== 'none' && <Check checked={o.matchOrientation} onChange={(matchOrientation) => setO({ ...o, matchOrientation })} label="Keep each page's orientation" />}
    </Modal>
  );
}

function FindDuplicatesDialog({ close }: Close) {
  const t = useT();
  const [visual, setVisual] = useState(false);
  const [groups, setGroups] = useState<number[][] | null>(null);
  const docVersion = useStore((s) => s.docVersion);
  useEffect(() => setGroups(null), [docVersion, visual]);
  const find = async () => setGroups((await oc.findDuplicates(visual)) ?? null);
  const extra = groups?.flatMap((g) => g.slice(1)) ?? [];
  return (
    <Modal title={t('Find duplicate pages')} onClose={close} footer={<>
      <button onClick={close}>{t('Close')}</button>
      <button disabled={!extra.length} onClick={() => S().setSelectedPages(extra)}>{t('Select duplicates')}</button>
      <button className="primary" disabled={!extra.length} onClick={() => { close(); oc.deleteDuplicates(groups!); }}>{t('Delete duplicates')}</button>
    </>}>
      <Row label="Compare"><Choice value={visual ? 'visual' : 'content'} onChange={(v) => setVisual(v === 'visual')} options={[['content', 'Page content (identical pages)'], ['visual', 'Appearance (similar-looking pages)']]} /></Row>
      <div className="row"><span /><button className="primary" onClick={find}>{t('Start search')}</button></div>
      {groups && (groups.length ? (
        <>
          <p>{t('{n} group(s) of duplicate pages. The first page of each group is kept.').replace('{n}', String(groups.length))}</p>
          <ul style={LIST}>
            {groups.map((g) => (
              <li key={g.join()}><button className="link" onClick={() => { S().setSelectedPages(g); S().goToPage(g[0]); }}>{t('Pages')} {g.map((i) => i + 1).join(', ')}</button></li>
            ))}
          </ul>
        </>
      ) : <p className="muted">{t('No duplicate pages found.')}</p>)}
    </Modal>
  );
}

// ---------------------------------------------------------------- page shape

function RotateDialog({ close }: Close) {
  const t = useT();
  const [range, setRange] = useState(() => initialRange('selection'));
  const [angle, setAngle] = useState<'90' | '-90' | '180'>('90');
  const [subset, setSubset] = useState<org.Subset>('all');
  const [orientation, setOrientation] = useState<org.OrientationFilter>('any');
  return (
    <Modal title={t('Rotate pages')} onClose={close} footer={<Foot close={close} label="Rotate" ok={() => oc.rotatePageList(org.filterPages(resolvePages(range), subset, orientation, oc.pageSizes()), Number(angle))} />}>
      <Row label="Direction"><Choice value={angle} onChange={setAngle} options={[['90', '90° clockwise'], ['-90', '90° counter-clockwise'], ['180', '180°']]} /></Row>
      <PagesRow value={range} onChange={setRange} />
      <SubsetRow value={subset} onChange={setSubset} />
      <Row label="Orientation"><Choice value={orientation} onChange={setOrientation} options={[['any', 'Portrait and landscape pages'], ['portrait', 'Portrait pages only'], ['landscape', 'Landscape pages only']]} /></Row>
    </Modal>
  );
}

function CropDialog({ close }: Close) {
  const t = useT();
  const [m, setM] = useState({ top: 36, right: 36, bottom: 36, left: 36 });
  const [range, setRange] = useState(() => initialRange('selection'));
  return (
    <Modal title={t('Crop pages')} onClose={close} footer={<Foot close={close} label="Crop" ok={() => cmd.crop(m, resolvePages(range))} />}>
      <Hint>Margins to cut off, measured on the page as displayed.</Hint>
      <MarginRows value={m} onChange={setM} />
      <PagesRow value={range} onChange={setRange} />
    </Modal>
  );
}

function AutoCropDialog({ close }: Close) {
  const t = useT();
  const [range, setRange] = useState(() => initialRange('selection'));
  const [padding, setPadding] = useState(2);
  return (
    <Modal title={t('Remove white margins')} onClose={close} footer={<Foot close={close} label="Crop" ok={() => oc.autoCrop(resolvePages(range), padding * UNIT.mm)} />}>
      <Hint>Crops each page to the area that has visible content.</Hint>
      <PagesRow value={range} onChange={setRange} />
      <Row label="Keep a margin of (mm)"><Num value={padding} min={0} step={0.5} onChange={setPadding} /></Row>
    </Modal>
  );
}

function AnchorGrid({ value, onChange }: { value: org.Anchor; onChange: (a: org.Anchor) => void }) {
  const t = useT();
  return (
    <div style={GRID} role="radiogroup" aria-label={t('Anchor')}>
      {org.ANCHORS.map((a) => <button key={a} role="radio" aria-checked={a === value} aria-label={t(a)} title={t(a)} style={CELL(a === value)} onClick={() => onChange(a)} />)}
    </div>
  );
}

function ResizeDialog({ close }: Close) {
  const t = useT();
  const [range, setRange] = useState(() => initialRange('all'));
  const [size, setSize] = useState<[number, number]>(PAPER.A4);
  const [o, setO] = useState<Omit<org.ResizeOptions, 'width' | 'height'>>({ mode: 'scale', anchor: 'center', matchOrientation: true });
  return (
    <Modal title={t('Resize pages')} onClose={close} footer={<Foot close={close} label="Resize" ok={() => oc.resize(resolvePages(range), { ...o, width: size[0], height: size[1] })} />}>
      <SizeRows size={size} onChange={setSize} />
      <Check checked={o.matchOrientation} onChange={(matchOrientation) => setO({ ...o, matchOrientation })} label="Keep each page's orientation" />
      <Row label="Content"><Choice value={o.mode} onChange={(mode) => setO({ ...o, mode })} options={[['scale', 'Scale to fit the new size'], ['box', 'Keep its size (change the page box only)']]} /></Row>
      <div className="row"><span>{t('Anchor')}</span><AnchorGrid value={o.anchor} onChange={(anchor) => setO({ ...o, anchor })} /></div>
      <PagesRow value={range} onChange={setRange} />
    </Modal>
  );
}

function MarginsDialog({ close }: Close) {
  const t = useT();
  const [m, setM] = useState({ top: 10 * UNIT.mm, right: 10 * UNIT.mm, bottom: 10 * UNIT.mm, left: 10 * UNIT.mm });
  const [range, setRange] = useState(() => initialRange('all'));
  return (
    <Modal title={t('Add page margins')} onClose={close} footer={<Foot close={close} label="Apply" ok={() => oc.addMargins(resolvePages(range), m)} />}>
      <Hint>Enlarges the pages on each side; the content keeps its size and place.</Hint>
      <MarginRows value={m} onChange={setM} />
      <PagesRow value={range} onChange={setRange} />
    </Modal>
  );
}

// ---------------------------------------------------------------- page marks

function WatermarkDialog({ close }: Close) {
  const t = useT();
  const [o, setO] = useState({ text: tr('CONFIDENTIAL'), fontSize: 60, color: '#e53935', opacity: 0.25, angle: 45, under: false });
  const [range, setRange] = useState(() => initialRange('all'));
  return (
    <Modal title={t('Add watermark')} onClose={close} footer={<Foot close={close} label="Apply" disabled={!o.text.trim()} ok={() => oc.addWatermark({ ...o, pages: resolvePages(range) })} />}>
      <Row label="Text"><input value={o.text} onChange={(e) => setO({ ...o, text: e.target.value })} /></Row>
      <Row label="Font size"><Num value={o.fontSize} min={6} max={300} onChange={(fontSize) => setO({ ...o, fontSize })} /></Row>
      <Row label="Colour"><input type="color" value={o.color} onChange={(e) => setO({ ...o, color: e.target.value })} /></Row>
      <Row label="Opacity"><input type="range" min={0.05} max={1} step={0.05} value={o.opacity} onChange={(e) => setO({ ...o, opacity: Number(e.target.value) })} /><span className="muted">{Math.round(o.opacity * 100)}%</span></Row>
      <Row label="Angle"><Num value={o.angle} min={-180} max={180} onChange={(angle) => setO({ ...o, angle })} /></Row>
      <Row label="Placement"><Choice value={o.under ? 'under' : 'over'} onChange={(v) => setO({ ...o, under: v === 'under' })} options={[['over', 'In front of the page content'], ['under', 'Behind the page content']]} /></Row>
      <PagesRow value={range} onChange={setRange} />
    </Modal>
  );
}

function BackgroundDialog({ close }: Close) {
  const t = useT();
  const [useColor, setUseColor] = useState(true);
  const [color, setColor] = useState('#fff8dc');
  const [image, setImage] = useState<File | null>(null);
  const [scale, setScale] = useState(100);
  const [opacity, setOpacity] = useState(1);
  const [range, setRange] = useState(() => initialRange('all'));
  return (
    <Modal title={t('Add background')} onClose={close} footer={<Foot close={close} label="Apply" disabled={!useColor && !image} ok={() => oc.addBackground({ pages: resolvePages(range), color: useColor ? color : null, imageFile: image, scale: scale / 100, opacity })} />}>
      <Row label="Colour">
        <input type="checkbox" style={NONE} checked={useColor} onChange={(e) => setUseColor(e.target.checked)} />
        {useColor && <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />}
      </Row>
      <FileRow label="Image" accept="image/*" file={image} onChange={setImage} />
      {image && <div className="row"><span /><button onClick={() => setImage(null)}>{t('Remove')}</button></div>}
      {image && <Row label="Image size (%)"><Num value={scale} min={1} max={100} onChange={setScale} /></Row>}
      <Row label="Opacity"><input type="range" min={0.05} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} /><span className="muted">{Math.round(opacity * 100)}%</span></Row>
      <Hint>The background is drawn behind the page content. Pages with an opaque white background of their own hide it.</Hint>
      <PagesRow value={range} onChange={setRange} />
    </Modal>
  );
}

const POSITION_LABELS: Record<Position, string> = {
  'top-left': 'Header left', 'top-center': 'Header centre', 'top-right': 'Header right',
  'bottom-left': 'Footer left', 'bottom-center': 'Footer centre', 'bottom-right': 'Footer right',
};

function HeaderFooterDialog({ close }: Close) {
  const t = useT();
  const [texts, setTexts] = useState<Partial<Record<Position, string>>>({ 'bottom-center': tr('Page {page} of {pages}') });
  const [o, setO] = useState({ fontSize: 10, color: '#000000', margin: 24, startNumber: 1 });
  const [range, setRange] = useState(() => initialRange('all'));
  return (
    <Modal title={t('Add headers and footers')} wide onClose={close} footer={<Foot close={close} label="Apply" ok={() => oc.addHeadersFooters({ ...o, texts, pages: resolvePages(range) })} />}>
      {org.POSITIONS.map((p) => <Row key={p} label={POSITION_LABELS[p]}><input value={texts[p] ?? ''} onChange={(e) => setTexts({ ...texts, [p]: e.target.value })} /></Row>)}
      <p className="muted small">{t('Placeholders:')} <code>{'{page}'}</code> <code>{'{pages}'}</code> <code>{'{date}'}</code> <code>{'{title}'}</code></p>
      <Row label="Font size"><Num value={o.fontSize} min={4} max={72} onChange={(fontSize) => setO({ ...o, fontSize })} /></Row>
      <Row label="Colour"><input type="color" value={o.color} onChange={(e) => setO({ ...o, color: e.target.value })} /></Row>
      <Row label="Margin (pt)"><Num value={o.margin} min={0} onChange={(margin) => setO({ ...o, margin })} /></Row>
      <Row label="First page number"><Num value={o.startNumber} min={0} onChange={(startNumber) => setO({ ...o, startNumber })} /></Row>
      <PagesRow value={range} onChange={setRange} />
    </Modal>
  );
}

function BatesDialog({ close }: Close) {
  const t = useT();
  const [o, setO] = useState<Omit<org.BatesOptions, 'pages'>>({ prefix: '', suffix: '', start: 1, digits: 6, position: 'bottom-right', fontSize: 9, color: '#000000', margin: 24 });
  const [range, setRange] = useState(() => initialRange('all'));
  const pages = resolvePages(range);
  return (
    <Modal title={t('Bates numbering')} onClose={close} footer={<Foot close={close} label="Apply" ok={() => oc.addBates({ ...o, pages })} />}>
      <Row label="Prefix"><input value={o.prefix} onChange={(e) => setO({ ...o, prefix: e.target.value })} /></Row>
      <Row label="Start number"><Num value={o.start} min={0} onChange={(start) => setO({ ...o, start: Math.max(0, Math.round(start)) })} /></Row>
      <Row label="Digits"><Num value={o.digits} min={1} max={15} onChange={(digits) => setO({ ...o, digits: Math.min(15, Math.max(1, Math.round(digits))) })} /></Row>
      <Row label="Suffix"><input value={o.suffix} onChange={(e) => setO({ ...o, suffix: e.target.value })} /></Row>
      <p className="muted small">{t('Preview:')} {org.batesLabel(o, o.start)} … {org.batesLabel(o, o.start + Math.max(0, pages.length - 1))}</p>
      <Row label="Position"><Choice value={o.position} onChange={(position) => setO({ ...o, position })} options={org.POSITIONS.map((p) => [p, POSITION_LABELS[p]])} /></Row>
      <Row label="Font size"><Num value={o.fontSize} min={4} max={72} onChange={(fontSize) => setO({ ...o, fontSize })} /></Row>
      <Row label="Colour"><input type="color" value={o.color} onChange={(e) => setO({ ...o, color: e.target.value })} /></Row>
      <Row label="Margin (pt)"><Num value={o.margin} min={0} onChange={(margin) => setO({ ...o, margin })} /></Row>
      <PagesRow value={range} onChange={setRange} />
    </Modal>
  );
}

const STYLES: [org.LabelStyle, string][] = [['D', '1, 2, 3'], ['r', 'i, ii, iii'], ['R', 'I, II, III'], ['a', 'a, b, c'], ['A', 'A, B, C'], ['', 'None (prefix only)']];

function PageLabelsDialog({ close }: Close) {
  const t = useT();
  const n = useStore((s) => s.pageIds.length);
  const [ranges, setRanges] = useState<org.PageLabelRange[] | null>(null);
  useEffect(() => {
    oc.readPageLabels().then((r) => setRanges(r.length ? r : [{ start: 0, style: 'D', prefix: '', first: 1 }])).catch(() => setRanges([{ start: 0, style: 'D', prefix: '', first: 1 }]));
  }, []);
  const update = (k: number, patch: Partial<org.PageLabelRange>) => setRanges(ranges!.map((r, i) => (i === k ? { ...r, ...patch } : r)));
  const labels = ranges ? org.pageLabels(n, ranges) : [];
  return (
    <Modal title={t('Number pages')} wide onClose={close} footer={<>
      <button onClick={() => { close(); oc.setPageLabels([]); }}>{t('Remove page labels')}</button>
      <span className="spacer" />
      <Foot close={close} label="Apply" disabled={!ranges} ok={() => oc.setPageLabels(ranges!)} />
    </>}>
      <Hint>Page labels are the page numbers viewers show, e.g. i–iv for the front matter, then 1, 2, 3.</Hint>
      {!ranges ? <p className="muted">{t('Loading…')}</p> : (
        <table style={TABLE}>
          <thead><tr><th>{t('From page')}</th><th>{t('Style')}</th><th>{t('Prefix')}</th><th>{t('Start at')}</th><th /></tr></thead>
          <tbody>
            {ranges.map((r, k) => (
              <tr key={k}>
                <td><Num style={FULL} value={r.start + 1} min={1} max={n} onChange={(v) => update(k, { start: Math.min(n, Math.max(1, Math.round(v))) - 1 })} /></td>
                <td><Choice style={FULL} value={r.style} onChange={(style) => update(k, { style })} options={STYLES} /></td>
                <td><input style={FULL} value={r.prefix} onChange={(e) => update(k, { prefix: e.target.value })} /></td>
                <td><Num style={FULL} value={r.first} min={1} onChange={(v) => update(k, { first: Math.max(1, Math.round(v)) })} /></td>
                <td><button className="icon-btn" aria-label={t('Remove')} disabled={ranges.length < 2} onClick={() => setRanges(ranges.filter((_, i) => i !== k))}><X size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ranges && <div className="row"><button onClick={() => setRanges([...ranges, { start: Math.min(n - 1, S().currentPage), style: 'D', prefix: '', first: 1 }])}>{t('Add range')}</button></div>}
      {ranges && <p className="muted small">{t('Preview:')} {labels.slice(0, 12).join(', ')}{n > 12 ? ', …' : ''}</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------- registry

export const ORGANIZE_DIALOGS = {
  orgInsertBlank: InsertBlankDialog,
  orgInsertFile: InsertFileDialog,
  orgMerge: (p: Close) => <InsertFileDialog {...p} merge />,
  orgImagePages: ImagePagesDialog,
  orgDelete: DeleteDialog,
  orgExtract: ExtractDialog,
  orgMove: MoveDialog,
  orgSplit: SplitDialog,
  orgDuplicate: DuplicateDialog,
  orgReplace: ReplaceDialog,
  orgSwap: SwapDialog,
  orgOverlay: OverlayDialog,
  orgNormalize: NormalizeDialog,
  orgFindDuplicates: FindDuplicatesDialog,
  orgRotate: RotateDialog,
  orgCrop: CropDialog,
  orgAutoCrop: AutoCropDialog,
  orgResize: ResizeDialog,
  orgMargins: MarginsDialog,
  orgWatermark: WatermarkDialog,
  orgBackground: BackgroundDialog,
  orgHeaderFooter: HeaderFooterDialog,
  orgBates: BatesDialog,
  orgPageLabels: PageLabelsDialog,
} satisfies Record<string, (p: Close) => ReactNode>;

export type OrganizeDialogName = keyof typeof ORGANIZE_DIALOGS;

/** Render an Organize dialog by name (null for other names). */
export function OrganizeDialog({ name, close }: { name: string; close: () => void }) {
  const D = ORGANIZE_DIALOGS[name as OrganizeDialogName];
  return D ? <D close={close} /> : null;
}
