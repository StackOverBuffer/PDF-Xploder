import { create } from 'zustand';
import type { Annotation, PageGeom, Rect, Tool } from '../lib/types';
import { withViewRotation, normRot } from '../lib/geometry';
import { inheritOffscreen } from '../lib/render/offscreen';
import { openPdf, pageGeoms, PasswordCancelled, type PDFDocumentProxy } from '../lib/pdfjs';
import { load as loadPdfLib, type FieldInfo, type FieldValue } from '../lib/pdfOps';
import { copyFromWorker, ops as opsW, sec as secW } from '../lib/worker';
import { ALL_PERMISSIONS, allPermissionsGranted, containsAscii, inspectEncryption, opensWith, type EncryptionInfo, type Permissions, type SecuritySettings } from '../lib/security';
import type { SignatureInfo } from '../lib/signature';
import { tr } from '../lib/i18n';
import { DEFAULT_SCALE, type MeasureScale } from '../lib/measure';
import { ask, askText } from '../lib/ask';
import { openingZoom } from '../lib/prefs';

let idCounter = 0;
export const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

/** Everything needed to restore the document on undo/redo. */
interface Snapshot {
  bytes: Uint8Array;
  pageIds: string[];
  annotations: Record<string, Annotation[]>;
  formValues: Record<string, FieldValue>;
}

export interface ToolStyle {
  color: string;
  fill: string | null;
  width: number;
  opacity: number;
  fontSize: number;
  stampLabel: string;
}

export interface SearchHit {
  page: number;
  rect: Rect;
  context: string;
}

export interface OpenOptions {
  password?: string;
  ownerPassword?: string;
  /** The file it was opened from, when the browser gives one (Save writes back to it). */
  handle?: FileSystemFileHandle | null;
}

export type SidebarTab = 'pages' | 'outline' | 'comments' | 'attachments' | 'forms' | 'search' | 'signatures';

export interface ScrollRequest {
  page: number;
  /** Optional user-space y to bring into view. */
  y?: number;
  nonce: number;
}

const MAX_HISTORY = 100;
/** Undo history keeps at most this many bytes of distinct document versions (per tab). */
const MAX_HISTORY_BYTES = 300 * 1024 * 1024;

/** Drop the oldest entries while the distinct document versions in `past` + `future` exceed the budget. */
function capHistory(past: Snapshot[], future: Snapshot[], current: Uint8Array | null): Snapshot[] {
  const size = (list: Snapshot[]) => {
    const seen = new Set<Uint8Array>(current ? [current] : []);
    let n = 0;
    for (const sn of list) if (!seen.has(sn.bytes)) (seen.add(sn.bytes), (n += sn.bytes.byteLength));
    return n;
  };
  let out = past;
  while (out.length > 1 && size([...out, ...future]) > MAX_HISTORY_BYTES) out = out.slice(1);
  return out;
}

export const DEFAULT_STYLES: Record<string, ToolStyle> = {
  highlight: { color: '#ffeb3b', fill: null, width: 1, opacity: 0.45, fontSize: 12, stampLabel: '' },
  underline: { color: '#1e88e5', fill: null, width: 1, opacity: 1, fontSize: 12, stampLabel: '' },
  strikeout: { color: '#e53935', fill: null, width: 1, opacity: 1, fontSize: 12, stampLabel: '' },
  ink: { color: '#e53935', fill: null, width: 2, opacity: 1, fontSize: 12, stampLabel: '' },
  rect: { color: '#e53935', fill: null, width: 2, opacity: 1, fontSize: 12, stampLabel: '' },
  ellipse: { color: '#e53935', fill: null, width: 2, opacity: 1, fontSize: 12, stampLabel: '' },
  line: { color: '#e53935', fill: null, width: 2, opacity: 1, fontSize: 12, stampLabel: '' },
  arrow: { color: '#e53935', fill: null, width: 2, opacity: 1, fontSize: 12, stampLabel: '' },
  polygon: { color: '#e53935', fill: null, width: 2, opacity: 1, fontSize: 12, stampLabel: '' },
  polyline: { color: '#e53935', fill: null, width: 2, opacity: 1, fontSize: 12, stampLabel: '' },
  cloud: { color: '#e53935', fill: null, width: 2, opacity: 1, fontSize: 12, stampLabel: '' },
  measureDistance: { color: '#1565c0', fill: null, width: 1, opacity: 1, fontSize: 10, stampLabel: '' },
  measurePerimeter: { color: '#1565c0', fill: null, width: 1, opacity: 1, fontSize: 10, stampLabel: '' },
  measureArea: { color: '#1565c0', fill: '#90caf9', width: 1, opacity: 0.6, fontSize: 10, stampLabel: '' },
  text: { color: '#111111', fill: null, width: 1, opacity: 1, fontSize: 14, stampLabel: '' },
  note: { color: '#fbc02d', fill: null, width: 1, opacity: 1, fontSize: 12, stampLabel: '' },
  stamp: { color: '#2e7d32', fill: null, width: 3, opacity: 0.9, fontSize: 12, stampLabel: 'Approved' },
  redact: { color: '#000000', fill: null, width: 1, opacity: 1, fontSize: 12, stampLabel: '' },
};

interface State {
  fileName: string;
  bytes: Uint8Array | null;
  pdf: PDFDocumentProxy | null;
  /** Stable ids for pages, so annotations follow pages across reorders. */
  pageIds: string[];
  geoms: PageGeom[];
  annotations: Record<string, Annotation[]>;
  /** Form fields of the current bytes (loaded asynchronously after each change). */
  fields: FieldInfo[];
  /** Form values edited since the bytes were last written; applied on save. */
  formValues: Record<string, FieldValue>;
  highlightFields: boolean;
  /** Form design mode: fields can be selected, moved, resized and edited. */
  formDesign: boolean;
  selectedField: { name: string; widget: number } | null;
  /** Page-content editing (Edit objects tool). */
  contentFilter: 'all' | 'text' | 'image' | 'shape';
  contentSelection: { page: number; ids: number[] } | null;
  /** Inline text editor: an existing line (id) or new text at a user-space point. */
  contentEditing: { page: number; id?: number; at?: { x: number; y: number } } | null;
  /** Bumped whenever `pdf` is replaced, so caches can be invalidated. */
  docVersion: number;
  /** Bumped when a different document is opened or the document is closed (not on edits). */
  docSession: number;
  /** A document is being opened: the current one stops rendering so the work goes to the new one. */
  opening: boolean;
  editable: boolean;
  dirty: boolean;
  /** The file exactly as opened; saved verbatim while nothing changed (keeps signatures valid). */
  originalBytes: Uint8Array | null;
  /** Encryption of the file as opened. */
  encryption: EncryptionInfo | null;
  /** Current security settings (passwords as far as known), or null for none. */
  security: SecuritySettings | null;
  /** Whether the user changed `security`; otherwise an encrypted file keeps its original encryption. */
  securityChanged: boolean;
  /** Re-encrypt like the opened file on save (see reencryptLike). */
  keepEncryption: { password: string } | null;
  /** What the document's security allows in this session. */
  permissions: Permissions;
  /** Whether security settings may be changed (owner password known, or nothing restricted). */
  ownerAccess: boolean;
  /** Set while a restricted document is open without its owner password. */
  lock: { userPassword: string; needsUserPassword: boolean } | null;
  /** The author's restrictions were lifted for this session without the permissions password. */
  restrictionsLifted: boolean;
  /** Where the document came from (File System Access API), so Save can write back to it. */
  fileHandle: FileSystemFileHandle | null;
  /** Saved at least once: the opened bytes no longer match what the user has on disk. */
  savedOnce: boolean;
  signatures: SignatureInfo[];
  past: Snapshot[];
  future: Snapshot[];

  busy: string | null;
  /** How far the running command is, when it works through steps (pages). */
  progress: { done: number; total: number } | null;
  /** A message; `undo` offers to undo the change it reports (while it is the latest one, on that tab). */
  toast: Toast | null;
  /** The messages shown (newest last, at most three): a new one never hides an older one's Undo. */
  toasts: Toast[];

  scale: number;
  fit: 'width' | 'page' | null;
  /** Extra clockwise rotation of the display only (the document is unchanged). */
  viewRotation: number;
  /** Scale for new measurements (each measurement keeps its own). */
  measureScale: MeasureScale;
  currentPage: number;
  scrollRequest: ScrollRequest | null;

  tool: Tool;
  styles: Record<string, ToolStyle>;
  author: string;
  selected: { pageId: string; id: string } | null;
  /** Id of the text box currently being edited inline. */
  editing: string | null;
  selectedPages: number[];
  sidebar: SidebarTab | null;

  search: { query: string; hits: SearchHit[]; index: number; matchCase: boolean; wholeWord?: boolean };

  /** Open document tabs, in display order. The active tab's document is the top-level state. */
  tabs: TabInfo[];
  activeTab: string;
  /** Scroll position to restore once the viewer shows a tab again. */
  restoreScroll: { top: number; left: number } | null;
}

export interface TabInfo {
  id: string;
  /** Name and unsaved state of inactive tabs (the active tab's are fileName/dirty). */
  fileName: string;
  dirty: boolean;
}

interface Actions {
  openDocument(bytes: Uint8Array, name: string, opts?: OpenOptions): Promise<void>;
  /** Lift permission restrictions with the owner password; resolves false if it is wrong. */
  unlock(ownerPassword: string): Promise<boolean>;
  /**
   * Lift the restrictions for this session without the permissions password, for
   * documents the user is entitled to edit (confirmed in the dialog). PDF permissions
   * are not encryption: the file key is already known from opening the file. Saving
   * keeps the original encryption and restrictions unless security is changed.
   */
  liftRestrictions(): void;
  setSecurity(s: SecuritySettings | null): void;
  /** Close the active tab's document (and the tab, if there are others). */
  closeDocument(): void;
  /** Open a document in a new tab (or in the active tab if it is empty). */
  openInNewTab(bytes: Uint8Array, name: string, opts?: OpenOptions): Promise<void>;
  /** Add an empty tab and activate it; returns its id. */
  newTab(): string;
  switchTab(id: string): void;
  /** Close a tab, asking first if it has unsaved changes; resolves false if the user cancelled. */
  /** Close a tab, asking first when it has unsaved changes; resolves to whether it was closed. */
  closeTab(id: string, opts?: { force?: boolean }): Promise<boolean>;
  moveTab(id: string, toIndex: number): void;
  /** Reopen documents from the session backup as tabs (replacing an empty start tab). */
  restoreTabs(docs: { doc: SessionDoc; scroll?: { top: number; left: number } }[], activeIndex: number): void;
  /** Replace the document bytes (after a page operation). `pageIds` defaults to the current ids. */
  commitBytes(bytes: Uint8Array, pageIds?: string[], annotations?: Record<string, Annotation[]>, formValues?: Record<string, FieldValue>): Promise<void>;
  addAnnotation(pageIndex: number, a: Annotation): void;
  /** quiet: no undo point and no unsaved change (opening or closing a comment's popup). */
  updateAnnotation(pageId: string, id: string, patch: Partial<Annotation>, opts?: { history?: boolean; quiet?: boolean }): void;
  deleteAnnotation(pageId: string, id: string): void;
  setFormValue(name: string, value: FieldValue, opts?: { history?: boolean }): void;
  /** Push the current state onto the undo stack (used before a drag starts). */
  checkpoint(): void;
  /** Take an undo point before the next change made without history (typing): focusing a field alone adds none. */
  armCheckpoint(): void;
  undo(): Promise<void>;
  redo(): Promise<void>;
  markSaved(): void;

  setTool(t: Tool): void;
  setStyle(tool: string, patch: Partial<ToolStyle>): void;
  setScale(s: number, fit?: State['fit']): void;
  /** Rotate the view (not the document) by a multiple of 90°. */
  rotateView(delta: number): void;
  setCurrentPage(p: number): void;
  goToPage(p: number, y?: number): void;
  select(sel: State['selected']): void;
  setEditing(id: string | null): void;
  setSelectedPages(p: number[]): void;
  setSidebar(t: SidebarTab | null): void;
  setSearch(patch: Partial<State['search']>): void;
  setAuthor(a: string): void;

  run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined>;
  notify(msg: string, kind?: 'info' | 'error', opts?: { undo?: boolean }): void;
}

export type Store = State & Actions;

let tabCounter = 1;
const newTabId = () => `tab-${tabCounter++}`;

/** Inactive tabs' documents: their document fields and scroll position. */
type Parked = Partial<State> & { scroll?: { top: number; left: number } };
const parked = new Map<string, Parked>();

/** Whether any open tab has unsaved changes. */
export function anyTabDirty(): boolean {
  return useStore.getState().dirty || [...parked.values()].some((p) => p.dirty);
}

/** What the session backup keeps of a document (enough to reopen it with its unsaved changes). */
export const SESSION_KEYS = [
  'fileName', 'bytes', 'originalBytes', 'pageIds', 'annotations', 'formValues', 'dirty', 'savedOnce', 'fileHandle',
  'encryption', 'permissions', 'ownerAccess', 'restrictionsLifted', 'editable', 'signatures', 'viewRotation', 'currentPage', 'scale', 'fit', 'measureScale',
] as const satisfies readonly (keyof State)[];
export type SessionDoc = Pick<State, (typeof SESSION_KEYS)[number]>;

/**
 * Whether a document may be kept in the session backup: not when it is password
 * protected or new passwords are pending (its decrypted content and passwords
 * would end up in browser storage).
 */
export function sessionStorable(d: Pick<State, 'bytes' | 'encryption' | 'security'>): boolean {
  return !!d.bytes && !d.encryption?.encrypted && !d.security;
}

export interface TabSnapshot {
  id: string;
  doc: SessionDoc;
  storable: boolean;
  scroll?: { top: number; left: number };
}

/** Every tab with a document, in tab order, for the session backup. */
export function sessionTabs(): { tabs: TabSnapshot[]; active: string } {
  const s = useStore.getState();
  const viewer = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.viewer') : null;
  const tabs: TabSnapshot[] = [];
  for (const t of s.tabs) {
    const live = t.id === s.activeTab;
    const src = (live ? s : parked.get(t.id)) as (Partial<State> & { scroll?: { top: number; left: number } }) | undefined;
    if (!src?.bytes) continue;
    const doc = Object.fromEntries(SESSION_KEYS.map((k) => [k, src[k]])) as SessionDoc;
    const scroll = live && viewer ? { top: viewer.scrollTop, left: viewer.scrollLeft } : src.scroll;
    tabs.push({ id: t.id, doc, storable: sessionStorable(src as State), scroll });
  }
  return { tabs, active: s.activeTab };
}

/** Whether any tab has unsaved changes the session backup cannot keep. */
export function anyUnsavedUnprotected(backupOn: boolean): boolean {
  if (!backupOn) return anyTabDirty();
  return sessionTabs().tabs.some((t) => t.doc.dirty && !t.storable);
}

const initialDoc = {
  restrictionsLifted: false,
  fileHandle: null as FileSystemFileHandle | null,
  savedOnce: false,
  fileName: '',
  bytes: null,
  pdf: null,
  pageIds: [],
  geoms: [],
  annotations: {},
  fields: [],
  formValues: {},
  selectedField: null,
  contentSelection: null,
  contentEditing: null,
  originalBytes: null,
  encryption: null,
  security: null,
  securityChanged: false,
  keepEncryption: null,
  permissions: ALL_PERMISSIONS,
  ownerAccess: true,
  lock: null,
  signatures: [],
  editable: true,
  dirty: false,
  past: [],
  future: [],
  selected: null,
  editing: null,
  selectedPages: [],
  currentPage: 0,
  scrollRequest: null,
  search: { query: '', hits: [], index: -1, matchCase: false },
  viewRotation: 0,
  measureScale: DEFAULT_SCALE,
} satisfies Partial<State>;

function readAuthor(): string {
  try {
    return localStorage.getItem('awesome-pdf.author') || 'Guest';
  } catch {
    return 'Guest';
  }
}

/** Comment types that are imported into the editable model (see annotIO's fromStandard). */
const IMPORTED_SUBTYPES = new Set(['Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Ink', 'Square', 'Circle', 'Line', 'Polygon', 'PolyLine', 'FreeText', 'Text', 'Stamp', 'Redact']);

/** Whether any page has a comment that the import would turn into an editable one (asked of the pdf.js worker, which already has the file). */
async function hasImportableAnnotations(pdf: PDFDocumentProxy): Promise<boolean> {
  try {
    const pages = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)));
    for (const page of pages) {
      const list = await page.getAnnotations();
      if (list.some((a: { subtype?: string }) => a.subtype && IMPORTED_SUBTYPES.has(a.subtype))) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/** Commands in progress (see run). */
const running: { label: string }[] = [];

export const useStore = create<Store>()((set, get) => {
  async function loadPdfJs(bytes: Uint8Array, knownPassword?: string, viewRotation = get().viewRotation) {
    let tries = 0;
    // A big file is usually held by the editing worker too: it makes pdf.js's copy.
    const copy = await copyFromWorker(bytes);
    const { pdf, password } = await openPdf(
      bytes,
      (retry) => {
        if (knownPassword !== undefined && tries++ === 0) return knownPassword;
        return askText({ title: 'Password', message: tr(retry ? 'Incorrect password. Try again:' : 'This document is password protected. Enter password:'), password: true, ok: 'Open' });
      },
      { copy },
    );
    const geoms = withViewRotation(await pageGeoms(pdf), viewRotation);
    return { pdf, geoms, password };
  }

  function snapshot(): Snapshot {
    const s = get();
    return { bytes: s.bytes!, pageIds: s.pageIds, annotations: s.annotations, formValues: s.formValues };
  }

  /** An undo point is due before the next change made without history (see armCheckpoint). */
  let armed = false;
  const takeArmed = () => {
    if (armed) pushHistory();
  };

  function pushHistory() {
    armed = false;
    const s = get();
    if (!s.bytes) return;
    const past = [...s.past, snapshot()].slice(-MAX_HISTORY);
    set({ past: capHistory(past, [], s.bytes), future: [], dirty: true });
  }

  /** Compute the state change for leaving inline text editing: empty text boxes are discarded. */
  function leaveEditing(next: string | null): Partial<State> {
    const { editing, annotations } = get();
    if (!editing || editing === next) return { editing: next };
    for (const [pageId, list] of Object.entries(annotations)) {
      const a = list.find((x) => x.id === editing);
      if (a?.type === 'text' && !a.text.trim()) {
        return { editing: next, annotations: { ...annotations, [pageId]: list.filter((x) => x !== a) } };
      }
    }
    return { editing: next };
  }

  async function restore(snap: Snapshot) {
    let doc: Partial<State> = {};
    if (snap.bytes !== get().bytes) {
      const { pdf, geoms } = await loadPdfJs(snap.bytes);
      // Read the state after loading: it may have changed meanwhile.
      const cur = get();
      inheritOffscreen(cur.pdf, pdf);
      if (cur.pdf !== pdf) cur.pdf?.destroy();
      doc = { pdf, geoms, bytes: snap.bytes, docVersion: cur.docVersion + 1 };
    }
    const cur = get();
    const n = snap.pageIds.length;
    // One update, so views never see geometry and page ids of different lengths.
    set({
      ...doc,
      pageIds: snap.pageIds,
      annotations: keepPopupsOpen(snap.annotations, cur.annotations),
      formValues: snap.formValues,
      selected: null,
      editing: null,
      selectedField: null,
      // Object ids are positions in the page content: they do not survive an undo.
      contentSelection: null,
      contentEditing: null,
      selectedPages: cur.selectedPages.filter((i) => i < n),
      currentPage: Math.min(cur.currentPage, n - 1),
      dirty: true,
      search: { ...cur.search, hits: [], index: -1 },
    });
  }

  async function openDocumentImpl(bytes: Uint8Array, name: string, opts: OpenOptions = {}) {
    const original = bytes;
    let loaded;
    try {
      loaded = await loadPdfJs(bytes, opts.password, 0);
    } catch (e) {
      if (e instanceof PasswordCancelled) return;
      throw e;
    }
    let encryption: EncryptionInfo = { encrypted: false, permissions: ALL_PERMISSIONS };
    // A failed check must not count as "not encrypted": the file would be edited still
    // encrypted, with its restrictions ignored. Try again here; failing that, ask pdf.js.
    let checked = true;
    try {
      encryption = await secW.inspectEncryption(bytes);
    } catch (e) {
      console.warn('Encryption check failed in the worker', e);
      try {
        encryption = await inspectEncryption(bytes);
      } catch (e2) {
        console.warn('Encryption check failed', e2);
        checked = false;
      }
    }
    // pdf.js reports permissions only for encrypted files.
    const encryptedForViewer = !!(await loaded.pdf.getPermissions().catch(() => null)) || loaded.password !== undefined;
    let editable = true;
    // Without a check, a file that is (or may be) encrypted opens read-only; others as usual.
    const unsure = !checked && (encryptedForViewer || containsAscii(bytes, '/Encrypt'));
    if (unsure || (!encryption.encrypted && encryptedForViewer)) {
      encryption = { encrypted: true, permissions: ALL_PERMISSIONS };
      editable = false;
    }
    let security: SecuritySettings | null = null;
    let lock: State['lock'] = null;
    let permissions: Permissions = ALL_PERMISSIONS;
    let ownerAccess = true;
    let keepEncryption: State['keepEncryption'] = null;
    const userPassword = loaded.password ?? '';
    if (encryption.encrypted && editable) {
      const owner = opts.ownerPassword;
      const restricted = !allPermissionsGranted(encryption.permissions);
      // Without the owner password the author's restrictions apply, action by action.
      ownerAccess = owner !== undefined || !restricted;
      permissions = owner !== undefined ? ALL_PERMISSIONS : encryption.permissions;
      if (!ownerAccess) lock = { userPassword, needsUserPassword: loaded.password !== undefined && userPassword !== '' };
      try {
        const password = owner ?? userPassword;
        const plain = await secW.decrypt(bytes, password);
        const reloaded = await loadPdfJs(plain);
        loaded.pdf.destroy();
        loaded = { ...reloaded, password: loaded.password };
        bytes = plain;
        // Saving re-encrypts with the original key, so both passwords keep working.
        keepEncryption = { password };
        security = {
          userPassword,
          ownerPassword: owner ?? (restricted ? '' : userPassword),
          permissions: encryption.permissions,
          algorithm: encryption.algorithm === 'AES-128' ? 'AES-128' : 'AES-256',
        };
      } catch (e) {
        console.warn('Could not decrypt for editing', e);
        editable = false;
      }
    }
    // (Unencrypted files are checked by the import below, to parse them only once.)
    const pageIds = loaded.geoms.map(() => uid('page'));
    const annotations: Record<string, Annotation[]> = {};
    if (editable) {
      // Existing comments become editable: they move from the file into the model.
      try {
        // Big files: parsing them with pdf-lib takes seconds on the main thread. Skip it
        // when the viewer finds no comments that would become editable.
        const imp = (await hasImportableAnnotations(loaded.pdf))
          ? await opsW.importForEditing(bytes).then((r) => {
              // Ids are given here (unique across all open documents).
              for (const list of r.annotations) for (const a of list) a.id = uid('annot');
              return r;
            })
          : { count: 0, bytes, annotations: [] as Annotation[][] };
        if (imp.count) {
          const reloaded = await loadPdfJs(imp.bytes, undefined, 0);
          loaded.pdf.destroy();
          loaded = { ...reloaded, password: loaded.password };
          bytes = imp.bytes;
          imp.annotations.forEach((list, i) => list.length && (annotations[pageIds[i]] = list));
        }
      } catch (e) {
        // Tell a file pdf-lib cannot read apart from one whose comments failed to import.
        try {
          await loadPdfLib(bytes);
          console.warn('Could not import annotations', e);
        } catch {
          editable = false;
        }
      }
    }
    get().pdf?.destroy();
    set({
      ...initialDoc,
      bytes,
      originalBytes: original,
      fileName: name,
      fileHandle: opts.handle ?? null,
      pdf: loaded.pdf,
      geoms: loaded.geoms,
      pageIds,
      annotations,
      editable,
      encryption,
      security,
      securityChanged: false,
      keepEncryption,
      permissions,
      ownerAccess,
      lock,
      docVersion: get().docVersion + 1,
      docSession: get().docSession + 1,
      ...openingZoom(),
      sidebar: get().sidebar,
      // Measuring goes on at the scale of the measurements already in the file.
      measureScale: Object.values(annotations).flat().map((a) => ('measure' in a ? a.measure?.scale : undefined)).find(Boolean) ?? DEFAULT_SCALE,
    });
    if (!editable) get().notify(tr('This document is damaged or uses unsupported encryption: it is open read-only.'), 'error');
    const tab = get().activeTab;
    // Loaded only for files that contain a signature at all.
    (containsAscii(original, '/ByteRange') ? import('../lib/signature').then((m) => m.verifySignatures(original)) : Promise.resolve([] as SignatureInfo[]))
      .then((signatures) => {
        // The tab may have been switched away meanwhile: then store the result with it.
        if (get().activeTab !== tab) {
          const p = parked.get(tab);
          if (p?.originalBytes === original) p.signatures = signatures;
          return;
        }
        if (get().originalBytes !== original) return;
        set({ signatures });
        if (signatures.length && get().sidebar !== 'signatures') set({ sidebar: 'signatures' });
      })
      .catch((e) => console.warn('Signature check failed', e));
  }

  /** Fields that belong to one document; everything else (tools, styles, panes…) is shared. */
  const DOC_KEYS = [...Object.keys(initialDoc), 'scale', 'fit', 'formDesign'] as (keyof State)[];

  function park() {
    const s = get();
    const p: Parked = {};
    for (const k of DOC_KEYS) (p as Record<string, unknown>)[k] = s[k];
    const viewer = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.viewer') : null;
    if (viewer) p.scroll = { top: viewer.scrollTop, left: viewer.scrollLeft };
    parked.set(s.activeTab, p);
    set({ tabs: s.tabs.map((t) => (t.id === s.activeTab ? { ...t, fileName: s.fileName, dirty: s.dirty } : t)) });
  }

  function activate(id: string) {
    const p = parked.get(id);
    parked.delete(id);
    const { scroll, ...fields }: Parked = p ?? { ...initialDoc };
    set({
      ...initialDoc,
      ...fields,
      activeTab: id,
      restoreScroll: scroll ?? null,
      opening: false,
      // Views remount for the other document; caches see a new version.
      docSession: get().docSession + 1,
      docVersion: get().docVersion + 1,
    });
    // A tab restored from the last session gets its viewer document when first shown.
    if (!fields.pdf && fields.bytes) void loadRestored(id);
  }

  async function loadRestored(id: string) {
    set({ opening: true });
    try {
      const { pdf, geoms } = await loadPdfJs(get().bytes!, undefined, get().viewRotation);
      if (get().activeTab !== id || get().pdf) {
        pdf.destroy();
        return;
      }
      set({ pdf, geoms, docVersion: get().docVersion + 1, docSession: get().docSession + 1 });
    } catch (e) {
      console.error(e);
      if (get().activeTab === id) get().notify(tr('This document could not be restored.'), 'error');
    } finally {
      if (get().activeTab === id) set({ opening: false });
    }
  }

  function addEmptyTab(): string {
    park();
    const id = newTabId();
    set({ tabs: [...get().tabs, { id, fileName: '', dirty: false }] });
    activate(id);
    // A new document starts fitted to the window.
    set({ ...openingZoom(), formDesign: false });
    return id;
  }

  function removeTab(id: string) {
    const s = get();
    const i = s.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    if (id === s.activeTab) {
      s.pdf?.destroy();
      const rest = s.tabs.filter((t) => t.id !== id);
      if (!rest.length) {
        // Closing the last tab leaves one empty tab.
        const fresh = newTabId();
        set({ tabs: [{ id: fresh, fileName: '', dirty: false }] });
        activate(fresh);
        return;
      }
      set({ tabs: rest });
      activate(rest[Math.min(i, rest.length - 1)].id);
    } else {
      parked.get(id)?.pdf?.destroy();
      parked.delete(id);
      set({ tabs: s.tabs.filter((t) => t.id !== id) });
    }
  }

  return {
    ...initialDoc,
    docVersion: 0,
    docSession: 0,
    opening: false,
    busy: null,
    progress: null,
    toast: null,
    toasts: [],
    scale: 1,
    fit: 'width',
    tool: 'select',
    styles: DEFAULT_STYLES,
    author: readAuthor(),
    highlightFields: true,
    formDesign: false,
    contentFilter: 'all',
    sidebar: 'pages',
    tabs: [{ id: 'tab-0', fileName: '', dirty: false }],
    activeTab: 'tab-0',
    restoreScroll: null,

    async openDocument(bytes, name, opts = {}) {
      set({ opening: true });
      try {
        await openDocumentImpl(bytes, name, opts);
      } finally {
        set({ opening: false });
      }
    },

    async unlock(ownerPassword) {
      const s = get();
      if (!s.lock || !s.originalBytes) return false;
      // With an empty open password any password that decrypts is the owner's;
      // otherwise it must also differ from the open password.
      const differs = s.lock.needsUserPassword ? ownerPassword !== s.lock.userPassword : ownerPassword !== '';
      if (!differs || !(await opensWith(s.originalBytes, ownerPassword))) return false;
      // Same file key either way, so the decrypted document stays as is: just lift the restrictions.
      set({
        lock: null,
        ownerAccess: true,
        permissions: ALL_PERMISSIONS,
        security: s.security ? { ...s.security, ownerPassword } : s.security,
      });
      return true;
    },

    liftRestrictions() {
      if (!get().lock) return;
      set({ lock: null, ownerAccess: true, permissions: ALL_PERMISSIONS, restrictionsLifted: true });
    },

    setSecurity(security) {
      set({ security, securityChanged: true, dirty: true });
    },

    closeDocument() {
      removeTab(get().activeTab);
    },

    async openInNewTab(bytes, name, opts) {
      if (!get().pdf) return get().openDocument(bytes, name, opts);
      const previous = get().activeTab;
      const id = addEmptyTab();
      try {
        await get().openDocument(bytes, name, opts);
      } finally {
        // Cancelled (password) or failed: drop the empty tab and go back.
        if (get().activeTab === id && !get().pdf) {
          removeTab(id);
          if (get().tabs.some((t) => t.id === previous)) {
            park();
            activate(previous);
          }
        }
      }
    },

    newTab() {
      return addEmptyTab();
    },

    switchTab(id) {
      const s = get();
      // Never switch while a command runs: it would finish on the wrong document.
      if (id === s.activeTab || s.busy || !s.tabs.some((t) => t.id === id)) return;
      park();
      activate(id);
    },

    closeTab(id, opts = {}) {
      const s = get();
      if (s.busy) return Promise.resolve(false);
      const dirty = id === s.activeTab ? s.dirty : !!parked.get(id)?.dirty;
      const name = id === s.activeTab ? s.fileName : s.tabs.find((t) => t.id === id)?.fileName;
      if (!dirty || opts.force) {
        removeTab(id);
        return Promise.resolve(true);
      }
      return ask({ title: 'Unsaved changes', message: tr('“{name}” has unsaved changes. Close it anyway?').replace('{name}', name || tr('Untitled')), ok: 'Close without saving', danger: true }).then((yes) => {
        if (!yes || get().busy || !get().tabs.some((t) => t.id === id)) return false;
        removeTab(id);
        return true;
      });
    },

    restoreTabs(docs, activeIndex) {
      if (!docs.length) return;
      const s = get();
      // An empty tab (as at start) makes way for the restored ones.
      const keepCurrent = !!s.pdf || !!s.bytes;
      if (keepCurrent) park();
      const restored = docs.map(({ doc, scroll }) => {
        const id = newTabId();
        parked.set(id, { ...initialDoc, ...doc, scroll });
        return { id, fileName: doc.fileName, dirty: doc.dirty };
      });
      const others = keepCurrent ? get().tabs : get().tabs.filter((t) => t.id !== s.activeTab);
      set({ tabs: [...others, ...restored] });
      activate(restored[Math.min(Math.max(0, activeIndex), restored.length - 1)].id);
    },

    moveTab(id, toIndex) {
      const tabs = [...get().tabs];
      const from = tabs.findIndex((t) => t.id === id);
      if (from < 0) return;
      const [t] = tabs.splice(from, 1);
      tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, t);
      set({ tabs });
    },

    async commitBytes(bytes, pageIds, annotations, formValues) {
      const { pdf, geoms } = await loadPdfJs(bytes);
      // Read the state after loading, so changes made meanwhile are kept.
      const s = get();
      inheritOffscreen(s.pdf, pdf);
      const ids = pageIds ?? s.pageIds;
      if (ids.length !== geoms.length) {
        pdf.destroy();
        throw new Error('Page id bookkeeping is out of sync');
      }
      pushHistory();
      if (s.pdf !== pdf) s.pdf?.destroy();
      const annots = annotations ?? s.annotations;
      // Drop annotations whose page no longer exists.
      const kept: Record<string, Annotation[]> = {};
      for (const id of ids) if (annots[id]) kept[id] = annots[id];
      const pagesChanged = ids !== s.pageIds;
      set({
        bytes,
        pdf,
        geoms,
        pageIds: ids,
        annotations: kept,
        formValues: formValues ?? s.formValues,
        docVersion: s.docVersion + 1,
        selected: null,
        selectedPages: s.selectedPages.filter((i) => i < ids.length),
        currentPage: Math.min(s.currentPage, ids.length - 1),
        search: { ...s.search, hits: [], index: -1 },
        // Content object ids are positions on a page; after a page change they point elsewhere.
        ...(pagesChanged ? { contentSelection: null, contentEditing: null } : {}),
      });
    },

    addAnnotation(pageIndex, a) {
      pushHistory();
      const pageId = get().pageIds[pageIndex];
      const annotations = { ...get().annotations, [pageId]: [...(get().annotations[pageId] ?? []), a] };
      set({ annotations, selected: { pageId, id: a.id } });
    },

    updateAnnotation(pageId, id, patch, opts = {}) {
      if (opts.quiet) {
        // Does not touch the undo history either (see restore).
      } else if (opts.history !== false) pushHistory();
      else takeArmed();
      const list = get().annotations[pageId] ?? [];
      set({
        annotations: {
          ...get().annotations,
          [pageId]: list.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)),
        },
        ...(opts.quiet ? {} : { dirty: true }),
      });
    },

    deleteAnnotation(pageId, id) {
      pushHistory();
      const list = get().annotations[pageId] ?? [];
      set({
        annotations: { ...get().annotations, [pageId]: list.filter((a) => a.id !== id) },
        selected: get().selected?.id === id ? null : get().selected,
      });
    },

    setFormValue(name, value, opts = {}) {
      if (opts.history !== false) pushHistory();
      else takeArmed();
      set({ formValues: { ...get().formValues, [name]: value }, dirty: true });
    },

    checkpoint: pushHistory,
    armCheckpoint: () => {
      armed = true;
    },

    async undo() {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      const cur = snapshot();
      set({ past: s.past.slice(0, -1), future: [cur, ...s.future] });
      await restore(prev);
    },

    async redo() {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      const cur = snapshot();
      set({ past: [...s.past, cur], future: s.future.slice(1) });
      await restore(next);
    },

    markSaved: () => set({ dirty: false, savedOnce: true }),

    setTool: (tool) =>
      set({
        ...leaveEditing(null),
        tool,
        selected: tool === 'select' ? get().selected : null,
        contentSelection: tool === 'content' ? get().contentSelection : null,
        contentEditing: null,
      }),
    setStyle: (tool, patch) => set({ styles: { ...get().styles, [tool]: { ...get().styles[tool], ...patch } } }),
    setScale: (scale, fit = null) => set({ scale: Math.min(8, Math.max(0.1, scale)), fit }),
    rotateView: (delta) => {
      const s = get();
      const viewRotation = normRot(s.viewRotation + delta);
      set({ viewRotation, geoms: withViewRotation(s.geoms, viewRotation), docVersion: s.docVersion + 1, selected: null });
    },
    setCurrentPage: (currentPage) => set({ currentPage }),
    goToPage: (page, y) => {
      const p = Math.max(0, Math.min(page, get().pageIds.length - 1));
      set({ currentPage: p, scrollRequest: { page: p, y, nonce: Math.random() } });
    },
    select: (selected) => set({ ...leaveEditing(selected?.id === get().editing ? get().editing : null), selected, selectedField: selected ? null : get().selectedField }),
    setEditing: (editing) => set(leaveEditing(editing)),
    setSelectedPages: (selectedPages) => set({ selectedPages }),
    setSidebar: (sidebar) => set({ sidebar }),
    setSearch: (patch) => set({ search: { ...get().search, ...patch } }),
    setAuthor: (author) => {
      try {
        localStorage.setItem('awesome-pdf.author', author);
      } catch {
        /* storage unavailable */
      }
      set({ author });
    },

    async run(label, fn) {
      // Labels and messages are English keys; translate them centrally. Runs can nest
      // (a command calling another), so keep a stack: the app is busy until all finish.
      const entry = { label: tr(label) };
      running.push(entry);
      set({ busy: entry.label });
      try {
        return await fn();
      } catch (e) {
        console.error(e);
        get().notify((e as Error).message || String(e), 'error');
        return undefined;
      } finally {
        running.splice(running.indexOf(entry), 1);
        set({ busy: running.length ? running[running.length - 1].label : null, ...(running.length ? {} : { progress: null }) });
      }
    },

    notify(msg, kind = 'info', opts = {}) {
      const s = get();
      const t: Toast = { id: ++toastSeq, msg: tr(msg), kind, undo: opts.undo && s.past.length ? { tab: s.activeTab, depth: s.past.length } : undefined };
      // The same message twice (e.g. a repeated action) shows once, with a fresh timer.
      const toasts = [...s.toasts.filter((x) => x.msg !== t.msg), t].slice(-3);
      set({ toasts, toast: t });
      setTimeout(() => dismissToast(t.id), kind === 'error' || opts.undo ? 6000 : 3000);
    },
  };
});

/** Resolves once no command is running (e.g. before opening a file the system handed over). */
export function whenIdle(): Promise<void> {
  if (!useStore.getState().busy) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = useStore.subscribe((s) => {
      if (!s.busy) {
        stop();
        resolve();
      }
    });
  });
}

/** Annotations ordered by page index. */
/**
 * Undo and redo leave popups open or closed as they are now: opening one is not a change
 * of its own (see updateAnnotation's quiet), so it should not be undone with another.
 */
function keepPopupsOpen(next: Record<string, Annotation[]>, now: Record<string, Annotation[]>): Record<string, Annotation[]> {
  const open = new Map<string, boolean>();
  for (const list of Object.values(now)) for (const a of list) if (a.popup) open.set(a.id, a.popup.open);
  if (!open.size) return next;
  const out: Record<string, Annotation[]> = {};
  for (const [pid, list] of Object.entries(next)) {
    out[pid] = list.map((a) => {
      const o = open.get(a.id);
      return o === undefined || o === a.popup?.open ? a : ({ ...a, popup: { ...a.popup, open: o } } as Annotation);
    });
  }
  return out;
}

export function annotationsByPage(s: Pick<State, 'pageIds' | 'annotations'>): Annotation[][] {
  return s.pageIds.map((id) => s.annotations[id] ?? []);
}

export function styleFor(tool: string): ToolStyle {
  return useStore.getState().styles[tool] ?? DEFAULT_STYLES.rect;
}

/** Report how far a running command is (e.g. page 3 of 10), shown in the status bar and busy bar. */
export function reportProgress(done: number, total: number): void {
  if (total > 1) useStore.setState({ progress: { done, total } });
}

/** A message at the bottom of the window; `undo` offers to undo the change it reports (while it is the latest one, on that tab). */
export interface Toast {
  id: number;
  msg: string;
  kind: 'info' | 'error';
  undo?: { tab: string; depth: number };
}
let toastSeq = 0;

/** Take a message away (timer, Undo, or a click on it). */
export function dismissToast(id: number): void {
  const s = useStore.getState();
  if (!s.toasts.some((t) => t.id === id)) return;
  const toasts = s.toasts.filter((t) => t.id !== id);
  useStore.setState({ toasts, toast: toasts[toasts.length - 1] ?? null });
}
