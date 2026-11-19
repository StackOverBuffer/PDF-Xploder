import { useState } from 'react';
import { Modal } from './Dialogs';
import { useStore } from '../store/store';
import { formatSize, hasSignature, optimize } from '../store/optimizeCommands';
import { PRESETS, type OptimizeOptions } from '../lib/optimize';
import { useT } from '../lib/i18n';

type Preset = keyof typeof PRESETS | 'lossless' | 'custom';

const PRESET_LABELS: [Preset, string, string][] = [
  ['small', 'Smallest file', 'Images at 100 ppi, JPEG quality 60%: for reading on screen and sending by mail.'],
  ['balanced', 'Balanced', 'Images at 150 ppi, JPEG quality 75%: good on screen and in office printing.'],
  ['print', 'High quality', 'Images at 300 ppi, JPEG quality 85%: for printing. CMYK images stay CMYK.'],
  ['lossless', 'Lossless only', 'Images stay as they are; only the file structure is cleaned up.'],
  ['custom', 'Custom', 'Choose the resolution and quality yourself.'],
];

/** File › Compress: shrink the whole document. */
export function OptimizeDialog({ close }: { close: () => void }) {
  const t = useT();
  const bytes = useStore((s) => s.bytes);
  const [preset, setPreset] = useState<Preset>('balanced');
  const [quality, setQuality] = useState(75);
  const [dpi, setDpi] = useState(150);
  const [downsample, setDownsample] = useState(true);
  const [metadata, setMetadata] = useState(false);
  const [thumbs, setThumbs] = useState(true);
  const [signed] = useState(() => !!bytes && hasSignature(bytes));

  const images: OptimizeOptions =
    preset === 'lossless' ? {} : preset === 'custom' ? { jpegQuality: quality / 100, maxDpi: downsample ? dpi : undefined, convertOtherImages: true } : PRESETS[preset];
  const run = () => {
    close();
    optimize({ ...images, removeMetadata: metadata, removeThumbnails: thumbs, mergeDuplicates: true, compressStreams: true });
  };

  return (
    <Modal
      title={t('Compress document')}
      onClose={close}
      footer={
        <>
          <button onClick={close}>{t('Cancel')}</button>
          <button className="primary" onClick={run}>{t('Compress')}</button>
        </>
      }
    >
      {bytes && <p className="muted small">{t('Current size')}: {formatSize(bytes.length)}</p>}
      {PRESET_LABELS.map(([p, label, hint]) => (
        <label key={p} className="row choice">
          <input type="radio" name="optimize-preset" checked={preset === p} onChange={() => setPreset(p)} />
          <span>
            {t(label)}
            <br />
            <span className="muted small">{t(hint)}</span>
          </span>
        </label>
      ))}
      {preset === 'custom' && (
        <>
          <label className="row"><span>{t('JPEG quality')}</span><input type="range" min={10} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} /><span>{quality}%</span></label>
          <label className="row choice">
            <input type="checkbox" checked={downsample} onChange={(e) => setDownsample(e.target.checked)} />
            <span>{t('Reduce images to')}</span>
            <select style={{ flex: 'none' }} value={dpi} disabled={!downsample} onChange={(e) => setDpi(Number(e.target.value))}>
              {[72, 96, 100, 150, 200, 300].map((d) => <option key={d} value={d}>{d} ppi</option>)}
            </select>
          </label>
        </>
      )}
      <div className="optimize-extras">
      <label className="row choice"><input type="checkbox" checked={thumbs} onChange={(e) => setThumbs(e.target.checked)} /> <span>{t('Remove embedded page thumbnails')}</span></label>
      <label className="row choice"><input type="checkbox" checked={metadata} onChange={(e) => setMetadata(e.target.checked)} /> <span>{t('Remove metadata (author, dates, XMP) except the title')}</span></label>
      </div>
      <p className="muted small">{t('Unused objects are always removed, identical fonts and images are stored once, and transparent areas and black-and-white scans stay lossless.')}</p>
      {signed && <p className="warn-text small">{t('This document is digitally signed. Compressing it invalidates the signatures.')}</p>}
    </Modal>
  );
}
