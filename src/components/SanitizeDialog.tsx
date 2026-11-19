import { useState } from 'react';
import { Modal } from './Dialogs';
import { useStore } from '../store/store';
import { sanitizeDocument } from '../store/cleanupCommands';
import { hasSignature } from '../store/optimizeCommands';
import type { SanitizeOptions } from '../lib/sanitize';
import { useT } from '../lib/i18n';

const PARTS: [keyof SanitizeOptions, string, string][] = [
  ['scripts', 'Scripts', 'JavaScript in the document, pages, form fields and links; links that start programs; XFA forms. Form calculations stop working.'],
  ['externalActions', 'Form submission and remote actions', 'Buttons that send form data to a server or import it, and links into other files.'],
  ['attachments', 'Attached files', 'Files attached to the document or as comments on the pages.'],
  ['metadata', 'Metadata', 'Author, dates, producer, XMP metadata and other programs’ private data. The title is kept.'],
  ['hiddenData', 'Hidden data', 'Embedded page thumbnails and web capture information.'],
];

/** Protect › Sanitize: remove what can run, call out or carry hidden information. */
export function SanitizeDialog({ close }: { close: () => void }) {
  const t = useT();
  const bytes = useStore((s) => s.bytes);
  const [o, setO] = useState<SanitizeOptions>({ scripts: true, externalActions: true, attachments: false, metadata: true, hiddenData: true });
  const [signed] = useState(() => !!bytes && hasSignature(bytes));
  const any = Object.values(o).some(Boolean);
  return (
    <Modal
      title={t('Sanitize document')}
      onClose={close}
      footer={
        <>
          <button onClick={close}>{t('Cancel')}</button>
          <button className="primary" disabled={!any} onClick={() => { close(); sanitizeDocument(o); }}>{t('Sanitize')}</button>
        </>
      }
    >
      <p className="muted small">{t('Remove what could run, send data or reveal more than the pages show. What the pages look like does not change.')}</p>
      {PARTS.map(([k, label, hint]) => (
        <label key={k} className="row choice">
          <input type="checkbox" checked={!!o[k]} onChange={(e) => setO({ ...o, [k]: e.target.checked })} />
          <span>
            {t(label)}
            <br />
            <span className="muted small">{t(hint)}</span>
          </span>
        </label>
      ))}
      <p className="muted small">{t('Comments, form fields and web links stay. To remove comments too, flatten them first; to remove hidden text, use redaction.')}</p>
      {signed && <p className="warn-text small">{t('This document is digitally signed. Sanitizing it invalidates the signatures.')}</p>}
    </Modal>
  );
}
