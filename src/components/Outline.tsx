import { useEffect, useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { useStore } from '../store/store';
import { resolveDest } from '../lib/pdfjs';

interface Node {
  title: string;
  dest: unknown;
  items: Node[];
}

function Item({ node, depth }: { node: Node; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const go = async () => {
    const { pdf, goToPage } = useStore.getState();
    if (!pdf) return;
    const r = await resolveDest(pdf, node.dest);
    if (r) goToPage(r.page, r.y);
  };
  return (
    <li>
      <div className="outline-row" style={{ paddingLeft: depth * 14 }}>
        {node.items.length ? (
          <button className="twisty" onClick={() => setOpen(!open)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
        ) : (
          <span className="twisty" />
        )}
        <button className="link" onClick={go} title={node.title}>{node.title}</button>
      </div>
      {open && node.items.length > 0 && (
        <ul>
          {node.items.map((c, i) => <Item key={i} node={c} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

export function Outline() {
  const pdf = useStore((s) => s.pdf);
  const [items, setItems] = useState<Node[] | null>(null);
  useEffect(() => {
    let live = true;
    setItems(null);
    pdf?.getOutline().then((o) => live && setItems((o as Node[] | null) ?? [])).catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [pdf]);
  return (
    <div className="panel">
      <div className="panel-title">Bookmarks</div>
      {items === null ? <p className="muted pad">Loading…</p> : items.length === 0 ? <p className="muted pad">This document has no bookmarks.</p> : (
        <ul className="outline">{items.map((n, i) => <Item key={i} node={n} depth={0} />)}</ul>
      )}
    </div>
  );
}
