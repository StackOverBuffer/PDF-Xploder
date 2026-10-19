/** Building blocks of the PDF-XChange style ribbon. */
import { Children, createContext, isValidElement, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useStore, type SidebarTab } from '../store/store';
import { allowed } from '../store/permissions';
import { formatPercent, parsePercent, useLang, useT } from '../lib/i18n';
import { Menu, rectAnchor, wrapClose, type MenuItem } from './Menu';
import type { Tool } from '../lib/types';
import type { CommandEntry } from '../lib/commandSearch';

export type { MenuItem };

const S = useStore.getState;

export const L = 24; // big button icon size
export const I = 16; // small button icon size

// ---------------------------------------------------------------- command harvesting

/**
 * While the command search renders the ribbon off-screen, buttons and groups
 * report themselves here instead of drawing anything.
 */
export interface Harvest {
  add(e: CommandEntry): void;
  /** English keys of the enclosing tab, group and menu button. */
  path: string[];
}

export const HarvestContext = createContext<Harvest | null>(null);

/** Closes the folded group a button sits in (see Group), after a command from its menu. */
const FoldContext = createContext<(() => void) | null>(null);

function harvestMenu(h: Harvest, path: string[], items: MenuItem[], off = false) {
  for (const it of items) {
    if (!it) continue;
    if (it.submenu) harvestMenu(h, [...path, it.label], it.submenu, off || !!it.disabled);
    else if (it.onClick || it.unavailable) {
      h.add({
        id: [...path, it.label, it.value ?? ''].join('/'),
        label: it.label,
        path,
        value: it.value,
        keys: it.hint,
        icon: it.icon,
        run: it.onClick,
        disabled: off || it.disabled || !!it.unavailable || !it.onClick,
        reason: it.unavailable,
        checked: it.checked,
      });
    }
  }
}

function harvestButton(h: Harvest, p: BtnProps) {
  const label = p.searchLabel ?? p.label;
  if (p.onClick) {
    h.add({ id: [...h.path, label].join('/'), label, path: h.path, title: p.title, keys: p.keys, icon: p.icon, run: p.onClick, disabled: p.disabled, checked: p.active });
  }
  // "Stamp › Stamp › Approved" reads better as "Stamp › Approved".
  if (p.menu) harvestMenu(h, h.path[h.path.length - 1] === label ? h.path : [...h.path, label], typeof p.menu === 'function' ? p.menu() : p.menu, p.disabled);
}

// ---------------------------------------------------------------- buttons

export interface BtnProps {
  icon: ReactNode;
  label: string;
  /** Without onClick a button with a menu just opens it; with both it is a split button. */
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  menu?: MenuItem[] | (() => MenuItem[]);
  /** big: icon above label; small: icon beside label; icon: icon only. */
  size?: 'big' | 'small' | 'icon';
  /** Keyboard shortcut shown in the tooltip. */
  keys?: string;
  /** Name in the command search, for buttons whose label shows a current value. */
  searchLabel?: string;
}

export function Btn(props: BtnProps) {
  const { icon, label, onClick, active, disabled, title, menu, size = 'big', keys } = props;
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const harvest = useContext(HarvestContext);
  const closeFold = useContext(FoldContext);
  if (harvest) {
    harvestButton(harvest, props);
    return null;
  }
  const text = t(label);
  const tip = `${title ? t(title) : text}${keys ? ` (${keys})` : ''}`;
  const open = () => setAnchor(anchor ? null : ref.current!.getBoundingClientRect());
  const split = !!menu && !!onClick;
  const caret = <ChevronDown className="caret" size={10} />;
  return (
    <div ref={ref} className={`rbtn-wrap size-${size} ${split ? 'split' : ''} ${active ? 'active' : ''}`}>
      <button
        className={`rbtn size-${size} ${active ? 'active' : ''}`}
        disabled={disabled}
        title={tip}
        aria-label={size === 'icon' ? tip : undefined}
        aria-pressed={active}
        aria-haspopup={menu && !onClick ? 'menu' : undefined}
        aria-expanded={menu && !onClick ? !!anchor : undefined}
        onClick={onClick ?? open}
      >
        {icon}
        {size !== 'icon' && <span className="rlabel">{text}{menu && !onClick && caret}</span>}
        {size === 'icon' && menu && !onClick && caret}
      </button>
      {split && (
        <button className="rbtn-caret" disabled={disabled} title={tip} aria-label={`${tip} – ${t('More')}`} aria-haspopup="menu" aria-expanded={!!anchor} onClick={open}>
          {size === 'big' && <span className="rlabel-hidden">{text}</span>}
          {caret}
        </button>
      )}
      {anchor && menu && <Menu anchor={rectAnchor(anchor)} items={wrapClose(typeof menu === 'function' ? menu() : menu, () => {
            setAnchor(null);
            closeFold?.();
          })} onClose={() => setAnchor(null)} />}
    </div>
  );
}

/** The icon of a group's first button, for the group's button when the ribbon folds it up. */
function firstIcon(children: ReactNode): ReactNode {
  for (const c of Children.toArray(children)) {
    if (!isValidElement(c)) continue;
    const p = c.props as { icon?: ReactNode; children?: ReactNode };
    if (p.icon) return p.icon;
    const inner = firstIcon(p.children);
    if (inner) return inner;
  }
  return null;
}

/**
 * A ribbon group. When the window is too narrow, the ribbon folds groups up from the
 * right (data-collapsed, set by the ribbon): the group shows one button that opens its
 * buttons below it, as in PDF-XChange and Office.
 */
export function Group({ label, children }: { label: string; children: ReactNode }) {
  const t = useT();
  const harvest = useContext(HarvestContext);
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!at) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element;
      if (!ref.current?.contains(el) && !el.closest?.('.rmenu')) setAt(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAt(null);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', () => setAt(null), { once: true });
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [at]);
  if (harvest) return <HarvestContext.Provider value={{ ...harvest, path: [...harvest.path, label] }}>{children}</HarvestContext.Provider>;
  const open = () => {
    if (at) return setAt(null);
    const r = ref.current!.getBoundingClientRect();
    setAt({ left: Math.max(4, Math.min(r.left, window.innerWidth - 320)), top: r.bottom + 2 });
  };
  return (
    <div ref={ref} className="rgroup" role="group" aria-label={t(label)} data-open={at ? '' : undefined}>
      <button className="rbtn size-big rgroup-fold" title={t(label)} aria-haspopup="true" aria-expanded={!!at} onClick={open}>
        {firstIcon(children)}
        <span className="rlabel">{t(label)}<ChevronDown className="caret" size={10} /></span>
      </button>
      <div
        className="rgroup-items"
        style={at ?? undefined}
        // A command chosen from the folded group closes it (not a button that opens a menu).
        onClick={(e) => {
          const b = (e.target as Element).closest('button');
          if (at && b && !b.disabled && !b.hasAttribute('aria-haspopup')) setAt(null);
        }}
      >
        <FoldContext.Provider value={() => setAt(null)}>{children}</FoldContext.Provider>
      </div>
      <div className="rgroup-label">{t(label)}</div>
    </div>
  );
}

/** Small buttons stacked in a column (up to three rows, as in PDF-XChange). */
export const Stack = ({ children }: { children: ReactNode }) => <div className="rstack">{children}</div>;
export const Row = ({ children }: { children: ReactNode }) => <div className="rrow">{children}</div>;

/** Which permission a tool needs, or null when it only views. */
export function toolPermission(tool: Tool) {
  if (tool === 'select' || tool === 'selectText' || tool === 'hand' || tool === 'content' || tool === 'zoom') return null;
  if (tool === 'snapshot') return 'copy' as const;
  if (tool === 'sign') return 'fillForms' as const;
  if (tool.startsWith('field')) return 'designForms' as const;
  if (tool.startsWith('content')) return 'modify' as const;
  return 'annotate' as const;
}

export function useToolState(tool: Tool) {
  const current = useStore((s) => s.tool);
  const hasDoc = useStore((s) => !!s.pdf);
  const need = toolPermission(tool);
  const permitted = useStore((s) => need === null || allowed(s, need));
  return {
    active: current === tool,
    disabled: !hasDoc || !permitted,
    activate: () => {
      const s = S();
      const sticky = need === null || tool === 'snapshot';
      s.setTool(s.tool === tool && !sticky ? 'select' : tool);
      if (tool.startsWith('field')) useStore.setState({ formDesign: true });
    },
  };
}

export function ToolBtn({ tool, icon, label, size, menu, title, keys }: { tool: Tool; icon: ReactNode; label: string; size?: BtnProps['size']; menu?: BtnProps['menu']; title?: string; keys?: string }) {
  const st = useToolState(tool);
  return <Btn icon={icon} label={label} size={size} menu={menu} title={title} keys={keys} active={st.active} disabled={st.disabled} onClick={st.activate} />;
}

export function SidebarBtn({ tab, icon, label, size }: { tab: SidebarTab; icon: ReactNode; label: string; size?: BtnProps['size'] }) {
  const sidebar = useStore((s) => s.sidebar);
  const hasDoc = useStore((s) => !!s.pdf);
  return <Btn icon={icon} label={label} size={size} active={sidebar === tab} disabled={!hasDoc} onClick={() => S().setSidebar(sidebar === tab ? null : tab)} />;
}

/** Editable zoom level with a preset list, between zoom out and zoom in. */
export function ZoomBox() {
  const lang = useLang((l) => l.lang);
  const t = useT();
  const scale = useStore((s) => s.scale);
  const fit = useStore((s) => s.fit);
  const hasDoc = useStore((s) => !!s.pdf);
  const [text, setText] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const harvest = useContext(HarvestContext);
  const commit = () => {
    const v = text === null ? null : parsePercent(text);
    if (v) S().setScale(v);
    setText(null);
  };
  const presets: MenuItem[] = [
    ...[0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8].map((z) => ({ label: formatPercent(lang, z), checked: !fit && Math.abs(scale - z) < 0.001, onClick: () => S().setScale(z) })),
    null,
    { label: 'Fit page', checked: fit === 'page', onClick: () => S().setScale(scale, 'page') },
    { label: 'Fit width', checked: fit === 'width', onClick: () => S().setScale(scale, 'width') },
  ];
  if (harvest) return null;
  return (
    <div className="rzoom" ref={ref}>
      <input
        aria-label={t('Zoom level')}
        title={t('Zoom level')}
        disabled={!hasDoc}
        value={hasDoc ? text ?? formatPercent(lang, scale) : ''}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <button disabled={!hasDoc} aria-label={t('Zoom level')} aria-haspopup="menu" onClick={() => setAnchor(anchor ? null : ref.current!.getBoundingClientRect())}><ChevronDown size={12} /></button>
      {anchor && <Menu anchor={rectAnchor(anchor)} items={presets} onClose={() => setAnchor(null)} />}
    </div>
  );
}

