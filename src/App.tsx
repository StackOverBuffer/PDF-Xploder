import { can } from './store/permissions';
import { useEffect, useState } from 'react';
import { FolderOpen, FilePlus, Sparkles, LayoutGrid, ListTree, MessageSquare, FormInput, Search, FileSignature, Paperclip } from 'lucide-react';
import { anyTabDirty, useStore, type SidebarTab } from './store/store';
import * as cmd from './store/commands';
import { Ribbon } from './components/Ribbon';
import { TabBar } from './components/TabBar';
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
import { getFormFields } from './lib/pdfOps';
import type { Tool } from './lib/types';
import { useT } from './lib/i18n';

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
  l: 'line', a: 'arrow', y: 'polygon', j: 'polyline', w: 'cloud', t: 'text', n: 'note', s: 'stamp',
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
      if (mod) {
        const k = e.key.toLowerCase();
        const run = (fn: () => unknown) => { e.preventDefault(); fn(); };
        if (k === 'o') return run(cmd.openFromDialog);
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
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selected) {
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
  const [over, setOver] = useState(false);
  return (
    <div
      className={`welcome ${over ? 'drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); cmd.openFiles(Array.from(e.dataTransfer.files)); }}
    >
      <div className="welcome-card">
        <h1>PDF-Xploder</h1>
        <p className="muted">{t('View, annotate, organise, fill and sign PDFs — entirely in your browser. Files never leave your device.')}</p>
        <div className="welcome-actions">
          <button className="primary big" onClick={cmd.openFromDialog}><FolderOpen size={18} /> {t('Open PDF…')}</button>
          <button className="big" onClick={cmd.newDocument}><FilePlus size={18} /> {t('New blank')}</button>
          <button className="big" onClick={openSample}><Sparkles size={18} /> {t('Try a sample')}</button>
        </div>
        <p className="muted small">{t('…or drop PDF files here. Dropping several combines them into one document.')}</p>
      </div>
    </div>
  );
}

/** Keep the store's list of form fields in sync with the document bytes. */
function useFormFields() {
  const bytes = useStore((s) => s.bytes);
  const editable = useStore((s) => s.editable);
  useEffect(() => {
    let live = true;
    if (!bytes || !editable) {
      useStore.setState({ fields: [] });
      return;
    }
    getFormFields(bytes)
      .then((fields) => live && useStore.setState({ fields }))
      .catch(() => live && useStore.setState({ fields: [] }));
    return () => {
      live = false;
    };
  }, [bytes, editable]);
}

export function App() {
  const t = useT();
  const hasDoc = useStore((s) => !!s.pdf);
  const sidebar = useStore((s) => s.sidebar);
  const toast = useStore((s) => s.toast);
  const busy = useStore((s) => s.busy);
  const dirty = useStore((s) => s.dirty);
  const fileName = useStore((s) => s.fileName);
  const showTabs = useStore((s) => s.tabs.length > 1 || !!s.pdf);
  const [showProps, setShowProps] = useState(true);
  useEffect(() => {
    const show = () => setShowProps(true);
    window.addEventListener('awesome-pdf:show-properties', show);
    return () => window.removeEventListener('awesome-pdf:show-properties', show);
  }, []);
  useShortcuts();
  useFormFields();

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (anyTabDirty()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    document.title = fileName ? `${dirty ? '• ' : ''}${fileName} — PDF-Xploder` : 'PDF-Xploder';
  }, [dirty, hasDoc, fileName]);

  return (
    <div className="app">
      <Ribbon showProps={showProps} toggleProps={() => setShowProps(!showProps)} />
      {showTabs && <TabBar />}
      <div className="workspace">
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
        <main className="main">{hasDoc ? <><DocBanner /><Viewer /></> : <Welcome />}</main>
        {hasDoc && showProps && <PropertiesPanel />}
      </div>
      {hasDoc && <StatusBar />}
      <Dialogs />
      {busy && <div className="busy-bar" />}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.msg}</div>}
    </div>
  );
}
