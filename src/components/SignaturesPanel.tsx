import { ShieldCheck, ShieldAlert, ShieldX, ShieldQuestion } from 'lucide-react';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import type { SigStatus } from '../lib/signature';
import { useDialog } from './Dialogs';
import { ACTION_LABELS, allowed, type Action } from '../store/permissions';
import { tf, useLang, useT } from '../lib/i18n';

/** Labels are English translation keys. */
export const STATUS: Record<SigStatus, { label: string; icon: typeof ShieldCheck; cls: string }> = {
  valid: { label: 'Valid', icon: ShieldCheck, cls: 'ok' },
  'valid-modified': { label: 'Valid, but changed later', icon: ShieldAlert, cls: 'warn' },
  invalid: { label: 'Invalid', icon: ShieldX, cls: 'bad' },
  unknown: { label: 'Could not be checked', icon: ShieldQuestion, cls: 'warn' },
};

export function SignaturesPanel() {
  const t = useT();
  const signatures = useStore((s) => s.signatures);
  const editable = useCan('fillForms');
  return (
    <div className="panel">
      <div className="panel-title">
        {t('Signatures')} <span className="muted">({signatures.length})</span>
        <button className="small-btn" disabled={!editable} onClick={() => useStore.getState().setTool('sign')} title={t('Drag a box on the page for a visible signature')}>{t('Sign…')}</button>
      </div>
      {signatures.length === 0 && <p className="muted pad">{t('This document has no digital signatures.')}</p>}
      <div className="comment-list">
        {signatures.map((sig, i) => {
          const st = STATUS[sig.status];
          const Icon = st.icon;
          return (
            <div key={i} className="comment sig" onClick={() => sig.page !== undefined && useStore.getState().goToPage(sig.page)}>
              <Icon size={20} className={`sig-icon ${st.cls}`} />
              <div className="comment-body">
                <div className="comment-head">
                  <b>{sig.signer}</b>
                  <span className={`sig-status ${st.cls}`}>{t(st.label)}</span>
                </div>
                <div className="comment-text">{t(sig.detail)}</div>
                <dl className="sig-details small">
                  {sig.signedAt && <><dt>{t('Signed')}</dt><dd>{sig.signedAt.toLocaleString()}</dd></>}
                  {sig.reason && <><dt>{t('Reason')}</dt><dd>{sig.reason}</dd></>}
                  {sig.location && <><dt>{t('Location')}</dt><dd>{sig.location}</dd></>}
                  {sig.issuer && <><dt>{t('Issuer')}</dt><dd>{sig.issuer}{sig.selfSigned ? ` (${t('self-signed')})` : ''}</dd></>}
                  {sig.certValidTo && <><dt>{t('Certificate')}</dt><dd>{t('valid')} {sig.certValidFrom?.toLocaleDateString()} – {sig.certValidTo.toLocaleDateString()}</dd></>}
                  {sig.algorithm && <><dt>{t('Algorithm')}</dt><dd>{sig.algorithm}</dd></>}
                  <dt>{t('Field')}</dt><dd>{sig.fieldName}{sig.page !== undefined ? ` · ${tf('page {n}', { n: sig.page + 1 })}` : ` · ${t('invisible')}`}</dd>
                </dl>
                <div className="muted small">{t('Signer identity is not checked against a list of trusted certificates.')}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One-line notices above the page view: restricted documents and signature status. */
export function DocBanner() {
  const lock = useStore((s) => s.lock);
  const signatures = useStore((s) => s.signatures);
  const dirty = useStore((s) => s.dirty);
  const show = useDialog((d) => d.show);
  const state = useStore();
  const t = useT();
  const lang = useLang((l) => l.lang);
  if (lock) {
    const denied = (['print', 'modify', 'assemble', 'annotate', 'fillForms', 'copy'] as Action[]).filter((a) => !allowed(state, a));
    return (
      <div className="doc-banner warn">
        <ShieldAlert size={16} /> {tf(denied.length === 1 ? 'Restricted by the document’s security: {actions} is not allowed.' : 'Restricted by the document’s security: {actions} are not allowed.', {
          // German nouns keep their capitals.
          actions: denied.map((a) => (lang === 'en' ? ACTION_LABELS[a].toLowerCase() : t(ACTION_LABELS[a]))).join(', '),
        })}
        <button onClick={() => show('permissions')}>{t('Permissions…')}</button>
      </div>
    );
  }
  if (!signatures.length) return null;
  // An earlier signature followed by later signatures still counts as intact.
  const worst: SigStatus = signatures.some((s) => s.status === 'invalid') ? 'invalid' : signatures.some((s) => s.status === 'unknown') ? 'unknown' : 'valid';
  const st = STATUS[worst];
  const Icon = st.icon;
  const last = signatures[signatures.length - 1];
  return (
    <div className={`doc-banner ${st.cls}`}>
      <Icon size={16} />
      {worst === 'invalid' ? t('At least one signature is invalid.') : worst === 'unknown' ? t('Some signatures could not be checked.') : signatures.length > 1 ? tf('Signed by {signer} and {n} other(s): signatures are intact.', { signer: last.signer, n: signatures.length - 1 }) : tf('Signed by {signer}: signatures are intact.', { signer: last.signer })}
      {dirty && <span className="muted"> {t('Unsaved changes will invalidate them when saved.')}</span>}
      <button onClick={() => useStore.getState().setSidebar('signatures')}>{t('Signature panel')}</button>
    </div>
  );
}
