/** Insert a QR code or barcode: it hangs on the pointer like a stamp and is placed with a click. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Dialogs';
import { drawBarcode, type BarcodeKind, type QrLevel } from '../lib/barcode';
import { placeCustomStamp } from '../store/contentActions';
import { uid } from '../store/store';
import { useT } from '../lib/i18n';

const NOFLEX = { flex: 'none' } as const;
const MM = 72 / 25.4;
const STORAGE_KEY = 'pdf-xploder.barcode';

interface Settings {
  kind: BarcodeKind;
  level: QrLevel;
  caption: boolean;
  color: string;
  /** Width on the page in millimetres. */
  width: number;
}

function initial(): Settings {
  try {
    return { kind: 'qr', level: 'M', caption: true, color: '#000000', width: 30, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return { kind: 'qr', level: 'M', caption: true, color: '#000000', width: 30 };
  }
}

const EXAMPLES: Record<BarcodeKind, string> = { qr: 'https://', code128: 'ABC-12345', ean13: '400638133393' };

export function BarcodeDialog({ close }: { close: () => void }) {
  const t = useT();
  const [o, setO] = useState<Settings>(initial);
  const [text, setText] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const set = (p: Partial<Settings>) => setO({ ...o, ...p });

  // Encode (or explain what is wrong) as the user types.
  const result = useMemo(() => {
    if (!text.trim()) return { error: null as string | null, canvas: null as HTMLCanvasElement | null, ratio: 1 };
    try {
      const { canvas, modules } = drawBarcode({ kind: o.kind, text, level: o.level, caption: o.caption, color: o.color });
      return { error: null, canvas, ratio: modules.h / modules.w };
    } catch (e) {
      const msg = (e as Error).message;
      return { error: t(/overflow/i.test(msg) ? 'The text is too long for a QR code.' : msg), canvas: null, ratio: 1 };
    }
  }, [text, o.kind, o.level, o.caption, o.color, t]);

  useEffect(() => {
    const c = result.canvas;
    if (!c) return host.current?.replaceChildren();
    c.style.width = '100%';
    c.style.height = 'auto';
    c.style.imageRendering = 'pixelated';
    host.current?.replaceChildren(c);
  }, [result]);

  const place = () => {
    if (!result.canvas) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
    } catch {
      /* storage unavailable */
    }
    const width = o.width * MM;
    placeCustomStamp({ id: uid('code'), name: text, src: result.canvas.toDataURL('image/png'), width, height: width * result.ratio });
    close();
  };

  return (
    <Modal
      title={t('Insert QR code or barcode')}
      onClose={close}
      footer={<><span className="muted small print-hint">{t('Then click on the page to place it.')}</span><button onClick={close}>{t('Cancel')}</button><button className="primary" disabled={!result.canvas} onClick={place}>{t('Place on page')}</button></>}
    >
      <label className="row"><span>{t('Code type')}</span>
        <select aria-label={t('Code type')} value={o.kind} onChange={(e) => {
          const kind = e.target.value as BarcodeKind;
          set({ kind, width: kind === 'qr' ? 30 : 50 });
        }}>
          <option value="qr">{t('QR code')}</option>
          <option value="code128">Code 128</option>
          <option value="ean13">EAN-13</option>
        </select>
      </label>
      <label className="row"><span>{t(o.kind === 'qr' ? 'Text or link' : 'Content')}</span>
        {o.kind === 'qr'
          ? <textarea rows={3} autoFocus aria-label={t('Text or link')} placeholder={EXAMPLES.qr} value={text} onChange={(e) => setText(e.target.value)} />
          : <input autoFocus aria-label={t('Content')} placeholder={EXAMPLES[o.kind]} value={text} onChange={(e) => setText(e.target.value)} />}
      </label>
      {o.kind === 'qr' ? (
        <label className="row"><span>{t('Error correction')}</span>
          <select aria-label={t('Error correction')} value={o.level} onChange={(e) => set({ level: e.target.value as QrLevel })}>
            <option value="L">{t('Low (7%)')}</option>
            <option value="M">{t('Medium (15%)')}</option>
            <option value="Q">{t('Quartile (25%)')}</option>
            <option value="H">{t('High (30%)')}</option>
          </select>
        </label>
      ) : (
        <label className="row"><input type="checkbox" style={NOFLEX} checked={o.caption} onChange={(e) => set({ caption: e.target.checked })} /> {t('Show the text below the bars')}</label>
      )}
      <label className="row"><span>{t('Width (mm)')}</span><input type="number" min={5} max={500} aria-label={t('Width (mm)')} value={o.width} onChange={(e) => set({ width: Math.max(5, Number(e.target.value) || 30) })} /></label>
      <label className="row"><span>{t('Colour')}</span><input type="color" aria-label={t('Colour')} value={o.color} onChange={(e) => set({ color: e.target.value })} /></label>
      <div className="barcode-preview" ref={host} aria-label={t('Preview')} />
      {result.error && <p className="error-text small">{result.error}</p>}
    </Modal>
  );
}
