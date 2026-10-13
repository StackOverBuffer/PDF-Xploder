import { create } from 'zustand';
import type { Annotation, PageGeom, Rect, Tool } from '../lib/types';
import { withViewRotation, normRot } from '../lib/geometry';
import { openPdf, pageGeoms, PasswordCancelled, type PDFDocumentProxy } from '../lib/pdfjs';
import { importForEditing, load as loadPdfLib, type FieldInfo, type FieldValue } from '../lib/pdfOps';
import { ALL_PERMISSIONS, allPermissionsGranted, decrypt, inspectEncryption, opensWith, type EncryptionInfo, type Permissions, type SecuritySettings } from '../lib/security';
import { verifySignatures, type SignatureInfo } from '../lib/signature';

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

export type SidebarTab = 'pages' | 'outline' | 'comments' | 'attachments' | 'forms' | 'search' | 'signatures';

export interface ScrollRequest {
  page: number;
  /** Optional user-space y to bring into view. */
  y?: number;
  nonce: number;
}

const MAX_HISTORY = 100;

export const DEFAULT_STYLES: Record<string, ToolStyle> = {
  highlight: { color: '#ffeb3b', fill: null, width: 1, opacity: 0.45, fontSize: 12, stampLabel: '' },
  underline: { color: '#1e88e5', fill: null, width: 1, opacity: 1, fontSize: 12, stampLabel: '' },
  strikeout: { color: '#e53935', fill: null, width: 1, opacity: 1, fontSize: 12, stampLabel: '' },
  ink: { color: '#e53935', fill: null, width: 2, opacity: 1, fontSize: 12, stampLabel: '' },
  rect: { color: '#e53935', fill: null, width: 2, opacity: 1, fontSize: 12, stampLabel: '' },
  ellipse: { color: '#e53935', fill: null, width: 2, opacity: 1, fontSize: 12, stampLabel: '' },
  line: { color: '#e53935', fill: null, width: 2, opacity: 1, fontSize: 12, stampLabel: '' },
  arrow: { color: '#e53935', fill: null, width: 2, opacity: 1, fontSize: 12, stampLabel: '' },
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
  signatures: SignatureInfo[];
  past: Snapshot[];
  future: Snapshot[];

  busy: string | null;
  toast: { msg: string; kind: 'info' | 'error' } | null;

  scale: number;
  fit: 'width' | 'page' | null;
  /** Extra clockwise rotation of the display only (the document is unchanged). */
  viewRotation: number;
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

  search: { query: string; hits: SearchHit[]; index: number; matchCase: boolean };
}

interface Actions {
  openDocument(bytes: Uint8Array, name: string, opts?: { password?: string; ownerPassword?: string }): Promise<void>;
  /** Lift permission restrictions with the owner password; resolves false if it is wrong. */
  unlock(ownerPassword: string): Promise<boolean>;
  setSecurity(s: SecuritySettings | null): void;
  closeDocument(): void;
  /** Replace the document bytes (after a page operation). `pageIds` defaults to the current ids. */
  commitBytes(bytes: Uint8Array, pageIds?: string[], annotations?: Record<string, Annotation[]>, formValues?: Record<string, FieldValue>): Promise<void>;
  addAnnotation(pageIndex: number, a: Annotation): void;
  updateAnnotation(pageId: string, id: string, patch: Partial<Annotation>, opts?: { history?: boolean }): void;
  deleteAnnotation(pageId: string, id: string): void;
  setFormValue(name: string, value: FieldValue, opts?: { history?: boolean }): void;
  /** Push the current state onto the undo stack (used before a drag starts). */
  checkpoint(): void;
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
  notify(msg: string, kind?: 'info' | 'error'): void;
}

export type Store = State & Actions;

const initialDoc = {
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
} satisfies Partial<State>;

function readAuthor(): string {
  try {
    return localStorage.getItem('awesome-pdf.author') || 'Guest';
  } catch {
    return 'Guest';
  }
}

export const useStore = create<Store>()((set, get) => {
  async function loadPdfJs(bytes: Uint8Array, knownPassword?: string, viewRotation = get().viewRotation) {
    let tries = 0;
    const { pdf, password } = await openPdf(bytes, (retry) => {
      if (knownPassword !== undefined && tries++ === 0) return knownPassword;
      return window.prompt(retry ? 'Incorrect password. Try again:' : 'This document is password protected. Enter password:');
    });
    const geoms = withViewRotation(await pageGeoms(pdf), viewRotation);
    return { pdf, geoms, password };
  }

  function snapshot(): Snapshot {
    const s = get();
    return { bytes: s.bytes!, pageIds: s.pageIds, annotations: s.annotations, formValues: s.formValues };
  }

  function pushHistory() {
    const s = get();
    if (!s.bytes) return;
    set({ past: [...s.past, snapshot()].slice(-MAX_HISTORY), future: [], dirty: true });
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
    const s = get();
    if (snap.bytes !== s.bytes) {
      const { pdf, geoms } = await loadPdfJs(snap.bytes);
      s.pdf?.destroy();
      set({ pdf, geoms, bytes: snap.bytes, docVersion: s.docVersion + 1 });
    }
    set({ pageIds: snap.pageIds, annotations: snap.annotations, formValues: snap.formValues, selected: null, editing: null, dirty: true, search: { ...get().search, hits: [], index: -1 } });
    set({ currentPage: Math.min(get().currentPage, snap.pageIds.length - 1) });
  }

  return {
    ...initialDoc,
    docVersion: 0,
    busy: null,
    toast: null,
    scale: 1,
    fit: 'width',
    tool: 'select',
    styles: DEFAULT_STYLES,
    author: readAuthor(),
    highlightFields: true,
    formDesign: false,
    contentFilter: 'all',
    sidebar: 'pages',

    async openDocument(bytes, name, opts = {}) {
      const original = bytes;
      let loaded;
      try {
        loaded = await loadPdfJs(bytes, opts.password, 0);
      } catch (e) {
        if (e instanceof PasswordCancelled) return;
        throw e;
      }
      let encryption: EncryptionInfo = { encrypted: false, permissions: ALL_PERMISSIONS };
      try {
        encryption = await inspectEncryption(bytes);
      } catch {
        /* damaged: handled below */
      }
      let editable = true;
      let security: SecuritySettings | null = null;
      let lock: State['lock'] = null;
      let permissions: Permissions = ALL_PERMISSIONS;
      let ownerAccess = true;
      let keepEncryption: State['keepEncryption'] = null;
      const userPassword = loaded.password ?? '';
      if (encryption.encrypted) {
        const owner = opts.ownerPassword;
        const restricted = !allPermissionsGranted(encryption.permissions);
        // Without the owner password the author's restrictions apply, action by action.
        ownerAccess = owner !== undefined || !restricted;
        permissions = owner !== undefined ? ALL_PERMISSIONS : encryption.permissions;
        if (!ownerAccess) lock = { userPassword, needsUserPassword: loaded.password !== undefined && userPassword !== '' };
        try {
          const password = owner ?? userPassword;
          const plain = await decrypt(bytes, password);
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
      } else {
        try {
          await loadPdfLib(bytes);
        } catch {
          editable = false;
        }
      }
      const pageIds = loaded.geoms.map(() => uid('page'));
      const annotations: Record<string, Annotation[]> = {};
      if (editable) {
        // Existing comments become editable: they move from the file into the model.
        try {
          const imp = await importForEditing(bytes, () => uid('annot'));
          if (imp.count) {
            const reloaded = await loadPdfJs(imp.bytes, undefined, 0);
            loaded.pdf.destroy();
            loaded = { ...reloaded, password: loaded.password };
            bytes = imp.bytes;
            imp.annotations.forEach((list, i) => list.length && (annotations[pageIds[i]] = list));
          }
        } catch (e) {
          console.warn('Could not import annotations', e);
        }
      }
      get().pdf?.destroy();
      set({
        ...initialDoc,
        bytes,
        originalBytes: original,
        fileName: name,
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
        fit: 'width',
        sidebar: get().sidebar,
      });
      if (!editable) get().notify('This document is damaged or uses unsupported encryption: it is open read-only.', 'error');
      verifySignatures(original)
        .then((signatures) => {
          if (get().originalBytes !== original) return;
          set({ signatures });
          if (signatures.length && get().sidebar !== 'signatures') set({ sidebar: 'signatures' });
        })
        .catch((e) => console.warn('Signature check failed', e));
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

    setSecurity(security) {
      set({ security, securityChanged: true, dirty: true });
    },

    closeDocument() {
      get().pdf?.destroy();
      set({ ...initialDoc, docVersion: get().docVersion + 1 });
    },

    async commitBytes(bytes, pageIds, annotations, formValues) {
      const s = get();
      const { pdf, geoms } = await loadPdfJs(bytes);
      pushHistory();
      s.pdf?.destroy();
      const ids = pageIds ?? s.pageIds;
      if (ids.length !== geoms.length) throw new Error('Page id bookkeeping is out of sync');
      const annots = annotations ?? s.annotations;
      // Drop annotations whose page no longer exists.
      const kept: Record<string, Annotation[]> = {};
      for (const id of ids) if (annots[id]) kept[id] = annots[id];
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
      });
    },

    addAnnotation(pageIndex, a) {
      pushHistory();
      const pageId = get().pageIds[pageIndex];
      const annotations = { ...get().annotations, [pageId]: [...(get().annotations[pageId] ?? []), a] };
      set({ annotations, selected: { pageId, id: a.id } });
    },

    updateAnnotation(pageId, id, patch, opts = {}) {
      if (opts.history !== false) pushHistory();
      const list = get().annotations[pageId] ?? [];
      set({
        annotations: {
          ...get().annotations,
          [pageId]: list.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)),
        },
        dirty: true,
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
      set({ formValues: { ...get().formValues, [name]: value }, dirty: true });
    },

    checkpoint: pushHistory,

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

    markSaved: () => set({ dirty: false }),

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
      set({ busy: label });
      try {
        return await fn();
      } catch (e) {
        console.error(e);
        get().notify((e as Error).message || String(e), 'error');
        return undefined;
      } finally {
        set({ busy: null });
      }
    },

    notify(msg, kind = 'info') {
      set({ toast: { msg, kind } });
      const t = get().toast;
      setTimeout(() => {
        if (get().toast === t) set({ toast: null });
      }, kind === 'error' ? 6000 : 3000);
    },
  };
});

/** Annotations ordered by page index. */
export function annotationsByPage(s: Pick<State, 'pageIds' | 'annotations'>): Annotation[][] {
  return s.pageIds.map((id) => s.annotations[id] ?? []);
}

export function styleFor(tool: string): ToolStyle {
  return useStore.getState().styles[tool] ?? DEFAULT_STYLES.rect;
}
