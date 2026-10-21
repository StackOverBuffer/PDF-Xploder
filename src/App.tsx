import { AskHost } from './components/AskHost';
import { can } from './store/permissions';
import { useEffect, useState } from 'react';
import { FileText, FolderOpen, FilePlus, Sparkles, LayoutGrid, ListTree, MessageSquare, FormInput, Search, FileSignature, Paperclip } from 'lucide-react';
import { anyUnsavedUnprotected, useStore, type SidebarTab } from './store/store';
import { useSession } from './store/session';
import * as cmd from './store/commands';
import { Ribbon } from './components/Ribbon';
import { TabBar } from './components/TabBar';
import { FOCUS_COMMAND_SEARCH } from './components/CommandSearch';
import { copyBoxText, selectAllText, useTextBox } from './components/TextBoxSelect';
import { addBookmarkAt } from './store/contentActions';
import { goToBookmark } from './store/bookmarkCommands';
import { Viewer } from './components/Viewer';
import { Thumbnails } from './components/Thumbnails';
import { Outline } from './components/Outline';
import { CommentsPanel } from './components/CommentsPanel';
import { AttachmentsPanel } from './components/AttachmentsPanel';
import { FormsPanel } from './components/FormsPanel';
import { SearchPanel } from './components/SearchPanel';
import { DocBanner, SignaturesPanel } from './components/SignaturesPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { StatusBar } from './components/StatusBar';
import { Dialogs, useDialog } from './components/Dialogs';
import { createSampleDocument } from './lib/sample';
import type { FieldInfo } from './lib/pdfOps';
import { ops as opsW } from './lib/worker';
import type { Tool } from './lib/types';
import { useT } from './lib/i18n';
import { setPrefs, usePrefs } from './lib/prefs';
import { PaneResizer } from './components/PaneResizer';

const SIDEBAR: { tab: SidebarTab; icon: typeof LayoutGrid; label: string }[] = [
  { tab: 'pages', icon: LayoutGrid, label: 'Pages' },
  { tab: 'outline', icon: ListTree, label: 'Bookmarks' },
  { tab: 'comments', icon: MessageSquare, label: 'Comments' },
  { tab: 'attachments', icon: Paperclip, label: 'Attachments' },
  { tab: 'forms', icon: FormInput, label: 'Form fields' },
  { tab: 'search', icon: Search, label: 'Search' },
  { tab: 'signatures', icon: FileSignature, label: 'Signatures' },
];

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select', x: 'selectText', g: 'snapshot', z: 'zoom', h: 'hand', H: 'highlight', u: 'underline', k: 'strikeout', p: 'ink', r: 'rect', o: 'ellipse',
  l: 'line', m: 'measureDistance', a: 'arrow', y: 'polygon', j: 'polyline', w: 'cloud', t: 'text', n: 'note', s: 'stamp',
};

async function openSample() {
  const s = useStore.getState();
  await s.run('Creating sample…', async () => s.openInNewTab(await createSampleDocument(), 'sample.pdf'));
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const textInput = t.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'color', 'button'].includes((t as HTMLInputElement).type);
      const typing = t.isContentEditable || textInput || ['TEXTAREA', 'SELECT'].includes(t.tagName);
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (useDialog.getState().open) return;
      // While a command runs, only harmless shortcuts work (it would act on a document that is about to change).
      if (s.busy) {
        if (!typing && (mod || e.key === 'Delete' || e.key === 'Backspace')) e.preventDefault();
        return;
      }
      if (mod) {
        const k = e.key.toLowerCase();
        const run = (fn: () => unknown) => { e.preventDefault(); fn(); };
        if (k === 'o') return run(cmd.openFromDialog);
        if (k === 'k') return run(() => window.dispatchEvent(new Event(FOCUS_COMMAND_SEARCH)));
        // Next/previous tab (Ctrl+Tab belongs to the browser).
        if (e.altKey && (e.key === 'PageDown' || e.key === 'PageUp')) {
          return run(() => {
            const i = s.tabs.findIndex((x) => x.id === s.activeTab);
            const next = s.tabs[(i + (e.key === 'PageDown' ? 1 : -1) + s.tabs.length) % s.tabs.length];
            if (next) s.switchTab(next.id);
          });
        }
        if (!s.pdf) return;
        if (k === 's') return run(e.shiftKey ? cmd.saveAs : cmd.save);
        if (k === 'p') return run(cmd.print);
        if (k === 'f') return run(() => { s.setSidebar('search'); window.dispatchEvent(new Event('awesome-pdf:focus-search')); });
        if (k === 'g') return run(() => useDialog.getState().show('goto'));
        if (k === '=' || k === '+') return run(() => s.setScale(s.scale * 1.2));
        if (k === '-') return run(() => s.setScale(s.scale / 1.2));
        if (k === '0') return run(() => s.setScale(s.scale, 'width'));
        if (typing) return;
        const box = useTextBox.getState().sel;
        if (k === 'c' && box && s.tool === 'selectText') return run(copyBoxText);
        if (k === 'a' && s.tool === 'selectText') return run(() => selectAllText(s.currentPage));
        if (k === 'b' && e.shiftKey) return run(() => addBookmarkAt(box?.page ?? s.currentPage, undefined, box?.text.split('\n')[0] ?? ''));
        if (k === 'z' && !e.shiftKey) return run(() => s.run('Undoing…', () => s.undo()));
        if (k === 'y' || (k === 'z' && e.shiftKey)) return run(() => s.run('Redoing…', () => s.redo()));
        return;
      }
      if (typing || !s.pdf) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedField && s.formDesign) {
        e.preventDefault();
        cmd.deleteField(s.selectedField.name);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selected && can('annotate')) {
        e.preventDefault();
        s.deleteAnnotation(s.selected.pageId, s.selected.id);
      } else if (e.key === 'Escape' && useTextBox.getState().sel) {
        useTextBox.setState({ sel: null });
      } else if (e.key === 'Escape') {
        // Cancel a partly drawn polygon/polyline/cloud before switching back to select.
        window.dispatchEvent(new Event('awesome-pdf:cancel-draft'));
        if (s.selectedField) useStore.setState({ selectedField: null });
        s.select(null);
        s.setTool('select');
      } else if (e.altKey && (e.key === 'PageDown' || e.key === 'PageUp')) {
        e.preventDefault();
        goToBookmark(e.key === 'PageDown' ? 1 : -1);
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        s.goToPage(s.currentPage + 1);
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        s.goToPage(s.currentPage - 1);
      } else if (!e.altKey && TOOL_KEYS[e.key]) {
        const tool = TOOL_KEYS[e.key];
        if (['select', 'selectText', 'hand', 'zoom'].includes(tool) || (tool === 'snapshot' ? can('copy') : can('annotate'))) s.setTool(tool);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Welcome() {
  const t = useT();
  const recent = useSession((x) => x.recent);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`welcome ${over ? 'drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); cmd.openDropped(e.dataTransfer); }}
    >
      <div className="welcome-card">
        <h1>PDF-Xploder</h1>
        <p className="muted">{t('View, annotate, organise, fill and sign PDFs — entirely in your browser. Files never leave your device.')}</p>
        <div className="welcome-actions">
          <button className="primary big" title="Ctrl+O" onClick={cmd.openFromDialog}><FolderOpen size={18} /> {t('Open PDF…')}</button>
          <button className="big" title="Ctrl+N" onClick={cmd.newDocument}><FilePlus size={18} /> {t('New blank')}</button>
          <button className="big" onClick={openSample}><Sparkles size={18} /> {t('Try a sample')}</button>
        </div>
        <p className="muted small">{t('…or drop PDF files here. Dropping several combines them into one document.')}</p>
        {recent.length > 0 && (
          <div className="welcome-recent">
            <h2>{t('Recent files')}</h2>
            <ul>
              {recent.slice(0, 8).map((r) => (
                <li key={r.name}>
                  <button onClick={() => cmd.openRecent(r)} title={r.handle ? r.name : t('This browser asks you to choose the file again')}>
                    <FileText size={16} /> <span className="welcome-recent-name">{r.name}</span>
                    <span className="muted small">{new Date(r.openedAt).toLocaleDateString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** Form fields per document version: switching tabs or undoing must not re-parse the whole file. */
const fieldCache = new WeakMap<Uint8Array, FieldInfo[]>();

/** Keep the store's list of form fields in sync with the document bytes. */
function useFormFields() {
  const bytes = useStore((s) => s.bytes);
  const editable = useStore((s) => s.editable);
  const pdf = useStore((s) => s.pdf);
  useEffect(() => {
    let live = true;
    const apply = (fields: FieldInfo[]) => {
      if (live && !(fields.length === 0 && useStore.getState().fields.length === 0)) useStore.setState({ fields });
    };
    if (!bytes || !editable) {
      apply([]);
      return;
    }
    const known = fieldCache.get(bytes);
    if (known) {
      if (useStore.getState().fields !== known) apply(known);
      return;
    }
    // A restored tab gets its viewer document a moment later: wait for it.
    if (!pdf) return;
    // pdf.js already has the file: without any form field there, skip the (slow, for big files) pdf-lib parse.
    const anyFields = useStore.getState().bytes === bytes ? pdf.getFieldObjects().then((o) => !!o && Object.keys(o).length > 0).catch(() => true) : Promise.resolve(true);
    anyFields
      .then((has) => (has ? opsW.getFormFields(bytes) : []))
      .then((fields) => {
        fieldCache.set(bytes, fields);
        apply(fields);
      })
      .catch(() => apply([]));
    return () => {
      live = false;
    };
  }, [bytes, editable, pdf]);
}

/** While a command runs: a progress bar, and a transparent layer that keeps clicks and drops from starting another one. Dialogs stay usable (e.g. to cancel OCR). */
function BusyShield() {
  const busy = useStore((s) => !!s.busy);
  const progress = useStore((s) => s.progress);
  if (!busy) return null;
  return (
    <>
      {progress ? (
        <div className="busy-bar determinate" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <div style={{ width: `${(100 * progress.done) / progress.total}%` }} />
        </div>
      ) : (
        <div className="busy-bar" />
      )}
      <div
        className="busy-shield"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={(e) => e.ctrlKey && e.preventDefault()}
      />
    </>
  );
}

function Toast() {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const canUndo = useStore((s) => !!toast?.undo && s.activeTab === toast.undo.tab && s.past.length === toast.undo.depth);
  if (!toast) return null;
  return (
    <div key={toast.msg} className={`toast ${toast.kind}`} role="status">
      <span>{toast.msg}</span>
      {canUndo && (
        <button
          className="toast-action"
          onClick={() => {
            useStore.setState({ toast: null });
            void useStore.getState().run('Undoing…', () => useStore.getState().undo());
          }}
        >
          {t('Undo')}
        </button>
      )}
    </div>
  );
}

/** The window title follows the document (own component: the rest of the app need not re-render). */
function TitleSync() {
  const t = useT();
  const dirty = useStore((s) => s.dirty);
  const fileName = useStore((s) => s.fileName);
  useEffect(() => {
    // Without a document: the descriptive title (and description) in the interface language, as search results show them.
    document.title = fileName ? `${dirty ? '• ' : ''}${fileName} — PDF-Xploder` : `PDF-Xploder – ${t(SITE_TITLE)}`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t(SITE_DESCRIPTION));
  }, [dirty, fileName, t]);
  return null;
}

// Kept in step with index.html, which has them for the first paint and for crawlers.
const SITE_TITLE = 'Free PDF Editor in Your Browser';
const SITE_DESCRIPTION = 'Edit, annotate, organise, fill, sign, OCR and protect PDFs for free, right in your browser. No upload, no account: files never leave your device. Works offline.';

export function App() {
  const t = useT();
  const hasDoc = useStore((s) => !!s.pdf);
  // A document being opened or restored: no start screen in between.
  const opening = useStore((s) => s.opening || (!s.pdf && !!s.bytes));
  const sidebar = useStore((s) => s.sidebar);
  const showTabs = useStore((s) => s.tabs.length > 1 || !!s.pdf);
  const showProps = usePrefs((p) => p.showProps);
  const sidebarWidth = usePrefs((p) => p.sidebarWidth);
  const propsWidth = usePrefs((p) => p.propsWidth);
  const setShowProps = (v: boolean) => setPrefs({ showProps: v });
  useEffect(() => {
    const show = () => setPrefs({ showProps: true });
    window.addEventListener('awesome-pdf:show-properties', show);
    return () => window.removeEventListener('awesome-pdf:show-properties', show);
  }, []);
  useShortcuts();
  useFormFields();

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // Changes kept by the session backup come back at the next start; only warn about the rest.
      if (anyUnsavedUnprotected(useSession.getState().enabled)) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);


  return (
    <div className="app">
      <Ribbon showProps={showProps} toggleProps={() => setShowProps(!showProps)} />
      {showTabs && <TabBar />}
      <div className="workspace" style={{ '--sidebar-w': `${sidebarWidth}px`, '--props-w': `${propsWidth}px` } as React.CSSProperties}>
        {hasDoc && (
          <nav className="sidebar-rail">
            {SIDEBAR.map(({ tab, icon: Icon, label }) => (
              <button key={tab} title={t(label)} className={sidebar === tab ? 'active' : ''} onClick={() => useStore.getState().setSidebar(sidebar === tab ? null : tab)}>
                <Icon size={18} />
              </button>
            ))}
          </nav>
        )}
        {hasDoc && sidebar && (
          <aside className="sidebar">
            {sidebar === 'pages' && <Thumbnails />}
            {sidebar === 'outline' && <Outline />}
            {sidebar === 'comments' && <CommentsPanel />}
            {sidebar === 'attachments' && <AttachmentsPanel />}
            {sidebar === 'forms' && <FormsPanel />}
            {sidebar === 'search' && <SearchPanel />}
            {sidebar === 'signatures' && <SignaturesPanel />}
          </aside>
        )}
        {hasDoc && sidebar && <PaneResizer pane="sidebar" />}
        <main className="main">{hasDoc ? <><DocBanner /><Viewer /></> : opening ? <div className="main-loading" /> : <Welcome />}</main>
        {hasDoc && showProps && <PaneResizer pane="props" />}
        {hasDoc && showProps && <PropertiesPanel />}
      </div>
      {hasDoc && <StatusBar />}
      <Dialogs />
      <BusyShield />
      <Toast />
      <AskHost />
      <TitleSync />
    </div>
  );
}
