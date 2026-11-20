/**
 * Repair page trees pdf-lib cannot walk. pdf.js shows such files (it is lenient), but pdf-lib
 * throws on the first page lookup: a /Pages entry that is missing or not a page tree, a /Kids
 * cycle, a page whose /Parent is not a page tree, a page without a /MediaBox anywhere. Every
 * page reachable from the catalog then goes into one flat, valid page tree, in the same order,
 * with the attributes it inherited copied onto it. Saving writes the repaired tree.
 */
import { PDFArray, PDFCatalog, PDFDict, PDFDocument, PDFName, PDFNumber, PDFPageLeaf, PDFPageTree, PDFRef, type PDFObject } from '@cantoo/pdf-lib';

const N = (s: string) => PDFName.of(s);
const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];
/** pdf.js's size for pages without one (US Letter). */
const DEFAULT_MEDIA_BOX = [0, 0, 612, 792];

function pageTreeIsSound(doc: PDFDocument): boolean {
  try {
    const pages = doc.getPages();
    if (!pages.length) return false;
    // Resolves /Parent, the inherited /MediaBox and the size, as every editing step does.
    for (const p of pages) {
      p.getCropBox();
      p.getRotation();
    }
    return true;
  } catch {
    return false;
  }
}

const isBox = (o: PDFObject | undefined): o is PDFArray =>
  o instanceof PDFArray && o.size() === 4 && o.asArray().every((n) => n instanceof PDFNumber || n instanceof PDFRef);

/** The pages under the catalog's /Pages, depth first, with what each inherits. Visits every node once. */
function collectPages(doc: PDFDocument): { ref: PDFRef; dict: PDFDict; inherited: Map<string, PDFObject> }[] {
  const ctx = doc.context;
  const out: { ref: PDFRef; dict: PDFDict; inherited: Map<string, PDFObject> }[] = [];
  const seen = new Set<string>();
  const walk = (obj: PDFObject | undefined, inherited: Map<string, PDFObject>, depth: number) => {
    if (!(obj instanceof PDFRef) || seen.has(obj.toString()) || depth > 64) return;
    seen.add(obj.toString());
    const dict = ctx.lookup(obj);
    if (!(dict instanceof PDFDict)) return;
    const type = dict.get(N('Type'));
    const kids = dict.lookup(N('Kids'));
    if (type === N('Page') || (!(kids instanceof PDFArray) && type !== N('Pages') && (dict.has(N('Contents')) || dict.has(N('MediaBox'))))) {
      out.push({ ref: obj, dict, inherited });
      return;
    }
    if (!(kids instanceof PDFArray)) return;
    const next = new Map(inherited);
    for (const key of INHERITABLE) {
      const v = dict.get(N(key));
      if (v !== undefined) next.set(key, v);
    }
    for (const kid of kids.asArray()) walk(kid, next, depth + 1);
  };
  const root = doc.catalog.get(N('Pages'));
  if (root instanceof PDFRef) walk(root, new Map(), 0);
  else if (root instanceof PDFDict) {
    // A direct page tree: give it a reference so it can be walked like the others.
    walk(ctx.register(root), new Map(), 0);
  }
  return out;
}

/** Every /Type /Page object in the file, by object number (when the catalog leads to none). */
function scanPages(doc: PDFDocument) {
  return doc.context
    .enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFDict && o.get(N('Type')) === N('Page'))
    .sort(([a], [b]) => a.objectNumber - b.objectNumber || a.generationNumber - b.generationNumber)
    .map(([ref, dict]) => ({ ref, dict: dict as PDFDict, inherited: new Map<string, PDFObject>() }));
}

/** Repair the page tree if pdf-lib cannot use it. Returns whether it was broken and is now usable. */
export function repairPageTree(doc: PDFDocument): boolean {
  if (pageTreeIsSound(doc)) return false;
  try {
    return rebuild(doc);
  } catch {
    return false;
  }
}

function rebuild(doc: PDFDocument): boolean {
  const ctx = doc.context;
  // A catalog without /Type /Catalog is read as a plain dictionary, without the catalog's methods.
  const rootRef = ctx.trailerInfo.Root;
  const root = rootRef instanceof PDFRef ? ctx.lookup(rootRef) : undefined;
  if (!(doc.catalog instanceof PDFCatalog)) {
    if (!(root instanceof PDFDict)) return false;
    const catalog = PDFCatalog.fromMapWithContext(new Map(root.entries()), ctx);
    catalog.set(N('Type'), N('Catalog'));
    ctx.assign(rootRef as PDFRef, catalog);
    (doc as unknown as { catalog: PDFCatalog }).catalog = catalog;
  }
  let pages = collectPages(doc);
  if (!pages.length) pages = scanPages(doc);
  if (!pages.length) return false;

  const tree = PDFPageTree.withContext(ctx);
  const treeRef = ctx.register(tree);
  const placed = new Set<string>();
  for (const { ref, dict, inherited } of pages) {
    // A page listed twice keeps its first place (pdf-lib would otherwise draw it twice).
    if (placed.has(ref.toString())) continue;
    placed.add(ref.toString());
    const leaf = dict instanceof PDFPageLeaf ? dict : PDFPageLeaf.fromMapWithContext(new Map(dict.entries()), ctx);
    for (const key of INHERITABLE) {
      if (!leaf.has(N(key)) && inherited.has(key)) leaf.set(N(key), inherited.get(key)!);
    }
    leaf.set(N('Type'), N('Page'));
    if (!isBox(leaf.lookup(N('MediaBox')))) leaf.set(N('MediaBox'), ctx.obj(DEFAULT_MEDIA_BOX));
    if (!(leaf.lookup(N('Resources')) instanceof PDFDict)) leaf.set(N('Resources'), ctx.obj({}));
    leaf.set(N('Parent'), treeRef);
    if (leaf !== dict) ctx.assign(ref, leaf);
    tree.pushLeafNode(ref);
  }
  doc.catalog.set(N('Pages'), treeRef);
  // pdf-lib caches the page list: start over with the new tree.
  (doc as unknown as { pageCache: { invalidate(): void } }).pageCache.invalidate();
  (doc as unknown as { pageMap: Map<unknown, unknown> }).pageMap.clear();
  return pageTreeIsSound(doc);
}

/** Load a document for editing, its page tree repaired if pdf-lib could not use it. */
export async function loadForEdit(bytes: Uint8Array, opts: { password?: string } = {}): Promise<PDFDocument> {
  const doc = await PDFDocument.load(bytes, { ...opts, updateMetadata: false });
  if (!repairPageTree(doc) && !pageTreeIsSound(doc)) {
    // No page pdf-lib can use (objects it cannot decode, no page objects at all): the app
    // opens the file read-only instead of failing at every edit.
    throw new Error('The pages of this file cannot be read for editing.');
  }
  return doc;
}
