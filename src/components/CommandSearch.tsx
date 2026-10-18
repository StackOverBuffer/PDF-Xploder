/**
 * Command search beside the ribbon tabs, like PDF-XChange's search for commands:
 * type part of a name ("rotate", "Wasserzeichen") and run it with Enter.
 * The list comes from rendering every ribbon tab off-screen, so it always
 * matches the ribbon, including menu entries and what is currently disabled.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Search } from 'lucide-react';
import { useT } from '../lib/i18n';
import { dedupe, recentCommands, rememberCommand, searchCommands, type CommandEntry } from '../lib/commandSearch';
import { HarvestContext, type Harvest } from './ribbonParts';
import { RibbonTab, TABS, type RibbonTabProps } from './Ribbon';

type TabProps = Omit<RibbonTabProps, 'tab'>;

/** Render all ribbon tabs without drawing them and hand back what they contain. */
function Harvester({ onDone, ...props }: TabProps & { onDone: (e: CommandEntry[]) => void }) {
  const found = useRef(new Map<string, CommandEntry>());
  const harvests = useMemo(
    () => TABS.map((tab): Harvest => ({ path: [tab], add: (e) => void (found.current.has(e.id) || found.current.set(e.id, e)) })),
    [],
  );
  useLayoutEffect(() => {
    onDone(dedupe([...found.current.values()]));
    // Collect once per opening: the list closes again before anything can change.
  }, []);
  return (
    <div hidden>
      {TABS.map((tab, i) => (
        <HarvestContext.Provider key={tab} value={harvests[i]}>
          <RibbonTab tab={tab} {...props} />
        </HarvestContext.Provider>
      ))}
    </div>
  );
}

export const FOCUS_COMMAND_SEARCH = 'pdf-xploder:command-search';

export function CommandSearch(props: TabProps) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<CommandEntry[] | null>(null);
  const [sel, setSel] = useState(0);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    const focus = () => input.current?.focus();
    window.addEventListener(FOCUS_COMMAND_SEARCH, focus);
    return () => window.removeEventListener(FOCUS_COMMAND_SEARCH, focus);
  }, []);

  const results = useMemo(() => {
    if (!entries) return [];
    if (query.trim()) return searchCommands(entries, query);
    const byId = new Map(entries.map((e) => [e.id, e]));
    return recentCommands().flatMap((id) => byId.get(id) ?? []);
  }, [entries, query]);

  useEffect(() => setSel(0), [query]);

  const show = () => {
    const r = input.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setEntries(null);
    setQuery('');
  };
  const choose = (e: CommandEntry | undefined) => {
    if (!e?.run || e.disabled) return;
    rememberCommand(e.id);
    input.current?.blur();
    close();
    // Synchronously, so commands that open a file dialog still count as a user action.
    e.run();
  };

  const where = (e: CommandEntry) => e.path.map((p) => t(p)).join(' › ');

  return (
    <div className="cmdsearch">
      <Search size={14} className="cmdsearch-icon" />
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="cmdsearch-list"
        aria-activedescendant={open && results[sel] ? `cmd-${sel}` : undefined}
        aria-label={t('Search commands')}
        placeholder={`${t('Search commands')} (Ctrl+K)`}
        value={query}
        onFocus={show}
        onBlur={close}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) show();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = results.length;
            if (n) setSel((sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(results[sel]);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            if (query) setQuery('');
            else input.current?.blur();
          }
        }}
      />
      {open && !entries && <Harvester {...props} onDone={setEntries} />}
      {open && pos &&
        createPortal(
          <div className="cmdsearch-pop" style={{ top: pos.top, right: pos.right }} onMouseDown={(e) => e.preventDefault()}>
            {!results.length && (
              <div className="cmdsearch-empty">
                {query.trim() ? t('No matching commands') : t('Type to search every command, e.g. “rotate”, “watermark” or “OCR”.')}
              </div>
            )}
            {!!results.length && !query.trim() && <div className="cmdsearch-heading">{t('Recently used')}</div>}
            <ul id="cmdsearch-list" role="listbox" aria-label={t('Commands')}>
              {results.map((e, i) => (
                <li
                  key={e.id}
                  id={`cmd-${i}`}
                  role="option"
                  aria-selected={i === sel}
                  aria-disabled={e.disabled || undefined}
                  className={`cmdsearch-item ${i === sel ? 'sel' : ''} ${e.disabled ? 'disabled' : ''}`}
                  title={e.disabled ? t(e.reason ?? 'Not available right now') : e.title ? t(e.title) : undefined}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => choose(e)}
                >
                  <span className="cmdsearch-glyph">{e.checked ? <Check size={14} /> : e.icon}</span>
                  <span className="cmdsearch-text">
                    <span className="cmdsearch-label">{t(e.label)}{e.value ? ` ${e.value}` : ''}</span>
                    <span className="cmdsearch-where">{where(e)}</span>
                  </span>
                  {e.keys && <kbd>{t(e.keys)}</kbd>}
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
