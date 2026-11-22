/**
 * Annotations in tagged PDF (PDF/UA, PDF/A-a): every annotation except popups needs an
 * /Annot structure element that holds it through an object reference, and a
 * /StructParent key that leads back to that element through the parent tree.
 */
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, type PDFContext, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib';

const N = (s: string) => PDFName.of(s);

function structRoot(doc: PDFDocument): PDFDict | undefined {
  const r = doc.catalog.lookup(N('StructTreeRoot'));
  return r instanceof PDFDict ? r : undefined;
}

/** The leaves (/Nums arrays) of a number tree. */
function numsArrays(ctx: PDFContext, node: PDFDict, depth = 0, out: PDFArray[] = []): PDFArray[] {
  if (depth > 32) return out;
  const nums = node.lookup(N('Nums'));
  if (nums instanceof PDFArray) out.push(nums);
  const kids = node.lookup(N('Kids'));
  if (kids instanceof PDFArray) for (const k of kids.asArray()) {
    const kid = ctx.lookup(k);
    if (kid instanceof PDFDict) numsArrays(ctx, kid, depth + 1, out);
  }
  return out;
}

function parentTree(doc: PDFDocument, root: PDFDict): PDFDict {
  let tree = root.lookup(N('ParentTree'));
  if (!(tree instanceof PDFDict)) {
    tree = doc.context.obj({ Nums: [] });
    root.set(N('ParentTree'), doc.context.register(tree as PDFDict));
  }
  return tree as PDFDict;
}

/** The next free parent-tree key (ParentTreeNextKey, or one past the largest key used). */
function nextKey(doc: PDFDocument, root: PDFDict, tree: PDFDict): number {
  let next = (root.lookup(N('ParentTreeNextKey')) as PDFNumber | undefined)?.asNumber() ?? 0;
  for (const nums of numsArrays(doc.context, tree)) {
    for (let i = 0; i < nums.size(); i += 2) {
      const k = nums.lookup(i);
      if (k instanceof PDFNumber) next = Math.max(next, k.asNumber() + 1);
    }
  }
  return next;
}

/** Tag a new annotation in a tagged document; does nothing in untagged ones. */
export function tagAnnotation(doc: PDFDocument, pageRef: PDFRef, annotRef: PDFRef, alt?: string): void {
  const root = structRoot(doc);
  if (!root) return;
  const ctx = doc.context;
  const annot = ctx.lookup(annotRef);
  if (!(annot instanceof PDFDict)) return;
  // The elements go into the document element when there is one, as Acrobat does.
  let parent: PDFDict = root;
  let parentRef: PDFObject | undefined = doc.catalog.get(N('StructTreeRoot'));
  const kEntry = root.get(N('K'));
  const only = kEntry instanceof PDFArray ? (kEntry.size() === 1 ? kEntry.get(0) : undefined) : kEntry;
  const onlyDict = only instanceof PDFRef ? ctx.lookup(only) : undefined;
  if (onlyDict instanceof PDFDict && onlyDict.has(N('S'))) {
    parent = onlyDict;
    parentRef = only;
  }
  if (!(parentRef instanceof PDFRef)) return;
  const elem = ctx.obj({ Type: 'StructElem', S: 'Annot', P: parentRef, Pg: pageRef, K: { Type: 'OBJR', Obj: annotRef, Pg: pageRef } });
  if (alt) elem.set(N('Alt'), PDFHexString.fromText(alt));
  const elemRef = ctx.register(elem);
  const kids = parent.lookup(N('K'));
  if (kids instanceof PDFArray) kids.push(elemRef);
  else parent.set(N('K'), ctx.obj(kids === undefined ? [elemRef] : [parent.get(N('K'))!, elemRef]));
  const tree = parentTree(doc, root);
  const key = nextKey(doc, root, tree);
  const leaves = numsArrays(ctx, tree);
  if (leaves.length && tree.has(N('Nums'))) leaves[0].push(PDFNumber.of(key)), leaves[0].push(elemRef);
  else {
    // A tree of kids: one more leaf for this key.
    let treeKids = tree.lookup(N('Kids'));
    if (!(treeKids instanceof PDFArray)) tree.set(N('Kids'), (treeKids = ctx.obj([])));
    (treeKids as PDFArray).push(ctx.register(ctx.obj({ Limits: [key, key], Nums: [key, elemRef] })));
  }
  root.set(N('ParentTreeNextKey'), PDFNumber.of(key + 1));
  annot.set(N('StructParent'), PDFNumber.of(key));
}

/**
 * Remove the structure of annotations that leave the file (moved into the model on open):
 * their OBJR entries, the /Annot elements left empty, and their parent-tree entries.
 */
export function untagAnnotations(doc: PDFDocument, removed: PDFRef[]): void {
  const root = structRoot(doc);
  if (!root || !removed.length) return;
  const ctx = doc.context;
  const gone = new Set(removed.map((r) => r.toString()));
  const keys = new Set<number>();
  for (const r of removed) {
    const d = ctx.lookup(r);
    const sp = d instanceof PDFDict ? d.lookup(N('StructParent')) : undefined;
    if (sp instanceof PDFNumber) keys.add(sp.asNumber());
  }
  const isGoneObjr = (o: PDFObject | undefined): boolean => {
    const d = o instanceof PDFRef ? ctx.lookup(o) : o;
    if (!(d instanceof PDFDict) || d.lookup(N('Type'))?.toString() !== '/OBJR') return false;
    const obj = d.get(N('Obj'));
    return obj instanceof PDFRef && gone.has(obj.toString());
  };
  const seen = new Set<PDFDict>();
  /** Clean an element's /K; true when the element held nothing but gone annotations. */
  const clean = (elem: PDFDict, depth: number): boolean => {
    if (seen.has(elem) || depth > 256) return false;
    seen.add(elem);
    const k = elem.lookup(N('K'));
    const items = k instanceof PDFArray ? k.asArray() : k === undefined ? [] : [elem.get(N('K'))!];
    if (!items.length) return false;
    const kept = items.filter((it) => {
      if (isGoneObjr(it)) return false;
      const child = it instanceof PDFRef ? ctx.lookup(it) : it;
      if (child instanceof PDFDict && child.has(N('S')) && clean(child, depth + 1)) return false;
      return true;
    });
    if (kept.length === items.length) return false;
    if (!kept.length) {
      elem.delete(N('K'));
      return elem.lookup(N('S'))?.toString() === '/Annot';
    }
    elem.set(N('K'), kept.length === 1 && !(k instanceof PDFArray) ? kept[0] : ctx.obj(kept));
    return false;
  };
  clean(root, 0);
  if (!keys.size) return;
  const tree = root.lookup(N('ParentTree'));
  if (!(tree instanceof PDFDict)) return;
  for (const nums of numsArrays(ctx, tree)) {
    for (let i = nums.size() - 2; i >= 0; i -= 2) {
      const key = nums.lookup(i);
      if (key instanceof PDFNumber && keys.has(key.asNumber())) {
        nums.remove(i + 1);
        nums.remove(i);
      }
    }
  }
}
