import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Modal, useDialog } from './Dialogs';
import { imageCanvas, recompressImage } from '../store/contentActions';
import { useT } from '../lib/i18n';

/** Re-encode an image object with a chosen quality and resolution. */
export function RecompressDialog({ close }: { close: () => void }) {
  const t = useT();
  const { page, id } = useDialog.getState().payload as { page: number; id: number };
  const [quality, setQuality] = useState(75);
  const [size, setSize] = useState(100);
  const [info, setInfo] = useState<{ w: number; h: number; bytes?: number } | null>(null);
  useEffect(() => {
    let live = true;
    imageCanvas(page, id).then(({ canvas, encodedSize }) => live && setInfo({ w: canvas.width, h: canvas.height, bytes: encodedSize })).catch(() => {});
    return () => {
      live = false;
    };
  }, [page, id]);
  return (
    <Modal
      title={t('Recompress Image')}
      onClose={close}
      footer={
        <>
          <button onClick={close}>{t('Cancel')}</button>
          <button className="primary" onClick={() => { close(); recompressImage(page, id, quality / 100, size / 100); }}>{t('Recompress')}</button>
        </>
      }
    >
      {info && (
        <p className="muted small">
          {t('Current image')}: {info.w} × {info.h} px{info.bytes ? ` · ${Math.round(info.bytes / 1024)} KB` : ''} → {Math.round((info.w * size) / 100)} × {Math.round((info.h * size) / 100)} px
        </p>
      )}
      <label className="row"><span>{t('JPEG quality')}</span><input type="range" min={10} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} /><span>{quality}%</span></label>
      <label className="row"><span>{t('Resolution')}</span><input type="range" min={10} max={100} step={5} value={size} onChange={(e) => setSize(Number(e.target.value))} /><span>{size}%</span></label>
      <p className="muted small">{t('Transparent images are kept as PNG.')}</p>
    </Modal>
  );
}

/** Results of barcode recognition. */
export function BarcodesDialog({ close }: { close: () => void }) {
  const t = useT();
  const codes = useDialog.getState().payload as { rawValue: string; format: string }[];
  return (
    <Modal title={t('Recognized barcodes')} onClose={close} footer={<button className="primary" onClick={close}>{t('Close')}</button>}>
      {codes.length === 0 ? <p className="muted">{t('No barcodes found in this image.')}</p> : (
        <ul className="barcodes">
          {codes.map((c, i) => (
            <li key={i}>
              <span className="muted small">{c.format}</span>
              <code>{c.rawValue}</code>
              <button className="icon-btn" title={t('Copy')} onClick={() => navigator.clipboard?.writeText(c.rawValue)}><Copy size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
