/** Shows the questions asked with ask() / askText(), one at a time. */
import { useState } from 'react';
import { Modal } from './Dialogs';
import { useAsk } from '../lib/ask';
import { useT } from '../lib/i18n';

export function AskHost() {
  const q = useAsk((s) => s.queue[0]);
  return q ? <AskDialog key={q.id} /> : null;
}

function AskDialog() {
  const t = useT();
  const q = useAsk((s) => s.queue[0]);
  const [value, setValue] = useState(q.value ?? '');
  const cancel = () => q.resolve(q.text ? null : false);
  const ok = () => q.resolve(q.text ? value : true);
  return (
    <Modal
      className="ask"
      title={t(q.title ?? (q.text ? 'Enter' : 'Please confirm'))}
      onClose={cancel}
      footer={
        <>
          <button onClick={cancel}>{t('Cancel')}</button>
          <button className={q.danger ? 'primary danger-fill' : 'primary'} autoFocus={!q.text} onClick={ok}>{t(q.ok ?? 'OK')}</button>
        </>
      }
    >
      {q.text ? (
        <label className="ask-field">
          <span className="ask-message">{q.message}</span>
          <input
            autoFocus
            type={q.password ? 'password' : 'text'}
            value={value}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ok()}
          />
        </label>
      ) : (
        <p className="ask-message">{q.message}</p>
      )}
    </Modal>
  );
}
