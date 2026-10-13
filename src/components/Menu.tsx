/**
 * Drop-down and context menus with submenus, rendered at the top level so
 * scrolling containers do not clip them.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight } from 'lucide-react';
import { useT } from '../lib/i18n';

export type MenuItem =
  | {
      label: string;
      icon?: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
      checked?: boolean;
      /** Shortcut or note shown on the right. */
      hint?: string;
      /** Extra (untranslated) text after the label, e.g. a current value. */
      value?: string;
      submenu?: MenuItem[];
      /** Shown as disabled with this explanation as tooltip. */
      unavailable?: string;
    }
  | null;

export interface Anchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const pointAnchor = (x: number, y: number): Anchor => ({ left: x, top: y, right: x, bottom: y });
export const rectAnchor = (r: DOMRect): Anchor => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

interface Props {
  anchor: Anchor;
  items: MenuItem[];
  onClose: () => void;
  /** Open to the side of the anchor (submenus) instead of below it. */
  side?: boolean;
  /** Root menus handle outside clicks and Escape; submenus leave that to the root. */
  root?: boolean;
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

export function Menu({ anchor, items, onClose, side, root = true }: Props) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: side ? anchor.right : anchor.left, top: side ? anchor.top : anchor.bottom + 2 });
  const [sub, setSub] = useState<{ index: number; anchor: Anchor } | null>(null);
  const hoverTimer = useRef<number>();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (side) {
      const left = anchor.right + w > W - 4 ? Math.max(4, anchor.left - w) : anchor.right;
      setPos({ left, top: Math.max(4, Math.min(anchor.top - 4, H - h - 4)) });
    } else {
      setPos({
        left: Math.max(4, Math.min(anchor.left, W - w - 4)),
        top: anchor.bottom + h + 2 > H ? Math.max(4, anchor.top - h - 2) : anchor.bottom + 2,
      });
    }
  }, [anchor, side]);

  useEffect(() => {
    if (!root) return;
    const onDown = (e: PointerEvent) => !(e.target as Element).closest?.('.rmenu') && onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // Defer so the click that opened the menu does not close it.
    const id = setTimeout(() => window.addEventListener('pointerdown', onDown, true));
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      clearTimeout(id);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose, root]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, []);

  const openSub = (i: number, el: HTMLElement) => setSub({ index: i, anchor: rectAnchor(el.getBoundingClientRect()) });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'ArrowRight' && i >= 0) {
      const idx = Number(buttons[i].dataset.index);
      if (items[idx]?.submenu) openSub(idx, buttons[i]);
    } else if (e.key === 'ArrowLeft' && !root) {
      e.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div
      ref={ref}
      className="rmenu"
      role="menu"
      style={pos}
      onKeyDown={onKeyDown}
      // React events bubble out of portals to the component that opened the menu
      // (e.g. a page layer that would start a drag): keep them inside.
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onMouseDown={stop}
      onMouseUp={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {items.map((it, i) => {
        if (it === null) return <div key={i} className="rmenu-sep" role="separator" />;
        const disabled = it.disabled || !!it.unavailable;
        return (
          <button
            key={i}
            data-index={i}
            role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={it.checked}
            aria-haspopup={it.submenu ? 'menu' : undefined}
            aria-expanded={it.submenu ? sub?.index === i : undefined}
            disabled={disabled && !it.submenu}
            aria-disabled={disabled || undefined}
            className={`${sub?.index === i ? 'open' : ''} ${disabled ? 'is-disabled' : ''}`}
            title={it.unavailable ? t(it.unavailable) : undefined}
            onPointerEnter={(e) => {
              window.clearTimeout(hoverTimer.current);
              const el = e.currentTarget;
              hoverTimer.current = window.setTimeout(() => (it.submenu && !disabled ? openSub(i, el) : setSub(null)), 120);
            }}
            onClick={(e) => {
              if (disabled) return;
              if (it.submenu) return openSub(i, e.currentTarget);
              onClose();
              it.onClick?.();
            }}
          >
            <span className="rmenu-icon">{it.checked ? <Check size={14} /> : it.icon}</span>
            <span className="rmenu-label">{t(it.label)}{it.value && <b> {it.value}</b>}</span>
            {it.hint && <span className="rmenu-hint">{t(it.hint)}</span>}
            {it.submenu && <ChevronRight className="rmenu-arrow" size={14} />}
          </button>
        );
      })}
      {sub && items[sub.index]?.submenu && (
        <Menu
          anchor={sub.anchor}
          items={items[sub.index]!.submenu!}
          side
          root={false}
          onClose={() => {
            // Closing a submenu by picking an item closes the whole menu.
            setSub(null);
          }}
        />
      )}
    </div>,
    document.body,
  );
}

/** Close the whole menu tree after an item in a submenu runs. */
export function wrapClose(items: MenuItem[], close: () => void): MenuItem[] {
  return items.map((it) =>
    it === null ? null : it.submenu ? { ...it, submenu: wrapClose(it.submenu, close) } : { ...it, onClick: it.onClick && (() => { close(); it.onClick!(); }) },
  );
}

/** State for a context menu opened at the pointer. */
export function useContextMenu() {
  const [menu, setMenu] = useState<{ anchor: Anchor; items: MenuItem[] } | null>(null);
  const close = () => setMenu(null);
  const open = (e: { clientX: number; clientY: number; preventDefault(): void }, items: MenuItem[]) => {
    e.preventDefault();
    setMenu({ anchor: pointAnchor(e.clientX, e.clientY), items });
  };
  const element = menu ? <Menu anchor={menu.anchor} items={wrapClose(menu.items, close)} onClose={close} /> : null;
  return { open, close, element };
}
