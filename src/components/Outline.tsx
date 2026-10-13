/**
 * Bookmarks pane, editable as in PDF-XChange: add, rename, delete, drag to
 * reorder or nest, indent/outdent, set the destination to the current view,
 * bold/italic/colour, and a context menu.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight, ChevronDown, BookmarkPlus, CornerDownRight, Trash2, Crosshair, ChevronsDownUp, ChevronsUpDown, IndentIncrease,
  IndentDecrease, ArrowUp, ArrowDown, Pencil, Bold, Italic, Palette, ExternalLink,
} from 'lucide-react';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import { tf, tr, useT } from '../lib/i18n';
import {
  findNode, flatten, indentNode, insertNode, moveNode, newNodeId, outdentNode, readOutline, removeNode, shiftNode, updateNode, writeOutline,
  type OutlineNode,
} from '../lib/outline';
import { currentViewTarget } from '../store/viewActions';
import { useTextBox } from './TextBoxSelect';
import { useContextMenu, type MenuItem } from './Menu';

const S = () => useStore.getState();
const COLORS = ['#000000', '#c62828', '#ef6c00', '#2e7d32', '#1565c0', '#6a1b9a', '#757575'];

type Drop = { id: string; where: 'before' | 'after' | 'inside' } | null;

async function commit(tree: OutlineNode[], label = 'Updating bookmarks…') {
  await S().run(label, async () => S().commitBytes(await writeOutline(S().bytes!, tree)));
}

function go(n: OutlineNode) {
  if (n.page !== undefined) S().goToPage(n.page, n.y);
  else if (n.action?.startsWith('URI: ')) {
    const url = n.action.slice(5);
    if (confirm(`${tr('Open this link in a new tab?')}\n\n${url}`)) window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function Outline() {
  const t = useT();
  const bytes = useStore((s) => s.bytes);
  const canEdit = useCan('modify');
  const [tree, setTree] = useState<OutlineNode[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drop, setDrop] = useState<Drop>(null);
  const dragId = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const menu = useContextMenu();

  useEffect(() => {
    let live = true;
    if (!bytes) return;
    readOutline(bytes)
      .then((o) => {
        if (!live) return;
        setTree(o);
        // Items stored closed start collapsed.
        const closed = new Set<string>();
        const walk = (ns: OutlineNode[]) => ns.forEach((n) => (!n.open && n.children.length && closed.add(n.id), walk(n.children)));
        walk(o);
        setCollapsed((prev) => (prev.size ? prev : closed));
      })
      .catch(() => live && setTree([]));
    return () => {
      live = false;
    };
  }, [bytes]);

  if (!tree) return <div className="panel"><div className="panel-title">{t('Bookmarks')}</div><p className="muted pad">{t('Loading…')}</p></div>;

  const expanded = (n: OutlineNode) => !collapsed.has(n.id);
  const rows = flatten(tree, expanded);
  const sel = selected ? findNode(tree, selected) : undefined;

  const change = (next: OutlineNode[], keepSelection = selected) => {
    setTree(next);
    setSelected(keepSelection);
    commit(next);
  };

  /** New bookmark at the current view; titled with the selected text if there is any. */
  const add = (where: 'after' | 'inside') => {
    const target = currentViewTarget();
    const boxText = useTextBox.getState().sel?.text.split('\n')[0];
    const domText = window.getSelection()?.toString().split('\n')[0];
    const title = (boxText || domText || '').trim().slice(0, 120) || tr('Untitled');
    const node: OutlineNode = { id: newNodeId(), title, ...target, open: true, bold: false, italic: false, children: [] };
    const next = insertNode(tree, node, selected, selected ? where : 'after');
    setTree(next);
    setSelected(node.id);
    setRenaming(node.id);
    if (where === 'inside' && selected) setCollapsed((c) => new Set([...c].filter((x) => x !== selected)));
    commit(next, 'Adding bookmark…');
  };
  const remove = (id: string) => {
    const n = findNode(tree, id);
    if (n?.children.length && !confirm(tf('Delete “{title}” and its {count} sub-bookmark(s)?', { title: n.title, count: n.children.length }))) return;
    const i = rows.findIndex((r) => r.node.id === id);
    const nextSel = rows[i + 1]?.node.id ?? rows[i - 1]?.node.id ?? null;
    change(removeNode(tree, id).tree, nextSel === id ? null : nextSel);
  };
  const setDest = (id: string) => change(updateNode(tree, id, { ...currentViewTarget(), destChanged: true, action: undefined }));
  const toggle = (id: string) => setCollapsed((c) => (c.has(id) ? new Set([...c].filter((x) => x !== id)) : new Set([...c, id])));
  const setAll = (open: boolean) => {
    const all = new Set<string>();
    if (!open) flatten(tree, () => true).forEach((r) => r.node.children.length && all.add(r.node.id));
    setCollapsed(all);
  };
  const rename = (id: string, title: string) => {
    setRenaming(null);
    const n = findNode(tree, id);
    if (n && title.trim() && title !== n.title) change(updateNode(tree, id, { title: title.trim() }));
  };

  const itemMenu = (n: OutlineNode): MenuItem[] => [
    { label: 'Go to bookmark', icon: <ExternalLink size={14} />, onClick: () => go(n) },
    null,
    { label: 'Add bookmark', icon: <BookmarkPlus size={14} />, hint: 'Ctrl+B', disabled: !canEdit, onClick: () => add('after') },
    { label: 'Add child bookmark', icon: <CornerDownRight size={14} />, disabled: !canEdit, onClick: () => add('inside') },
    { label: 'Set destination to current view', icon: <Crosshair size={14} />, disabled: !canEdit, onClick: () => setDest(n.id) },
    { label: 'Rename', icon: <Pencil size={14} />, hint: 'F2', disabled: !canEdit, onClick: () => setRenaming(n.id) },
    null,
    { label: 'Bold', icon: <Bold size={14} />, checked: n.bold, disabled: !canEdit, onClick: () => change(updateNode(tree, n.id, { bold: !n.bold })) },
    { label: 'Italic', icon: <Italic size={14} />, checked: n.italic, disabled: !canEdit, onClick: () => change(updateNode(tree, n.id, { italic: !n.italic })) },
    {
      label: 'Colour', icon: <Palette size={14} />, disabled: !canEdit,
      submenu: COLORS.map((c): MenuItem => ({ label: c === '#000000' ? 'Default' : c, icon: <span className="swatch-dot" style={{ background: c }} />, checked: (n.color ?? '#000000') === c, onClick: () => change(updateNode(tree, n.id, { color: c === '#000000' ? undefined : c })) })),
    },
    null,
    { label: 'Move up', icon: <ArrowUp size={14} />, hint: 'Alt+↑', disabled: !canEdit, onClick: () => change(shiftNode(tree, n.id, -1)) },
    { label: 'Move down', icon: <ArrowDown size={14} />, hint: 'Alt+↓', disabled: !canEdit, onClick: () => change(shiftNode(tree, n.id, 1)) },
    { label: 'Indent', icon: <IndentIncrease size={14} />, hint: 'Alt+→', disabled: !canEdit, onClick: () => change(indentNode(tree, n.id)) },
    { label: 'Outdent', icon: <IndentDecrease size={14} />, hint: 'Alt+←', disabled: !canEdit, onClick: () => change(outdentNode(tree, n.id)) },
    null,
    { label: 'Expand all', icon: <ChevronsUpDown size={14} />, onClick: () => setAll(true) },
    { label: 'Collapse all', icon: <ChevronsDownUp size={14} />, onClick: () => setAll(false) },
    null,
    { label: 'Delete', icon: <Trash2 size={14} />, hint: 'Delete', disabled: !canEdit, onClick: () => remove(n.id) },
  ];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renaming || !rows.length) return;
    const i = rows.findIndex((r) => r.node.id === selected);
    const cur = rows[i]?.node;
    const pick = (j: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
      setSelected(r.node.id);
      listRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(r.node.id)}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    if (e.altKey && cur && canEdit) {
      const ops: Record<string, () => OutlineNode[]> = {
        ArrowUp: () => shiftNode(tree, cur.id, -1), ArrowDown: () => shiftNode(tree, cur.id, 1),
        ArrowRight: () => indentNode(tree, cur.id), ArrowLeft: () => outdentNode(tree, cur.id),
      };
      if (ops[e.key]) {
        e.preventDefault();
        change(ops[e.key]());
      }
      return;
    }
    if (e.key === 'ArrowDown') pick(i + 1);
    else if (e.key === 'ArrowUp') pick(i < 0 ? 0 : i - 1);
    else if (e.key === 'ArrowRight' && cur?.children.length) collapsed.has(cur.id) ? toggle(cur.id) : pick(i + 1);
    else if (e.key === 'ArrowLeft' && cur) {
      if (cur.children.length && !collapsed.has(cur.id)) toggle(cur.id);
      else {
        const depth = rows[i].depth;
        for (let j = i - 1; j >= 0; j--) if (rows[j].depth < depth) return pick(j);
      }
    } else if (e.key === 'Enter' && cur) go(cur);
    else if (e.key === 'F2' && cur && canEdit) setRenaming(cur.id);
    else if (e.key === 'Delete' && cur && canEdit) remove(cur.id);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && canEdit) add('after');
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const dropAt = (e: React.DragEvent, id: string): Drop => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const k = (e.clientY - r.top) / r.height;
    return { id, where: k < 0.28 ? 'before' : k > 0.72 ? 'after' : 'inside' };
  };

  return (
    <div className="panel">
      <div className="panel-title">{t('Bookmarks')}</div>
      <div className="panel-toolbar">
        <button title={`${t('Add bookmark')} (Ctrl+B)`} disabled={!canEdit} onClick={() => add('after')}><BookmarkPlus size={16} /></button>
        <button title={t('Add child bookmark')} disabled={!canEdit || !sel} onClick={() => add('inside')}><CornerDownRight size={16} /></button>
        <button title={t('Delete')} disabled={!canEdit || !sel} onClick={() => sel && remove(sel.id)}><Trash2 size={16} /></button>
        <button title={t('Set destination to current view')} disabled={!canEdit || !sel} onClick={() => sel && setDest(sel.id)}><Crosshair size={16} /></button>
        <button title={t('Indent')} disabled={!canEdit || !sel} onClick={() => sel && change(indentNode(tree, sel.id))}><IndentIncrease size={16} /></button>
        <button title={t('Outdent')} disabled={!canEdit || !sel} onClick={() => sel && change(outdentNode(tree, sel.id))}><IndentDecrease size={16} /></button>
        <span className="spacer" />
        <button title={t('Expand all')} onClick={() => setAll(true)}><ChevronsUpDown size={16} /></button>
        <button title={t('Collapse all')} onClick={() => setAll(false)}><ChevronsDownUp size={16} /></button>
      </div>
      {tree.length === 0 ? (
        <p className="muted pad">{t('This document has no bookmarks.')}{canEdit && <><br />{t('Use + to add one for the current view.')}</>}</p>
      ) : (
        <ul className="outline" ref={listRef} tabIndex={0} role="tree" aria-label={t('Bookmarks')} onKeyDown={onKeyDown}>
          {rows.map(({ node: n, depth }) => (
            <li
              key={n.id}
              data-id={n.id}
              role="treeitem"
              aria-selected={selected === n.id}
              aria-expanded={n.children.length ? expanded(n) : undefined}
              className={`outline-row ${selected === n.id ? 'selected' : ''} ${drop?.id === n.id ? `drop-${drop.where}` : ''}`}
              style={{ paddingLeft: 4 + depth * 14 }}
              draggable={canEdit && renaming !== n.id}
              onDragStart={(e) => {
                dragId.current = n.id;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', n.title);
              }}
              onDragOver={(e) => {
                if (!dragId.current || dragId.current === n.id) return;
                e.preventDefault();
                setDrop(dropAt(e, n.id));
              }}
              onDragLeave={() => setDrop((d) => (d?.id === n.id ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                const d = dropAt(e, n.id);
                const from = dragId.current;
                dragId.current = null;
                setDrop(null);
                if (from && d) change(moveNode(tree, from, d.id, d.where), from);
              }}
              onDragEnd={() => {
                dragId.current = null;
                setDrop(null);
              }}
              onContextMenu={(e) => {
                setSelected(n.id);
                menu.open(e, itemMenu(n));
              }}
            >
              {n.children.length ? (
                <button className="twisty" tabIndex={-1} onClick={() => toggle(n.id)}>{expanded(n) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
              ) : (
                <span className="twisty" />
              )}
              {renaming === n.id ? (
                <RenameBox value={n.title} onDone={(v) => (v === null ? setRenaming(null) : rename(n.id, v))} />
              ) : (
                <button
                  className="link outline-title"
                  tabIndex={-1}
                  title={n.action && n.page === undefined ? `${n.title} (${n.action})` : n.title}
                  style={{ fontWeight: n.bold ? 700 : undefined, fontStyle: n.italic ? 'italic' : undefined, color: n.color }}
                  onClick={() => {
                    setSelected(n.id);
                    go(n);
                    listRef.current?.focus({ preventScroll: true });
                  }}
                  onDoubleClick={() => canEdit && setRenaming(n.id)}
                >
                  {n.title || <span className="muted">{t('(untitled)')}</span>}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {menu.element}
    </div>
  );
}

function RenameBox({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (x: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(x);
  };
  return (
    <input
      ref={ref}
      className="outline-rename"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(v);
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(v)}
    />
  );
}
