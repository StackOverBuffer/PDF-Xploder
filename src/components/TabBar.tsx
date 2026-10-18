/** Document tabs above the viewer, as in PDF-XChange Editor. */
import { useEffect, useRef, useState } from 'react';
import { FileText, Plus, X } from 'lucide-react';
import { useStore, type TabInfo } from '../store/store';
import * as cmd from '../store/commands';
import { useT } from '../lib/i18n';
import { useContextMenu, type MenuItem } from './Menu';
import { PAGE_DRAG_TYPE, draggingPages, dropPages, dropPagesAsNewDocument } from '../store/pageTransfer';

const S = () => useStore.getState();

/** Hovering a tab with dragged pages for this long switches to it. */
const HOVER_SWITCH_MS = 600;
const isPageDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(PAGE_DRAG_TYPE) && draggingPages();

/** Close several tabs; stops at the first one the user decides to keep. */
function closeMany(ids: string[]) {
  for (const id of ids) if (!S().closeTab(id)) return;
}

export function TabBar() {
  const t = useT();
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTab);
  const activeName = useStore((s) => s.fileName);
  const activeDirty = useStore((s) => s.dirty);
  const busy = useStore((s) => !!s.busy);
  const menu = useContextMenu();
  const dragId = useRef<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [pageTarget, setPageTarget] = useState<string | null>(null);
  const hover = useRef<{ id: string; timer: number } | null>(null);
  const stopHover = () => {
    if (hover.current) clearTimeout(hover.current.timer);
    hover.current = null;
    setPageTarget(null);
  };
  // A drag that ends anywhere (or is cancelled) clears the highlight.
  useEffect(() => {
    const end = () => stopHover();
    window.addEventListener('drop', end);
    window.addEventListener('dragend', end);
    return () => {
      window.removeEventListener('drop', end);
      window.removeEventListener('dragend', end);
    };
  }, []);
  /** Dragged pages over a tab: drop to copy them to its end, or wait to switch to it. */
  const pageDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setPageTarget(id);
    if (hover.current?.id === id) return;
    if (hover.current) clearTimeout(hover.current.timer);
    hover.current = { id, timer: window.setTimeout(() => S().switchTab(id), HOVER_SWITCH_MS) };
  };

  const info = (tab: TabInfo) => (tab.id === active ? { name: activeName, dirty: activeDirty } : { name: tab.fileName, dirty: tab.dirty });

  const tabMenu = (tab: TabInfo, index: number): MenuItem[] => [
    { label: 'Close', hint: t('Middle click'), onClick: () => S().closeTab(tab.id) },
    { label: 'Close others', disabled: tabs.length < 2, onClick: () => closeMany(tabs.filter((x) => x.id !== tab.id).map((x) => x.id)) },
    { label: 'Close tabs to the right', disabled: index === tabs.length - 1, onClick: () => closeMany(tabs.slice(index + 1).map((x) => x.id)) },
    { label: 'Close all', onClick: () => closeMany(tabs.map((x) => x.id)) },
    null,
    { label: 'Open…', onClick: cmd.openFromDialog },
  ];

  return (
    <div
      className={`tabbar ${pageTarget === 'new' ? 'page-drop-new' : ''}`}
      role="tablist"
      aria-label={t('Documents')}
      onDragLeave={(e) => {
        setDropAt(null);
        if (!e.currentTarget.contains(e.relatedTarget as Node)) stopHover();
      }}
      onDragOver={(e) => {
        // Pages dropped on empty space or "+" become a new document.
        if (!isPageDrag(e) || e.target !== e.currentTarget) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (hover.current) stopHover();
        setPageTarget('new');
      }}
      onDrop={(e) => {
        if (!isPageDrag(e) || e.target !== e.currentTarget) return;
        e.preventDefault();
        stopHover();
        dropPagesAsNewDocument();
      }}
    >
      {tabs.map((tab, i) => {
        const { name, dirty } = info(tab);
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === active}
            tabIndex={0}
            className={`doctab ${tab.id === active ? 'active' : ''} ${pageTarget === tab.id ? 'page-drop' : ''} ${dropAt === i ? 'drop-before' : ''} ${dropAt === i + 1 && i === tabs.length - 1 ? 'drop-after' : ''}`}
            title={name || t('Untitled')}
            draggable
            onClick={() => S().switchTab(tab.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && S().switchTab(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                S().closeTab(tab.id);
              }
            }}
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onContextMenu={(e) => menu.open(e, tabMenu(tab, i))}
            onDragStart={(e) => {
              dragId.current = tab.id;
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', name);
            }}
            onDragOver={(e) => {
              if (isPageDrag(e)) return pageDragOver(e, tab.id);
              if (!dragId.current) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (isPageDrag(e)) {
                stopHover();
                // Onto a tab: append the pages to that document.
                S().switchTab(tab.id);
                return void dropPages();
              }
              const id = dragId.current;
              dragId.current = null;
              setDropAt(null);
              if (!id || dropAt === null) return;
              const from = tabs.findIndex((x) => x.id === id);
              S().moveTab(id, dropAt > from ? dropAt - 1 : dropAt);
            }}
            onDragEnd={() => {
              dragId.current = null;
              setDropAt(null);
            }}
          >
            <FileText size={14} className="doctab-icon" />
            <span className="doctab-name">{name || t('Untitled')}</span>
            {dirty && <span className="doctab-dirty" aria-label={t('Unsaved changes')}>•</span>}
            <button
              className="doctab-close"
              title={t('Close')}
              aria-label={`${t('Close')} ${name}`}
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                S().closeTab(tab.id);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button
        className={`doctab-new ${pageTarget === 'new' ? 'page-drop' : ''}`}
        title={t('Open…')}
        aria-label={t('Open…')}
        onClick={cmd.openFromDialog}
        onDragOver={(e) => {
          if (!isPageDrag(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (hover.current) stopHover();
          setPageTarget('new');
        }}
        onDrop={(e) => {
          if (!isPageDrag(e)) return;
          e.preventDefault();
          stopHover();
          dropPagesAsNewDocument();
        }}
      >
        <Plus size={14} />
      </button>
      {menu.element}
    </div>
  );
}
