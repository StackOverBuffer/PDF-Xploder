/**
 * The document outline (bookmarks) as an editable tree. Writing rebuilds the
 * /Outlines structure; items that already existed keep their dictionary, so
 * actions, named destinations and styles survive unless changed.
 */
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRef, PDFString, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib';
import { load } from './pdfOps';

export interface OutlineNode {
  /** Reference of the existing item ("12 0 R"), or a temporary id for new ones. */
  id: string;
  title: string;
  /** Target page (0-based) and top, when the destination is a page in this document. */
  page?: number;
  y?: number;
  /** The item does something other than going to a page (named destination, URL, JavaScript…). */
  action?: string;
  open: boolean;
  bold: boolean;
  italic: boolean;
  /** "#rrggbb", or undefined for the default (black). */
  color?: string;
  children: OutlineNode[];
  /** Set when the destination was changed in the editor. */
  destChanged?: boolean;
}

const text = (o: PDFObject | undefined) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '');
const num = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : undefined);

function pageIndex(doc: PDFDocument, ref: PDFObject | undefined): number | undefined {
  if (!(ref instanceof PDFRef)) return num(ref);
  const i = doc.getPages().findIndex((p) => p.ref.toString() === ref.toString());
  return i >= 0 ? i : undefined;
}

/** Resolve a destination (array, name or string) to page and top. */
function resolveDest(doc: PDFDocument, dest: PDFObject | undefined, depth = 0): { page?: number; y?: number; named?: string } {
  if (!dest || depth > 4) return {};
  if (dest instanceof PDFArray) {
    const page = pageIndex(doc, dest.get(0));
    const kind = dest.lookup(1);
    const y = kind instanceof PDFName && kind.decodeText() === 'XYZ' ? num(dest.lookup(3)) : kind instanceof PDFName && kind.decodeText() === 'FitH' ? num(dest.lookup(2)) : undefined;
    return { page, y };
  }
  if (dest instanceof PDFDict) return resolveDest(doc, dest.lookup(PDFName.of('D')), depth + 1);
  const name = dest instanceof PDFName ? dest.decodeText() : text(dest);
  if (!name) return {};
  // Named destinations: the old /Dests dictionary or the /Names /Dests tree.
  const old = doc.catalog.lookup(PDFName.of('Dests'));
  if (old instanceof PDFDict) {
    const d = old.lookup(PDFName.of(name));
    if (d) return { ...resolveDest(doc, d, depth + 1), named: name };
  }
  const names = doc.catalog.lookup(PDFName.of('Names'));
  const tree = names instanceof PDFDict ? names.lookup(PDFName.of('Dests')) : undefined;
  const found = tree instanceof PDFDict ? lookupNameTree(tree, name) : undefined;
  return { ...resolveDest(doc, found, depth + 1), named: name };
}

function lookupNameTree(node: PDFDict, key: string, depth = 0): PDFObject | undefined {
  if (depth > 32) return undefined;
  const names = node.lookup(PDFName.of('Names'));
  if (names instanceof PDFArray) for (let i = 0; i + 1 < names.size(); i += 2) if (text(names.lookup(i)) === key) return names.lookup(i + 1);
  const kids = node.lookup(PDFName.of('Kids'));
  if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) {
    const r = lookupNameTree(kids.lookup(i) as PDFDict, key, depth + 1);
    if (r) return r;
  }
  return undefined;
}

function readItem(doc: PDFDocument, ref: PDFRef, seen: Set<string>): OutlineNode | null {
  if (seen.has(ref.toString())) return null;
  seen.add(ref.toString());
  const d = doc.context.lookup(ref);
  if (!(d instanceof PDFDict)) return null;
  const node: OutlineNode = { id: ref.toString(), title: text(d.lookup(PDFName.of('Title'))), open: (num(d.lookup(PDFName.of('Count'))) ?? 0) > 0, bold: false, italic: false, children: [] };
  const f = num(d.lookup(PDFName.of('F'))) ?? 0;
  node.italic = !!(f & 1);
  node.bold = !!(f & 2);
  const c = d.lookup(PDFName.of('C'));
  if (c instanceof PDFArray && c.size() === 3) {
    const hex = [0, 1, 2].map((i) => Math.round(Math.max(0, Math.min(1, num(c.lookup(i)) ?? 0)) * 255).toString(16).padStart(2, '0')).join('');
    if (hex !== '000000') node.color = `#${hex}`;
  }
  const dest = d.lookup(PDFName.of('Dest'));
  const action = d.lookup(PDFName.of('A'));
  if (dest) {
    const r = resolveDest(doc, dest);
    node.page = r.page;
    node.y = r.y;
  } else if (action instanceof PDFDict) {
    const s = action.lookup(PDFName.of('S'));
    const kind = s instanceof PDFName ? s.decodeText() : '';
    if (kind === 'GoTo') {
      const r = resolveDest(doc, action.lookup(PDFName.of('D')));
      node.page = r.page;
      node.y = r.y;
    } else {
      node.action = kind === 'URI' ? `URI: ${text(action.lookup(PDFName.of('URI')))}` : kind;
    }
  }
  node.children = readChildren(doc, d, seen);
  return node;
}

function readChildren(doc: PDFDocument, parent: PDFDict, seen: Set<string>): OutlineNode[] {
  const out: OutlineNode[] = [];
  let ref = parent.get(PDFName.of('First'));
  while (ref instanceof PDFRef && out.length < 100000) {
    const node = readItem(doc, ref, seen);
    if (!node) break;
    out.push(node);
    ref = (doc.context.lookup(ref) as PDFDict).get(PDFName.of('Next'));
  }
  return out;
}

export function outlineOf(doc: PDFDocument): OutlineNode[] {
  const root = doc.catalog.lookup(PDFName.of('Outlines'));
  return root instanceof PDFDict ? readChildren(doc, root, new Set()) : [];
}

export async function readOutline(bytes: Uint8Array): Promise<OutlineNode[]> {
  return outlineOf(await load(bytes));
}

/** All item references in a tree, for finding removed items. */
function ids(nodes: OutlineNode[], out = new Set<string>()): Set<string> {
  for (const n of nodes) {
    out.add(n.id);
    ids(n.children, out);
  }
  return out;
}

function visibleCount(nodes: OutlineNode[]): number {
  return nodes.reduce((n, c) => n + 1 + (c.open ? visibleCount(c.children) : 0), 0);
}

/** Replace the document's outline with `nodes`. */
export function setOutline(doc: PDFDocument, nodes: OutlineNode[]) {
  const ctx = doc.context;
  const before = ids(outlineOf(doc));
  const keep = ids(nodes);
  // Drop the dictionaries of removed items.
  for (const id of before) if (!keep.has(id)) {
    const m = /^(\d+) (\d+) R$/.exec(id);
    if (m) ctx.delete(PDFRef.of(Number(m[1]), Number(m[2])));
  }
  let rootRef = doc.catalog.get(PDFName.of('Outlines'));
  if (!nodes.length) {
    if (rootRef instanceof PDFRef) ctx.delete(rootRef);
    doc.catalog.delete(PDFName.of('Outlines'));
    return;
  }
  if (!(rootRef instanceof PDFRef) || !(ctx.lookup(rootRef) instanceof PDFDict)) {
    rootRef = ctx.register(ctx.obj({ Type: 'Outlines' }));
    doc.catalog.set(PDFName.of('Outlines'), rootRef);
  }
  const root = ctx.lookup(rootRef) as PDFDict;
  const pages = doc.getPages();
  const link = (parentRef: PDFRef, parent: PDFDict, list: OutlineNode[]) => {
    for (const k of ['First', 'Last']) parent.delete(PDFName.of(k));
    const refs = list.map((n) => {
      const existing = /^(\d+) (\d+) R$/.exec(n.id) ? ctx.lookup(PDFRef.of(Number(n.id.split(' ')[0]), Number(n.id.split(' ')[1]))) : undefined;
      if (existing instanceof PDFDict) return PDFRef.of(Number(n.id.split(' ')[0]), Number(n.id.split(' ')[1]));
      return ctx.register(ctx.obj({}));
    });
    list.forEach((n, i) => {
      const d = ctx.lookup(refs[i]) as PDFDict;
      for (const k of ['Parent', 'Prev', 'Next', 'First', 'Last', 'Count']) d.delete(PDFName.of(k));
      d.set(PDFName.of('Title'), PDFHexString.fromText(n.title));
      d.set(PDFName.of('Parent'), parentRef);
      if (i > 0) d.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < list.length - 1) d.set(PDFName.of('Next'), refs[i + 1]);
      const f = (n.italic ? 1 : 0) | (n.bold ? 2 : 0);
      if (f) d.set(PDFName.of('F'), PDFNumber.of(f));
      else d.delete(PDFName.of('F'));
      if (n.color) {
        const v = [1, 3, 5].map((k) => parseInt(n.color!.slice(k, k + 2), 16) / 255);
        d.set(PDFName.of('C'), ctx.obj(v));
      } else d.delete(PDFName.of('C'));
      const isNew = !(/^(\d+) (\d+) R$/.exec(n.id));
      if ((isNew || n.destChanged) && n.page !== undefined && pages[n.page]) {
        d.delete(PDFName.of('A'));
        d.set(PDFName.of('Dest'), ctx.obj([pages[n.page].ref, PDFName.of('XYZ'), PDFNull, n.y === undefined ? PDFNull : PDFNumber.of(n.y), PDFNull]));
      }
      if (n.children.length) {
        link(refs[i], d, n.children);
        const count = visibleCount(n.children);
        d.set(PDFName.of('Count'), PDFNumber.of(n.open ? count : -count));
      }
    });
    if (refs.length) {
      parent.set(PDFName.of('First'), refs[0]);
      parent.set(PDFName.of('Last'), refs[refs.length - 1]);
    }
  };
  link(rootRef as PDFRef, root, nodes);
  root.set(PDFName.of('Count'), PDFNumber.of(visibleCount(nodes)));
  // Viewers should show the bookmarks pane for documents that have bookmarks.
  if (!doc.catalog.has(PDFName.of('PageMode'))) doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

export async function writeOutline(bytes: Uint8Array, nodes: OutlineNode[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  setOutline(doc, nodes);
  return doc.save({ useObjectStreams: true });
}

// ---------------------------------------------------------------- tree helpers

let tmp = 0;
export const newNodeId = () => `new-${Date.now().toString(36)}-${(tmp++).toString(36)}`;

/** Path of indices to a node. */
export function findPath(nodes: OutlineNode[], id: string, path: number[] = []): number[] | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return [...path, i];
    const p = findPath(nodes[i].children, id, [...path, i]);
    if (p) return p;
  }
  return null;
}

export function findNode(nodes: OutlineNode[], id: string): OutlineNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const c = findNode(n.children, id);
    if (c) return c;
  }
  return undefined;
}

/** A copy of the tree with node `id` changed. */
export function updateNode(nodes: OutlineNode[], id: string, patch: Partial<OutlineNode>): OutlineNode[] {
  return nodes.map((n) => (n.id === id ? { ...n, ...patch } : n.children.length ? { ...n, children: updateNode(n.children, id, patch) } : n));
}

export function removeNode(nodes: OutlineNode[], id: string): { tree: OutlineNode[]; node?: OutlineNode } {
  let node: OutlineNode | undefined;
  const walk = (list: OutlineNode[]): OutlineNode[] =>
    list.flatMap((n) => {
      if (n.id === id) {
        node = n;
        return [];
      }
      return n.children.length ? [{ ...n, children: walk(n.children) }] : [n];
    });
  return { tree: walk(nodes), node };
}

/** Insert `node` before/after `target`, or as its last child. Without a target it goes to the end. */
export function insertNode(nodes: OutlineNode[], node: OutlineNode, target: string | null, where: 'before' | 'after' | 'inside'): OutlineNode[] {
  if (!target) return [...nodes, node];
  const walk = (list: OutlineNode[]): OutlineNode[] =>
    list.flatMap((n) => {
      if (n.id === target) {
        if (where === 'before') return [node, n];
        if (where === 'after') return [n, node];
        return [{ ...n, open: true, children: [...n.children, node] }];
      }
      return n.children.length ? [{ ...n, children: walk(n.children) }] : [n];
    });
  return walk(nodes);
}

/** Move a node; refuses to move a node into its own subtree. */
export function moveNode(nodes: OutlineNode[], id: string, target: string, where: 'before' | 'after' | 'inside'): OutlineNode[] {
  if (id === target) return nodes;
  const { tree, node } = removeNode(nodes, id);
  if (!node || findNode(node.children, target)) return nodes;
  return insertNode(tree, node, target, where);
}

/** Make a node the last child of its previous sibling. */
export function indentNode(nodes: OutlineNode[], id: string): OutlineNode[] {
  const path = findPath(nodes, id);
  if (!path || path[path.length - 1] === 0) return nodes;
  const siblings = path.length === 1 ? nodes : (nodeAt(nodes, path.slice(0, -1))!.children);
  const prev = siblings[path[path.length - 1] - 1];
  return moveNode(nodes, id, prev.id, 'inside');
}

/** Make a node the next sibling of its parent. */
export function outdentNode(nodes: OutlineNode[], id: string): OutlineNode[] {
  const path = findPath(nodes, id);
  if (!path || path.length < 2) return nodes;
  const parent = nodeAt(nodes, path.slice(0, -1))!;
  return moveNode(nodes, id, parent.id, 'after');
}

/** Move a node one step up or down among its siblings. */
export function shiftNode(nodes: OutlineNode[], id: string, dir: -1 | 1): OutlineNode[] {
  const path = findPath(nodes, id);
  if (!path) return nodes;
  const i = path[path.length - 1];
  const siblings = path.length === 1 ? nodes : nodeAt(nodes, path.slice(0, -1))!.children;
  const j = i + dir;
  if (j < 0 || j >= siblings.length) return nodes;
  return moveNode(nodes, id, siblings[j].id, dir < 0 ? 'before' : 'after');
}

function nodeAt(nodes: OutlineNode[], path: number[]): OutlineNode | undefined {
  let list = nodes;
  let n: OutlineNode | undefined;
  for (const i of path) {
    n = list[i];
    if (!n) return undefined;
    list = n.children;
  }
  return n;
}

/** Depth-first list of nodes (for keyboard navigation), honouring collapsed items. */
export function flatten(nodes: OutlineNode[], expanded: (n: OutlineNode) => boolean, depth = 0, out: { node: OutlineNode; depth: number }[] = []) {
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.children.length && expanded(n)) flatten(n.children, expanded, depth + 1, out);
  }
  return out;
}
