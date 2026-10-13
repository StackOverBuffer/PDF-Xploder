import { ShieldCheck, ShieldAlert, ShieldX, ShieldQuestion } from 'lucide-react';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import type { SigStatus } from '../lib/signature';
import { useDialog } from './Dialogs';
import { ACTION_LABELS, allowed, type Action } from '../store/permissions';

export const STATUS: Record<SigStatus, { label: string; icon: typeof ShieldCheck; cls: string }> = {
  valid: { label: 'Valid', icon: ShieldCheck, cls: 'ok' },
  'valid-modified': { label: 'Valid, but changed later', icon: ShieldAlert, cls: 'warn' },
  invalid: { label: 'Invalid', icon: ShieldX, cls: 'bad' },
  unknown: { label: 'Could not be checked', icon: ShieldQuestion, cls: 'warn' },
};

export function SignaturesPanel() {
  const signatures = useStore((s) => s.signatures);
  const editable = useCan('fillForms');
  return (
    <div className="panel">
      <div className="panel-title">
        Signatures <span className="muted">({signatures.length})</span>
        <button className="small-btn" disabled={!editable} onClick={() => useStore.getState().setTool('sign')} title="Drag a box on the page for a visible signature">Sign…</button>
      </div>
      {signatures.length === 0 && <p className="muted pad">This document has no digital signatures.</p>}
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
                  <span className={`sig-status ${st.cls}`}>{st.label}</span>
                </div>
                <div className="comment-text">{sig.detail}</div>
                <dl className="sig-details small">
                  {sig.signedAt && <><dt>Signed</dt><dd>{sig.signedAt.toLocaleString()}</dd></>}
                  {sig.reason && <><dt>Reason</dt><dd>{sig.reason}</dd></>}
                  {sig.location && <><dt>Location</dt><dd>{sig.location}</dd></>}
                  {sig.issuer && <><dt>Issuer</dt><dd>{sig.issuer}{sig.selfSigned ? ' (self-signed)' : ''}</dd></>}
                  {sig.certValidTo && <><dt>Certificate</dt><dd>valid {sig.certValidFrom?.toLocaleDateString()} – {sig.certValidTo.toLocaleDateString()}</dd></>}
                  {sig.algorithm && <><dt>Algorithm</dt><dd>{sig.algorithm}</dd></>}
                  <dt>Field</dt><dd>{sig.fieldName}{sig.page !== undefined ? ` · page ${sig.page + 1}` : ' · invisible'}</dd>
                </dl>
                <div className="muted small">Signer identity is not checked against a list of trusted certificates.</div>
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
  if (lock) {
    const denied = (['print', 'modify', 'assemble', 'annotate', 'fillForms', 'copy'] as Action[]).filter((a) => !allowed(state, a));
    return (
      <div className="doc-banner warn">
        <ShieldAlert size={16} /> Restricted by the document’s security: {denied.map((a) => ACTION_LABELS[a].toLowerCase()).join(', ')} {denied.length === 1 ? 'is' : 'are'} not allowed.
        <button onClick={() => show('permissions')}>Permissions…</button>
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
      {worst === 'invalid' ? 'At least one signature is invalid.' : worst === 'unknown' ? 'Some signatures could not be checked.' : `Signed by ${last.signer}${signatures.length > 1 ? ` and ${signatures.length - 1} other(s)` : ''}: signatures are intact.`}
      {dirty && <span className="muted"> Unsaved changes will invalidate them when saved.</span>}
      <button onClick={() => useStore.getState().setSidebar('signatures')}>Signature panel</button>
    </div>
  );
}
