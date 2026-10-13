import { useState } from 'react';
import { ShieldCheck, KeyRound, FileKey2 } from 'lucide-react';
import { useStore } from '../store/store';
import { signDocument } from '../store/commands';
import { ALL_PERMISSIONS, type Algorithm, type Permissions } from '../lib/security';
import { createTestCertificate, readP12, type Identity } from '../lib/signature';
import { downloadBlob, fileBytes } from '../lib/download';
import type { Rect } from '../lib/types';
import { Modal } from './Dialogs';

const PERMISSION_LABELS: [keyof Permissions, string][] = [
  ['printing', 'Printing'],
  ['copying', 'Copying text and images'],
  ['modifying', 'Changing the document'],
  ['annotating', 'Commenting'],
  ['fillingForms', 'Filling in form fields'],
  ['documentAssembly', 'Inserting, deleting and rotating pages'],
  ['contentAccessibility', 'Content extraction for accessibility'],
];

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
      <p>This document’s security settings restrict editing. Enter the <b>permissions password</b> (owner password) to edit it.</p>
      <label className="row"><span>Password</span><input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>
      {error && <p className="error-text">{error}</p>}
      <div className="row"><span /><button className="primary" onClick={submit}><KeyRound size={14} /> Unlock</button></div>
    </>
  );
}

export function SecurityDialog({ close }: { close: () => void }) {
  const lock = useStore((s) => s.lock);
  const encryption = useStore((s) => s.encryption);
  const current = useStore((s) => s.security);
  const signed = useStore((s) => s.signatures.length > 0);
  const [requireOpen, setRequireOpen] = useState(!!current?.userPassword);
  const [userPw, setUserPw] = useState(current?.userPassword ?? '');
  const [restrict, setRestrict] = useState(!!current && Object.values(current.permissions).some((v) => !v));
  const [ownerPw, setOwnerPw] = useState(current?.ownerPassword && current.ownerPassword !== current.userPassword ? current.ownerPassword : '');
  const [perms, setPerms] = useState<Permissions>(current?.permissions ?? ALL_PERMISSIONS);
  const [algorithm, setAlgorithm] = useState<Algorithm>(current?.algorithm ?? 'AES-256');
  const [error, setError] = useState('');

  if (lock) {
    return <Modal title="Document security" onClose={close}><UnlockForm onDone={close} /></Modal>;
  }

  const apply = () => {
    if (!requireOpen && !restrict) return setError('Choose at least one kind of protection, or use “Remove security”.');
    if (requireOpen && !userPw) return setError('Enter the password needed to open the document.');
    if (restrict && !ownerPw) return setError('Enter the permissions password.');
    if (requireOpen && restrict && userPw === ownerPw) return setError('The two passwords must differ, or anyone who can open the file could lift the restrictions.');
    useStore.getState().setSecurity({
      userPassword: requireOpen ? userPw : '',
      ownerPassword: restrict ? ownerPw : userPw,
      permissions: restrict ? perms : ALL_PERMISSIONS,
      algorithm,
    });
    useStore.getState().notify('Security settings will be applied when you save.');
    close();
  };

  return (
    <Modal
      title="Password security"
      onClose={close}
      footer={
        <>
          {current && <button className="danger" onClick={() => { useStore.getState().setSecurity(null); useStore.getState().notify('Security will be removed when you save.'); close(); }}>Remove security</button>}
          <span className="spacer" />
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={apply}><ShieldCheck size={14} /> Apply</button>
        </>
      }
    >
      <p className="muted small">
        {encryption?.encrypted ? `Opened file: encrypted (${encryption.algorithm}).` : 'Opened file: not encrypted.'}{' '}
        {current ? `On save: encrypted with ${current.algorithm}.` : 'On save: no encryption.'}
      </p>
      {signed && <p className="warn-text small">This document is signed. Changing its security rewrites the file and invalidates the signatures.</p>}
      <label className="row inline"><input type="checkbox" checked={requireOpen} onChange={(e) => setRequireOpen(e.target.checked)} /> Require a password to open the document</label>
      {requireOpen && <label className="row"><span>Open password</span><input type="password" value={userPw} onChange={(e) => setUserPw(e.target.value)} autoComplete="new-password" /></label>}
      <label className="row inline"><input type="checkbox" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} /> Restrict what others can do</label>
      {restrict && (
        <>
          <label className="row"><span>Permissions password</span><input type="password" value={ownerPw} onChange={(e) => setOwnerPw(e.target.value)} autoComplete="new-password" /></label>
          <div className="perm-list">
            <span className="muted small">Allow:</span>
            {PERMISSION_LABELS.map(([k, label]) => (
              <label key={k} className="inline small"><input type="checkbox" checked={perms[k]} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} /> {label}</label>
            ))}
          </div>
        </>
      )}
      <label className="row"><span>Encryption</span>
        <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value as Algorithm)}>
          <option value="AES-256">AES-256 (Acrobat X and later)</option>
          <option value="AES-128">AES-128 (Acrobat 7 and later)</option>
        </select>
      </label>
      {error && <p className="error-text">{error}</p>}
      <p className="muted small">Restrictions are honoured by well-behaved PDF software; they are not a substitute for an open password.</p>
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
