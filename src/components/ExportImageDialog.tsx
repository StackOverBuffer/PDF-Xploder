/** Convert › To image: save pages as PNG, JPEG, WebP or TIFF, one file or a ZIP of several. */
import { useState } from 'react';
import { Modal } from './Dialogs';
import { useStore } from '../store/store';
import * as cmd from '../store/commands';
import type { ImageFormat } from '../store/commands';
import { tf, useT } from '../lib/i18n';

/** Whether the browser can encode WebP at all (Chrome and Edge can, Firefox cannot). */
export function webpSupported(): boolean {
  // Guarded for the node tests, which never build a canvas.
  return typeof document !== 'undefined' && document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');
}

// The names are the same in every interface language.
const FORMATS: [ImageFormat, string][] = [['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP'], ['tiff', 'TIFF']];

export function ExportImageDialog({ close }: { close: () => void }) {
  const t = useT();
  const count = useStore((s) => s.pageIds.length);
  const current = useStore((s) => s.currentPage);
  const selected = useStore((s) => s.selectedPages);
  const [scope, setScope] = useState<'current' | 'selected' | 'all'>('current');
  const [format, setFormat] = useState<ImageFormat>('png');
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(85);
  const webp = webpSupported();

  const pages = scope === 'current' ? [current] : scope === 'selected' ? [...selected].sort((a, b) => a - b) : Array.from({ length: count }, (_, i) => i);

  const ok = () => {
    close();
    // JPEG and WebP lose information: their quality slider has no business with PNG and TIFF.
    cmd.exportPageImages({ pages, format, dpi: Math.min(600, Math.max(72, dpi || 150)), quality: format === 'jpeg' || format === 'webp' ? quality : undefined });
  };

  return (
    <Modal title={t('Export pages as images')} onClose={close} footer={<><button onClick={close}>{t('Cancel')}</button><button className="primary" onClick={ok}>{t('Export')}</button></>}>
      <h3 className="section">{t('Pages')}</h3>
      <label className="row choice"><input type="radio" name="export-image-scope" checked={scope === 'current'} onChange={() => setScope('current')} /> <span>{tf('Current page ({n})', { n: current + 1 })}</span></label>
      <label className="row choice" title={selected.length ? undefined : t('No pages are selected in the thumbnail panel.')}>
        <input type="radio" name="export-image-scope" disabled={!selected.length} checked={scope === 'selected'} onChange={() => setScope('selected')} /> <span>{tf('Selected pages ({n})', { n: selected.length })}</span>
      </label>
      <label className="row choice"><input type="radio" name="export-image-scope" checked={scope === 'all'} onChange={() => setScope('all')} /> <span>{t('All pages')}</span></label>
      <h3 className="section">{t('Format')}</h3>
      {FORMATS.map(([f, label]) => (
        <label key={f} className="row choice" title={f === 'webp' && !webp ? t('WebP is not supported by this browser.') : undefined}>
          <input type="radio" name="export-image-format" checked={format === f} disabled={f === 'webp' && !webp} onChange={() => setFormat(f)} /> <span>{label}</span>
        </label>
      ))}
      {!webp && <p className="muted small">{t('WebP is not supported by this browser.')}</p>}
      <label className="row"><span>{t('Resolution (DPI)')}</span><input type="number" min={72} max={600} value={dpi} onChange={(e) => setDpi(Number(e.target.value))} /></label>
      {format !== 'png' && format !== 'tiff' && (
        <label className="row"><span>{t('Quality')}</span><input type="range" min={10} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} /><span>{quality}%</span></label>
      )}
    </Modal>
  );
}
