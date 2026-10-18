/**
 * Session backup, like PDF-XChange's "restore last session": the open tabs, with
 * their unsaved changes, are kept in this browser's storage (IndexedDB) and
 * reopened at the next start. Plus a list of recently opened files.
 *
 * Password-protected documents are not kept (their decrypted content and the
 * passwords would end up in browser storage); they appear only in the recent list.
 */
import { create } from 'zustand';
import { getBlob, getValue, putBlob, pruneBlobs, setValue, clearAll } from '../lib/sessionDb';
import { tf, tr } from '../lib/i18n';
import { sessionTabs, useStore, type SessionDoc } from './store';

const S = () => useStore.getState();
const SETTING = 'pdf-xploder.restore-session';
const SESSION_KEY = 'session';
const RECENT_KEY = 'recent';
const MAX_RECENT = 12;
/** Pause after the last change before writing the backup. */
const DEBOUNCE_MS = 1500;

interface StoredTab {
  doc: Omit<SessionDoc, 'bytes' | 'originalBytes'>;
  bytes: string;
  original: string | null;
  scroll?: { top: number; left: number };
}

interface StoredSession {
  version: 1;
  tabs: StoredTab[];
  active: number;
  savedAt: number;
}

export interface RecentFile {
  name: string;
  openedAt: number;
  /** Where the file is (Chrome, Edge): it can be reopened from the list. */
  handle?: FileSystemFileHandle;
  pages?: number;
}

function readSetting(): boolean {
  try {
    return localStorage.getItem(SETTING) !== '0';
  } catch {
    return true;
  }
}

export const useSession = create<{ enabled: boolean; recent: RecentFile[]; lastSaved: number | null }>(() => ({
  enabled: readSetting(),
  recent: [],
  lastSaved: null,
}));

// ---------------------------------------------------------------- writing

/** Ids of stored document versions (one record per distinct byte array). */
const blobIds = new WeakMap<Uint8Array, string>();
const written = new Set<string>();
let blobSeq = 0;
const blobId = (bytes: Uint8Array) => {
  let id = blobIds.get(bytes);
  if (!id) blobIds.set(bytes, (id = `doc-${Date.now().toString(36)}-${(blobSeq++).toString(36)}`));
  return id;
};

let timer = 0;
let saving: Promise<void> | null = null;
let again = false;
let warned = false;

/** Write the backup now (normally called by the debounce). */
export async function saveSession(): Promise<void> {
  if (!useSession.getState().enabled) return;
  if (saving) {
    again = true;
    return saving;
  }
  saving = (async () => {
    try {
      const { tabs, active } = sessionTabs();
      const stored: StoredTab[] = [];
      const keep = new Set<string>();
      for (const t of tabs) {
        if (!t.storable || !t.doc.bytes) continue;
        const { bytes, originalBytes, ...doc } = t.doc;
        const id = blobId(bytes);
        const orig = originalBytes && originalBytes !== bytes ? blobId(originalBytes) : null;
        for (const [bid, b] of [[id, bytes], [orig, originalBytes]] as const) {
          if (!bid || !b) continue;
          keep.add(bid);
          if (!written.has(bid)) {
            await putBlob(bid, b);
            written.add(bid);
          }
        }
        stored.push({ doc, bytes: id, original: orig, scroll: t.scroll });
      }
      const activeIndex = Math.max(0, tabs.filter((t) => t.storable).findIndex((t) => t.id === active));
      const session: StoredSession = { version: 1, tabs: stored, active: activeIndex, savedAt: Date.now() };
      // File handles can be stored in Chrome and Edge; if one cannot, keep the rest without handles.
      await setValue(SESSION_KEY, session).catch((e) => {
        if ((e as Error)?.name !== 'DataCloneError') throw e;
        return setValue(SESSION_KEY, { ...session, tabs: stored.map((t) => ({ ...t, doc: { ...t.doc, fileHandle: null } })) });
      });
      await pruneBlobs(keep);
      for (const id of [...written]) if (!keep.has(id)) written.delete(id);
      useSession.setState({ lastSaved: Date.now() });
    } catch (e) {
      console.warn('Session backup failed', e);
      if (!warned) {
        warned = true;
        S().notify(tr('The open documents could not be backed up in this browser (storage may be full or disabled).'), 'error');
      }
    } finally {
      saving = null;
      if (again) {
        again = false;
        void saveSession();
      }
    }
  })();
  return saving;
}

function schedule() {
  clearTimeout(timer);
  timer = window.setTimeout(() => void saveSession(), DEBOUNCE_MS);
}

/** Start backing up: after each change (once things are quiet) and when the page is hidden. */
export function startAutosave() {
  useStore.subscribe((s, prev) => {
    if (
      s.bytes !== prev.bytes ||
      s.annotations !== prev.annotations ||
      s.formValues !== prev.formValues ||
      s.tabs !== prev.tabs ||
      s.activeTab !== prev.activeTab ||
      s.dirty !== prev.dirty ||
      s.fileName !== prev.fileName ||
      s.currentPage !== prev.currentPage
    ) {
      schedule();
    }
  });
  // Leaving or hiding the page: write what is pending right away.
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
      void saveSession();
    }
  };
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  window.addEventListener('pagehide', flush);
}

// ---------------------------------------------------------------- restoring

/** Reopen the tabs of the last session. Returns how many were restored. */
export async function restoreSession(): Promise<number> {
  if (!useSession.getState().enabled) return 0;
  let session: StoredSession | undefined;
  try {
    session = await getValue<StoredSession>(SESSION_KEY);
  } catch {
    return 0;
  }
  if (!session?.tabs?.length) return 0;
  const docs: { doc: SessionDoc; scroll?: { top: number; left: number } }[] = [];
  let active = session.active;
  for (const [i, t] of session.tabs.entries()) {
    const bytes = await getBlob(t.bytes).catch(() => undefined);
    if (!bytes) {
      if (i < session.active) active--;
      continue;
    }
    const original = t.original ? ((await getBlob(t.original).catch(() => undefined)) ?? bytes) : bytes;
    // These versions are already stored: no need to write them again.
    blobIds.set(bytes, t.bytes);
    written.add(t.bytes);
    if (t.original && original !== bytes) {
      blobIds.set(original, t.original);
      written.add(t.original);
    }
    docs.push({ doc: { ...t.doc, bytes, originalBytes: original }, scroll: t.scroll });
  }
  if (!docs.length) return 0;
  S().restoreTabs(docs, active);
  const unsaved = docs.filter((d) => d.doc.dirty).length;
  S().notify(
    unsaved
      ? tf('Restored {n} document(s) from your last session, {u} with unsaved changes.', { n: docs.length, u: unsaved })
      : tf('Restored {n} document(s) from your last session.', { n: docs.length }),
  );
  return docs.length;
}

/** Turn the session backup on or off; off also deletes what was kept. */
export async function setSessionEnabled(enabled: boolean) {
  try {
    localStorage.setItem(SETTING, enabled ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
  useSession.setState({ enabled });
  if (enabled) return saveSession();
  clearTimeout(timer);
  written.clear();
  const recent = useSession.getState().recent;
  await clearAll().catch(() => {});
  // The recent list is separate from the backup: keep it.
  if (recent.length) storeRecent(recent);
}

// ---------------------------------------------------------------- recent files

export async function loadRecent() {
  try {
    const list = (await getValue<RecentFile[]>(RECENT_KEY)) ?? [];
    useSession.setState({ recent: list });
  } catch {
    /* storage unavailable */
  }
}

/** Remember an opened file at the top of the recent list. */
export function rememberRecent(name: string, handle?: FileSystemFileHandle | null) {
  if (!name) return;
  // Entries with the same name count as the same file (handles cannot be compared synchronously).
  const recent = [{ name, openedAt: Date.now(), handle: handle ?? undefined }, ...useSession.getState().recent.filter((r) => r.name !== name)].slice(0, MAX_RECENT);
  useSession.setState({ recent });
  storeRecent(recent);
}

function storeRecent(recent: RecentFile[]) {
  setValue(RECENT_KEY, recent).catch((e) => {
    if ((e as Error)?.name === 'DataCloneError') void setValue(RECENT_KEY, recent.map(({ handle: _h, ...r }) => r)).catch(() => {});
  });
}

export function forgetRecent(name?: string) {
  const recent = name ? useSession.getState().recent.filter((r) => r.name !== name) : [];
  useSession.setState({ recent });
  storeRecent(recent);
}
