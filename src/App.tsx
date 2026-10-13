import { useEffect, useState } from 'react';
import { FolderOpen, FilePlus, Sparkles, LayoutGrid, ListTree, MessageSquare, FormInput, Search, FileSignature } from 'lucide-react';
import { useStore, type SidebarTab } from './store/store';
import * as cmd from './store/commands';
import { Ribbon } from './components/Ribbon';
import { Viewer } from './components/Viewer';
import { Thumbnails } from './components/Thumbnails';
import { Outline } from './components/Outline';
import { CommentsPanel } from './components/CommentsPanel';
import { FormsPanel } from './components/FormsPanel';
import { SearchPanel } from './components/SearchPanel';
import { DocBanner, SignaturesPanel } from './components/SignaturesPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { StatusBar } from './components/StatusBar';
import { Dialogs, useDialog } from './components/Dialogs';
import { createSampleDocument } from './lib/sample';
import { getFormFields } from './lib/pdfOps';
import type { Tool } from './lib/types';

const SIDEBAR: { tab: SidebarTab; icon: typeof LayoutGrid; label: string }[] = [
  { tab: 'pages', icon: LayoutGrid, label: 'Pages' },
  { tab: 'outline', icon: ListTree, label: 'Bookmarks' },
  { tab: 'comments', icon: MessageSquare, label: 'Comments' },
  { tab: 'forms', icon: FormInput, label: 'Form fields' },
  { tab: 'search', icon: Search, label: 'Search' },
  { tab: 'signatures', icon: FileSignature, label: 'Signatures' },
];

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select', h: 'hand', H: 'highlight', u: 'underline', k: 'strikeout', p: 'ink', r: 'rect', o: 'ellipse',
  l: 'line', a: 'arrow', t: 'text', n: 'note', s: 'stamp',
};

async function openSample() {
  const s = useStore.getState();
  await s.run('Creating sample…', async () => s.openDocument(await createSampleDocument(), 'sample.pdf'));
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
        if (!s.pdf) return;
        if (k === 's') return run(e.shiftKey ? cmd.saveAs : cmd.save);
        if (k === 'p') return run(cmd.print);
        if (k === 'f') return run(() => { s.setSidebar('search'); window.dispatchEvent(new Event('awesome-pdf:focus-search')); });
        if (k === 'g') return run(() => useDialog.getState().show('goto'));
        if (k === '=' || k === '+') return run(() => s.setScale(s.scale * 1.2));
        if (k === '-') return run(() => s.setScale(s.scale / 1.2));
        if (k === '0') return run(() => s.setScale(s.scale, 'width'));
        if (typing) return;
        if (k === 'z' && !e.shiftKey) return run(() => s.undo());
        if (k === 'y' || (k === 'z' && e.shiftKey)) return run(() => s.redo());
        return;
      }
      if (typing || !s.pdf) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selected) {
        e.preventDefault();
        s.deleteAnnotation(s.selected.pageId, s.selected.id);
      } else if (e.key === 'Escape') {
        s.select(null);
        s.setTool('select');
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        s.goToPage(s.currentPage + 1);
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        s.goToPage(s.currentPage - 1);
      } else if (!e.altKey && TOOL_KEYS[e.key]) {
        const tool = TOOL_KEYS[e.key];
        if (tool === 'select' || tool === 'hand' || s.editable) s.setTool(tool);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Welcome() {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`welcome ${over ? 'drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); cmd.openFiles(Array.from(e.dataTransfer.files)); }}
    >
      <div className="welcome-card">
        <h1>Awesome PDF</h1>
        <p className="muted">View, annotate, organise, fill and sign PDFs — entirely in your browser. Files never leave your device.</p>
        <div className="welcome-actions">
          <button className="primary big" onClick={cmd.openFromDialog}><FolderOpen size={18} /> Open PDF…</button>
          <button className="big" onClick={cmd.newDocument}><FilePlus size={18} /> New blank</button>
          <button className="big" onClick={openSample}><Sparkles size={18} /> Try a sample</button>
        </div>
        <p className="muted small">…or drop PDF files here. Dropping several combines them into one document.</p>
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
  const hasDoc = useStore((s) => !!s.pdf);
  const sidebar = useStore((s) => s.sidebar);
  const toast = useStore((s) => s.toast);
  const busy = useStore((s) => s.busy);
  const dirty = useStore((s) => s.dirty);
  const [showProps, setShowProps] = useState(true);
  useShortcuts();
  useFormFields();

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    const name = useStore.getState().fileName;
    document.title = name ? `${dirty ? '• ' : ''}${name} — Awesome PDF` : 'Awesome PDF';
  }, [dirty, hasDoc]);

  return (
    <div className="app">
      <Ribbon showProps={showProps} toggleProps={() => setShowProps(!showProps)} />
      <div className="workspace">
        {hasDoc && (
          <nav className="sidebar-rail">
            {SIDEBAR.map(({ tab, icon: Icon, label }) => (
              <button key={tab} title={label} className={sidebar === tab ? 'active' : ''} onClick={() => useStore.getState().setSidebar(sidebar === tab ? null : tab)}>
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
