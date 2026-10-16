/** Document tabs above the viewer, as in PDF-XChange Editor. */
import { useRef, useState } from 'react';
import { FileText, Plus, X } from 'lucide-react';
import { useStore, type TabInfo } from '../store/store';
import * as cmd from '../store/commands';
import { useT } from '../lib/i18n';
import { useContextMenu, type MenuItem } from './Menu';

const S = () => useStore.getState();

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
    <div className="tabbar" role="tablist" aria-label={t('Documents')} onDragLeave={() => setDropAt(null)}>
      {tabs.map((tab, i) => {
        const { name, dirty } = info(tab);
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === active}
            tabIndex={0}
            className={`doctab ${tab.id === active ? 'active' : ''} ${dropAt === i ? 'drop-before' : ''} ${dropAt === i + 1 && i === tabs.length - 1 ? 'drop-after' : ''}`}
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
              if (!dragId.current) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1);
            }}
            onDrop={(e) => {
              e.preventDefault();
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
      <button className="doctab-new" title={t('Open…')} aria-label={t('Open…')} onClick={cmd.openFromDialog}><Plus size={14} /></button>
      {menu.element}
    </div>
  );
}
