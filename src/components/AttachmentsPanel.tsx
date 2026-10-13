import { useEffect, useState } from 'react';
import { Download, Paperclip, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import { attachFiles, deleteAttachment, listAttachments, saveAttachment, useExtras } from '../store/extras';
import type { AttachmentInfo } from '../lib/attachments';
import { useT } from '../lib/i18n';

const size = (n: number | null) => (n === null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Files embedded in the document. */
export function AttachmentsPanel() {
  const t = useT();
  const bytes = useStore((s) => s.bytes);
  const version = useExtras((x) => x.attachmentsVersion);
  const canModify = useCan('modify');
  const canCopy = useCan('copy');
  const [items, setItems] = useState<AttachmentInfo[] | null>(null);

  useEffect(() => {
    let live = true;
    setItems(null);
    if (bytes) listAttachments().then((a) => live && setItems(a)).catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [bytes, version]);

  return (
    <div className="panel">
      <div className="panel-title">{t('Attachments')}</div>
      <div className="panel-toolbar">
        <button title={t('Attach files')} disabled={!canModify} onClick={attachFiles}><Plus size={16} /></button>
      </div>
      {items === null ? <p className="muted pad">{t('Loading…')}</p> : items.length === 0 ? <p className="muted pad">{t('This document has no attached files.')}</p> : (
        <ul className="attachments">
          {items.map((a) => (
            <li key={a.key} className="attachment" title={a.description || a.fileName}>
              <Paperclip size={14} />
              <div className="attachment-info">
                <div className="attachment-name">{a.fileName}</div>
                <div className="muted small">{[size(a.size), a.description].filter(Boolean).join(' · ')}</div>
              </div>
              <button className="icon-btn" title={t('Save to disk')} disabled={!canCopy} onClick={() => saveAttachment(a)}><Download size={14} /></button>
              <button className="icon-btn" title={t('Remove')} disabled={!canModify} onClick={() => deleteAttachment(a)}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
