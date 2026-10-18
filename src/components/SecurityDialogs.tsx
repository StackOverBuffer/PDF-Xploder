import { useState } from 'react';
import { ShieldCheck, KeyRound, FileKey2, Check, X as XIcon } from 'lucide-react';
import { useStore } from '../store/store';
import { signDocument } from '../store/commands';
import { ACTION_LABELS, allowed, type Action, usePermState } from '../store/permissions';
import { ALL_PERMISSIONS, allPermissionsGranted, type Algorithm, type Permissions, type SecuritySettings } from '../lib/security';
import { createTestCertificate, readP12, type Identity } from '../lib/signature';
import { downloadBlob, fileBytes } from '../lib/download';
import type { Rect } from '../lib/types';
import { Modal, useDialog } from './Dialogs';
import { tf, tr, useT } from '../lib/i18n';

function UnlockForm({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const t = useT();
  const submit = async () => {
    const ok = await useStore.getState().run('Unlocking…', () => useStore.getState().unlock(pw));
    if (ok) onDone();
    else setError(tr('That is not the permissions (owner) password.'));
  };
  return (
    <>
      <p>{t('Changing this document’s security requires its')} <b>{t('permissions password')}</b> {t('(owner password). Enter it to lift the restrictions for this session.')}</p>
      <label className="row"><span>{t('Password')}</span><input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>
      {error && <p className="error-text">{error}</p>}
      <div className="row"><span /><button className="primary" onClick={submit}><KeyRound size={14} /> {t('Unlock')}</button></div>
      <LiftWithoutPassword onDone={onDone} />
    </>
  );
}

/** Lift the restrictions without the permissions password, once the user confirms they are entitled to. */
function LiftWithoutPassword({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [entitled, setEntitled] = useState(false);
  if (!open) {
    return <p className="muted small"><button className="link" onClick={() => setOpen(true)}>{t('Lift restrictions without the password…')}</button></p>;
  }
  return (
    <div className="lift-box">
      <p className="small">{t('PDF permissions are not encryption: the restrictions are a request by the author that PDF software honours. PDF-Xploder can lift them for this session without the permissions password.')}</p>
      <p className="small">{t('The author set these restrictions on purpose. Circumventing protection of copyrighted works can be unlawful (in Germany § 95a UrhG). Only continue for your own documents or with the rights holder’s permission.')}</p>
      <label className="row"><input type="checkbox" checked={entitled} onChange={(e) => setEntitled(e.target.checked)} /> <span>{t('I am entitled to edit this document (e.g. it is my own, or the rights holder agreed).')}</span></label>
      <p className="muted small">{t('Saving keeps the original encryption and restrictions unless you change the security under Protect → Password.')}</p>
      <div className="row">
        <span />
        <button
          className="primary"
          disabled={!entitled}
          onClick={() => {
            useStore.getState().liftRestrictions();
            useStore.getState().notify('Restrictions lifted for this session.');
            onDone();
          }}
        >
          <KeyRound size={14} /> {t('Lift restrictions')}
        </button>
      </div>
    </div>
  );
}

const SUMMARY: Action[] = ['print', 'modify', 'assemble', 'annotate', 'fillForms', 'designForms', 'copy', 'security'];

/** What the current session may do, as derived from the document's permissions. */
function RestrictionsSummary() {
  const state = usePermState();
  const t = useT();
  return (
    <table className="perm-summary">
      <tbody>
        {SUMMARY.map((a) => {
          const ok = allowed(state, a);
          return (
            <tr key={a}>
              <td>{t(ACTION_LABELS[a])}</td>
              <td className={ok ? 'ok' : 'bad'}>{ok ? <><Check size={14} /> {t('Allowed')}</> : <><XIcon size={14} /> {t('Not allowed')}</>}</td>
            </tr>
          );
        })}
        {state.permissions.printing && !state.permissions.highResPrinting && <tr><td colSpan={2} className="muted small">{t('Printing is limited to low resolution.')}</td></tr>}
      </tbody>
    </table>
  );
}

type PrintLevel = 'none' | 'low' | 'high';

/** Editor for the permission bits; the two-level printing setting maps onto two bits. */
function PermissionsEditor({ value, onChange }: { value: Permissions; onChange: (p: Permissions) => void }) {
  const print: PrintLevel = !value.printing ? 'none' : value.highResPrinting ? 'high' : 'low';
  const t = useT();
  const box = (k: keyof Permissions, label: string, hint?: string) => (
    <label className="perm-row">
      <input type="checkbox" checked={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.checked })} />
      <span>{t(label)}{hint && <span className="muted small"> — {t(hint)}</span>}</span>
    </label>
  );
  return (
    <div className="perm-editor">
      <label className="row"><span>{t('Printing')}</span>
        <select value={print} onChange={(e) => {
          const v = e.target.value as PrintLevel;
          onChange({ ...value, printing: v !== 'none', highResPrinting: v === 'high' });
        }}>
          <option value="none">{t('Not allowed')}</option>
          <option value="low">{t('Low resolution (150 dpi)')}</option>
          <option value="high">{t('High resolution')}</option>
        </select>
      </label>
      {box('modifying', 'Changing the document', 'content, page marks, form design')}
      {box('documentAssembly', 'Inserting, deleting and rotating pages')}
      {box('annotating', 'Commenting', 'also allows filling in forms')}
      {box('fillingForms', 'Filling in form fields and signing')}
      {box('copying', 'Copying text and images, extracting pages')}
      {box('contentAccessibility', 'Text access for screen readers')}
      <div className="row"><span />
        <div className="chips">
          <button onClick={() => onChange(ALL_PERMISSIONS)}>{t('Allow all')}</button>
          <button onClick={() => onChange({ ...ALL_PERMISSIONS, modifying: false, documentAssembly: false, annotating: false, fillingForms: false, copying: false })}>{t('Read & print only')}</button>
          <button onClick={() => onChange({ ...ALL_PERMISSIONS, modifying: false, documentAssembly: false })}>{t('Comments & forms only')}</button>
          <button onClick={() => onChange({ ...ALL_PERMISSIONS, modifying: false, documentAssembly: false, annotating: false, copying: false })}>{t('Forms only')}</button>
        </div>
      </div>
    </div>
  );
}

function currentSettings(): SecuritySettings {
  return useStore.getState().security ?? { userPassword: '', ownerPassword: '', permissions: ALL_PERMISSIONS, algorithm: 'AES-256' };
}

function apply(next: SecuritySettings | null, close: () => void) {
  const s = useStore.getState();
  s.setSecurity(next);
  s.notify(tr(next ? 'Security settings will be applied when you save.' : 'Security will be removed when you save.'));
  close();
}

export function PermissionsDialog({ close }: { close: () => void }) {
  const ownerAccess = useStore((s) => s.ownerAccess && s.editable);
  const signed = useStore((s) => s.signatures.length > 0);
  const initial = currentSettings();
  const [perms, setPerms] = useState<Permissions>(initial.permissions);
  const [ownerPw, setOwnerPw] = useState(initial.ownerPassword && initial.ownerPassword !== initial.userPassword ? initial.ownerPassword : '');
  const [error, setError] = useState('');
  const restricting = !allPermissionsGranted(perms);
  const t = useT();

  const submit = () => {
    if (!restricting) {
      // Nothing restricted: keep only an open password, if there is one.
      return apply(initial.userPassword ? { ...initial, ownerPassword: initial.userPassword, permissions: ALL_PERMISSIONS } : null, close);
    }
    if (!ownerPw) return setError(tr('Set a permissions password: it is needed to change these settings later.'));
    if (ownerPw === initial.userPassword) return setError(tr('The permissions password must differ from the open password.'));
    apply({ ...initial, ownerPassword: ownerPw, permissions: perms }, close);
  };

  return (
    <Modal
      title={t('Document permissions')}
      wide
      onClose={close}
      footer={ownerAccess ? <><button onClick={close}>{t('Cancel')}</button><button className="primary" onClick={submit}><ShieldCheck size={14} /> {t('Apply')}</button></> : undefined}
    >
      <h3 className="section">{t('Restrictions in effect')}</h3>
      <RestrictionsSummary />
      {!ownerAccess ? (
        <UnlockForm onDone={close} />
      ) : (
        <>
          <h3 className="section">{t('Allow others to')}</h3>
          <PermissionsEditor value={perms} onChange={setPerms} />
          {restricting && (
            <label className="row"><span>{t('Permissions password')}</span><input type="password" value={ownerPw} onChange={(e) => setOwnerPw(e.target.value)} autoComplete="new-password" placeholder={t('needed to change permissions later')} /></label>
          )}
          {error && <p className="error-text">{error}</p>}
          {signed && <p className="warn-text small">{t('This document is signed. Changing its security rewrites the file and invalidates the signatures.')}</p>}
          <p className="muted small">
            {t('Permissions are enforced by PDF software (this app included) for anyone without the permissions password. PDF has no permission that prevents saving a copy: to stop others from saving changes, disallow changing, commenting and form filling. Permissions are applied when you save.')}
          </p>
        </>
      )}
    </Modal>
  );
}

export function SecurityDialog({ close }: { close: () => void }) {
  const ownerAccess = useStore((s) => s.ownerAccess && s.editable);
  const encryption = useStore((s) => s.encryption);
  const current = useStore((s) => s.security);
  const securityChanged = useStore((s) => s.securityChanged);
  const signed = useStore((s) => s.signatures.length > 0);
  const initial = currentSettings();
  const [requireOpen, setRequireOpen] = useState(!!initial.userPassword);
  const [userPw, setUserPw] = useState(initial.userPassword);
  const [ownerPw, setOwnerPw] = useState(initial.ownerPassword && initial.ownerPassword !== initial.userPassword ? initial.ownerPassword : '');
  const [algorithm, setAlgorithm] = useState<Algorithm>(initial.algorithm);
  const [error, setError] = useState('');
  const restricted = !allPermissionsGranted(initial.permissions);
  const t = useT();

  if (!ownerAccess) {
    return <Modal title={t('Password security')} onClose={close}><UnlockForm onDone={close} /></Modal>;
  }

  const submit = () => {
    if (requireOpen && !userPw) return setError(tr('Enter the password needed to open the document.'));
    if (restricted && !ownerPw) return setError(tr('This document restricts permissions: keep a permissions password.'));
    if (requireOpen && ownerPw && userPw === ownerPw) return setError(tr('The two passwords must differ, or anyone who can open the file could lift the restrictions.'));
    const open = requireOpen ? userPw : '';
    if (!open && !restricted) return apply(null, close);
    apply({ userPassword: open, ownerPassword: ownerPw || open, permissions: initial.permissions, algorithm }, close);
  };

  const status = securityChanged
    ? current ? tf('On save: encrypted with {algorithm}.', { algorithm: current.algorithm }) : t('On save: no encryption.')
    : encryption?.encrypted ? tf('On save: unchanged ({algorithm}).', { algorithm: encryption.algorithm ?? '' }) : t('On save: no encryption.');

  return (
    <Modal
      title={t('Password security')}
      onClose={close}
      footer={
        <>
          {(current || encryption?.encrypted) && <button className="danger" onClick={() => apply(null, close)}>{t('Remove security')}</button>}
          <span className="spacer" />
          <button onClick={close}>{t('Cancel')}</button>
          <button className="primary" onClick={submit}><ShieldCheck size={14} /> {t('Apply')}</button>
        </>
      }
    >
      <p className="muted small">{encryption?.encrypted ? tf('Opened file: encrypted ({algorithm}).', { algorithm: encryption.algorithm ?? '' }) : t('Opened file: not encrypted.')} {status}</p>
      {signed && <p className="warn-text small">{t('This document is signed. Changing its security rewrites the file and invalidates the signatures.')}</p>}
      <label className="row inline"><input type="checkbox" checked={requireOpen} onChange={(e) => setRequireOpen(e.target.checked)} /> {t('Require a password to open the document')}</label>
      {requireOpen && <label className="row"><span>{t('Open password')}</span><input type="password" value={userPw} onChange={(e) => setUserPw(e.target.value)} autoComplete="new-password" /></label>}
      <label className="row"><span>{t('Permissions password')}</span><input type="password" value={ownerPw} onChange={(e) => setOwnerPw(e.target.value)} autoComplete="new-password" placeholder={t(restricted ? 'required' : 'optional')} /></label>
      <div className="row"><span>{t('Permissions')}</span>
        <span className="small">{t(restricted ? 'Some actions are restricted.' : 'Everything is allowed.')}</span>
        <button onClick={() => { close(); useDialog.getState().show('permissions'); }}>{t('Edit permissions…')}</button>
      </div>
      <label className="row"><span>{t('Encryption')}</span>
        <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value as Algorithm)}>
          <option value="AES-256">{t('AES-256 (Acrobat X and later)')}</option>
          <option value="AES-128">{t('AES-128 (Acrobat 7 and later)')}</option>
        </select>
      </label>
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}

export interface SignPlacement {
  page: number;
  rect: Rect;
}

function TestCertificateForm({ onCreated }: { onCreated: (p12: Uint8Array, password: string, name: string) => void }) {
  const author = useStore.getState().author;
  const [name, setName] = useState(author === 'Guest' ? '' : author);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const t = useT();
  const create = async () => {
    if (!name || !pw) return;
    setBusy(true);
    try {
      const p12 = await createTestCertificate({ name, email: email || undefined, password: pw });
      downloadBlob(p12, `${name.replace(/[^\w.-]+/g, '_')}-test-certificate.p12`, 'application/x-pkcs12');
      onCreated(p12, pw, name);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="subpanel">
      <p className="muted small">{t('Creates a self-signed certificate for trying out signing. Signatures made with it are mathematically valid, but other people’s software will not recognise you as a trusted signer.')}</p>
      <label className="row"><span>{t('Name')}</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="row"><span>{t('Email')}</span><input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="row"><span>{t('Protect with')}</span><input type="password" placeholder={t('password')} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
      <div className="row"><span /><button disabled={!name || !pw || busy} onClick={create}>{t(busy ? 'Creating…' : 'Create and download .p12')}</button></div>
    </div>
  );
}

export function SignDialog({ close, placement }: { close: () => void; placement?: SignPlacement }) {
  const [p12, setP12] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('');
  const [password, setPassword] = useState('');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState('');
  const t = useT();
  // The default reason is written into the signature, so it follows the interface language.
  const [reason, setReason] = useState(() => tr('I approve this document'));
  const [location, setLocation] = useState('');
  const [contactInfo, setContact] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = async (bytes = p12, pw = password) => {
    setError('');
    setIdentity(null);
    if (!bytes) return;
    try {
      setIdentity(await readP12(bytes, pw));
    } catch (e) {
      setError(tr((e as Error).message));
    }
  };

  const sign = () => {
    if (!identity) return;
    close();
    signDocument({ identity, reason: reason || undefined, location: location || undefined, contactInfo: contactInfo || undefined, visible: placement });
  };

  const expired = identity && (identity.notAfter < new Date() || identity.notBefore > new Date());

  return (
    <Modal
      title={t('Sign with a certificate')}
      wide
      onClose={close}
      footer={<><button onClick={close}>{t('Cancel')}</button><button className="primary" disabled={!identity} onClick={sign}><FileKey2 size={14} /> {t('Sign and save')}</button></>}
    >
      <label className="row"><span>{t('Certificate')}</span>
        <input type="file" accept=".p12,.pfx,application/x-pkcs12" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const bytes = await fileBytes(f);
          setP12(bytes);
          setFileName(f.name);
          setIdentity(null);
        }} />
      </label>
      {fileName && <p className="muted small">{fileName}</p>}
      <label className="row"><span>{t('Password')}</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} /><button disabled={!p12} onClick={() => load()}>{t('Open')}</button></label>
      {error && <p className="error-text">{error}</p>}
      {identity && (
        <div className="identity">
          <b>{identity.name}</b>{identity.email ? ` <${identity.email}>` : ''}
          <div className="muted small">{tf('Issued by {issuer}', { issuer: identity.issuer })}{identity.issuer === identity.name ? ` (${t('self-signed')})` : ''} · {t('valid')} {identity.notBefore.toLocaleDateString()} – {identity.notAfter.toLocaleDateString()}</div>
          {expired && <div className="warn-text small">{t('This certificate is not valid today.')}</div>}
        </div>
      )}
      <button className="link small" onClick={() => setShowCreate(!showCreate)}>{t(showCreate ? 'Hide' : 'No certificate? Create a test certificate…')}</button>
      {showCreate && <TestCertificateForm onCreated={(bytes, pw, name) => { setP12(bytes); setPassword(pw); setFileName(`${name} (${tr('test certificate')})`); setShowCreate(false); load(bytes, pw); }} />}
      <label className="row"><span>{t('Reason')}</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <label className="row"><span>{t('Location')}</span><input value={location} onChange={(e) => setLocation(e.target.value)} /></label>
      <label className="row"><span>{t('Contact')}</span><input value={contactInfo} onChange={(e) => setContact(e.target.value)} /></label>
      <p className="muted small">
        {placement ? tf('A visible signature is placed on page {n} where you drew it.', { n: placement.page + 1 }) : t('Invisible signature. To show it on a page, use Protect → Sign and drag a box.')}{' '}
        {t('The signed file is downloaded and reopened; existing signatures stay valid.')}
      </p>
    </Modal>
  );
}
