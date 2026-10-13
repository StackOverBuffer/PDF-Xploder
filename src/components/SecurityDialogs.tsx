import { useState } from 'react';
import { ShieldCheck, KeyRound, FileKey2, Check, X as XIcon } from 'lucide-react';
import { useStore } from '../store/store';
import { signDocument } from '../store/commands';
import { ACTION_LABELS, allowed, type Action } from '../store/permissions';
import { ALL_PERMISSIONS, allPermissionsGranted, type Algorithm, type Permissions, type SecuritySettings } from '../lib/security';
import { createTestCertificate, readP12, type Identity } from '../lib/signature';
import { downloadBlob, fileBytes } from '../lib/download';
import type { Rect } from '../lib/types';
import { Modal, useDialog } from './Dialogs';

function UnlockForm({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    const ok = await useStore.getState().run('Unlocking…', () => useStore.getState().unlock(pw));
    if (ok) onDone();
    else setError('That is not the permissions (owner) password.');
  };
  return (
    <>
      <p>Changing this document’s security requires its <b>permissions password</b> (owner password). Enter it to lift the restrictions for this session.</p>
      <label className="row"><span>Password</span><input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>
      {error && <p className="error-text">{error}</p>}
      <div className="row"><span /><button className="primary" onClick={submit}><KeyRound size={14} /> Unlock</button></div>
    </>
  );
}

const SUMMARY: Action[] = ['print', 'modify', 'assemble', 'annotate', 'fillForms', 'designForms', 'copy', 'security'];

/** What the current session may do, as derived from the document's permissions. */
function RestrictionsSummary() {
  const state = useStore();
  return (
    <table className="perm-summary">
      <tbody>
        {SUMMARY.map((a) => {
          const ok = allowed(state, a);
          return (
            <tr key={a}>
              <td>{ACTION_LABELS[a]}</td>
              <td className={ok ? 'ok' : 'bad'}>{ok ? <><Check size={14} /> Allowed</> : <><XIcon size={14} /> Not allowed</>}</td>
            </tr>
          );
        })}
        {state.permissions.printing && !state.permissions.highResPrinting && <tr><td colSpan={2} className="muted small">Printing is limited to low resolution.</td></tr>}
      </tbody>
    </table>
  );
}

type PrintLevel = 'none' | 'low' | 'high';

/** Editor for the permission bits; the two-level printing setting maps onto two bits. */
function PermissionsEditor({ value, onChange }: { value: Permissions; onChange: (p: Permissions) => void }) {
  const print: PrintLevel = !value.printing ? 'none' : value.highResPrinting ? 'high' : 'low';
  const box = (k: keyof Permissions, label: string, hint?: string) => (
    <label className="perm-row">
      <input type="checkbox" checked={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.checked })} />
      <span>{label}{hint && <span className="muted small"> — {hint}</span>}</span>
    </label>
  );
  return (
    <div className="perm-editor">
      <label className="row"><span>Printing</span>
        <select value={print} onChange={(e) => {
          const v = e.target.value as PrintLevel;
          onChange({ ...value, printing: v !== 'none', highResPrinting: v === 'high' });
        }}>
          <option value="none">Not allowed</option>
          <option value="low">Low resolution (150 dpi)</option>
          <option value="high">High resolution</option>
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
          <button onClick={() => onChange(ALL_PERMISSIONS)}>Allow all</button>
          <button onClick={() => onChange({ ...ALL_PERMISSIONS, modifying: false, documentAssembly: false, annotating: false, fillingForms: false, copying: false })}>Read &amp; print only</button>
          <button onClick={() => onChange({ ...ALL_PERMISSIONS, modifying: false, documentAssembly: false })}>Comments &amp; forms only</button>
          <button onClick={() => onChange({ ...ALL_PERMISSIONS, modifying: false, documentAssembly: false, annotating: false, copying: false })}>Forms only</button>
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
  s.notify(next ? 'Security settings will be applied when you save.' : 'Security will be removed when you save.');
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

  const submit = () => {
    if (!restricting) {
      // Nothing restricted: keep only an open password, if there is one.
      return apply(initial.userPassword ? { ...initial, ownerPassword: initial.userPassword, permissions: ALL_PERMISSIONS } : null, close);
    }
    if (!ownerPw) return setError('Set a permissions password: it is needed to change these settings later.');
    if (ownerPw === initial.userPassword) return setError('The permissions password must differ from the open password.');
    apply({ ...initial, ownerPassword: ownerPw, permissions: perms }, close);
  };

  return (
    <Modal
      title="Document permissions"
      wide
      onClose={close}
      footer={ownerAccess ? <><button onClick={close}>Cancel</button><button className="primary" onClick={submit}><ShieldCheck size={14} /> Apply</button></> : undefined}
    >
      <h3 className="section">Restrictions in effect</h3>
      <RestrictionsSummary />
      {!ownerAccess ? (
        <UnlockForm onDone={close} />
      ) : (
        <>
          <h3 className="section">Allow others to</h3>
          <PermissionsEditor value={perms} onChange={setPerms} />
          {restricting && (
            <label className="row"><span>Permissions password</span><input type="password" value={ownerPw} onChange={(e) => setOwnerPw(e.target.value)} autoComplete="new-password" placeholder="needed to change permissions later" /></label>
          )}
          {error && <p className="error-text">{error}</p>}
          {signed && <p className="warn-text small">This document is signed. Changing its security rewrites the file and invalidates the signatures.</p>}
          <p className="muted small">
            Permissions are enforced by PDF software (this app included) for anyone without the permissions password. PDF has no permission that
            prevents saving a copy: to stop others from saving changes, disallow changing, commenting and form filling. Permissions are applied when you save.
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

  if (!ownerAccess) {
    return <Modal title="Password security" onClose={close}><UnlockForm onDone={close} /></Modal>;
  }

  const submit = () => {
    if (requireOpen && !userPw) return setError('Enter the password needed to open the document.');
    if (restricted && !ownerPw) return setError('This document restricts permissions: keep a permissions password.');
    if (requireOpen && ownerPw && userPw === ownerPw) return setError('The two passwords must differ, or anyone who can open the file could lift the restrictions.');
    const open = requireOpen ? userPw : '';
    if (!open && !restricted) return apply(null, close);
    apply({ userPassword: open, ownerPassword: ownerPw || open, permissions: initial.permissions, algorithm }, close);
  };

  const status = securityChanged
    ? current ? `On save: encrypted with ${current.algorithm}.` : 'On save: no encryption.'
    : encryption?.encrypted ? `On save: unchanged (${encryption.algorithm}).` : 'On save: no encryption.';

  return (
    <Modal
      title="Password security"
      onClose={close}
      footer={
        <>
          {(current || encryption?.encrypted) && <button className="danger" onClick={() => apply(null, close)}>Remove security</button>}
          <span className="spacer" />
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={submit}><ShieldCheck size={14} /> Apply</button>
        </>
      }
    >
      <p className="muted small">{encryption?.encrypted ? `Opened file: encrypted (${encryption.algorithm}).` : 'Opened file: not encrypted.'} {status}</p>
      {signed && <p className="warn-text small">This document is signed. Changing its security rewrites the file and invalidates the signatures.</p>}
      <label className="row inline"><input type="checkbox" checked={requireOpen} onChange={(e) => setRequireOpen(e.target.checked)} /> Require a password to open the document</label>
      {requireOpen && <label className="row"><span>Open password</span><input type="password" value={userPw} onChange={(e) => setUserPw(e.target.value)} autoComplete="new-password" /></label>}
      <label className="row"><span>Permissions password</span><input type="password" value={ownerPw} onChange={(e) => setOwnerPw(e.target.value)} autoComplete="new-password" placeholder={restricted ? 'required' : 'optional'} /></label>
      <div className="row"><span>Permissions</span>
        <span className="small">{restricted ? 'Some actions are restricted.' : 'Everything is allowed.'}</span>
        <button onClick={() => { close(); useDialog.getState().show('permissions'); }}>Edit permissions…</button>
      </div>
      <label className="row"><span>Encryption</span>
        <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value as Algorithm)}>
          <option value="AES-256">AES-256 (Acrobat X and later)</option>
          <option value="AES-128">AES-128 (Acrobat 7 and later)</option>
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
      <p className="muted small">Creates a self-signed certificate for trying out signing. Signatures made with it are mathematically valid, but other people’s software will not recognise you as a trusted signer.</p>
      <label className="row"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="row"><span>Email</span><input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="row"><span>Protect with</span><input type="password" placeholder="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
      <div className="row"><span /><button disabled={!name || !pw || busy} onClick={create}>{busy ? 'Creating…' : 'Create and download .p12'}</button></div>
    </div>
  );
}

export function SignDialog({ close, placement }: { close: () => void; placement?: SignPlacement }) {
  const [p12, setP12] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('');
  const [password, setPassword] = useState('');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('I approve this document');
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
      setError((e as Error).message);
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
      title="Sign with a certificate"
      wide
      onClose={close}
      footer={<><button onClick={close}>Cancel</button><button className="primary" disabled={!identity} onClick={sign}><FileKey2 size={14} /> Sign and save</button></>}
    >
      <label className="row"><span>Certificate</span>
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
      <label className="row"><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} /><button disabled={!p12} onClick={() => load()}>Open</button></label>
      {error && <p className="error-text">{error}</p>}
      {identity && (
        <div className="identity">
          <b>{identity.name}</b>{identity.email ? ` <${identity.email}>` : ''}
          <div className="muted small">Issued by {identity.issuer}{identity.issuer === identity.name ? ' (self-signed)' : ''} · valid {identity.notBefore.toLocaleDateString()} – {identity.notAfter.toLocaleDateString()}</div>
          {expired && <div className="warn-text small">This certificate is not valid today.</div>}
        </div>
      )}
      <button className="link small" onClick={() => setShowCreate(!showCreate)}>{showCreate ? 'Hide' : 'No certificate? Create a test certificate…'}</button>
      {showCreate && <TestCertificateForm onCreated={(bytes, pw, name) => { setP12(bytes); setPassword(pw); setFileName(`${name} (test certificate)`); setShowCreate(false); load(bytes, pw); }} />}
      <label className="row"><span>Reason</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <label className="row"><span>Location</span><input value={location} onChange={(e) => setLocation(e.target.value)} /></label>
      <label className="row"><span>Contact</span><input value={contactInfo} onChange={(e) => setContact(e.target.value)} /></label>
      <p className="muted small">
        {placement ? `A visible signature is placed on page ${placement.page + 1} where you drew it.` : 'Invisible signature. To show it on a page, use Protect → Sign and drag a box.'}{' '}
        The signed file is downloaded and reopened; existing signatures stay valid.
      </p>
    </Modal>
  );
}
