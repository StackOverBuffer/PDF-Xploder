/**
 * Copying pages between documents (or within one) without taking other pages along.
 *
 * pdf-lib's copier follows every reference of a page: a link's destination, a form
 * widget's field and that field's other widgets each lead to further pages, which were
 * then copied in full as hidden objects — extracting page 1 of a document with a table
 * of contents shipped the text of every page it linked to. Here the copier is told up
 * front where every page of the source goes: pages that are copied to their copies,
 * pages that are not to a marker (another document) or to themselves (the same one).
 * Afterwards everything that still points at a page that was left behind is cut, the
 * fields of the copied widgets are registered in the target's form, and annotation
 * names are kept unique.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFObjectCopier,
  PDFPage,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFObject,
  type PDFPageLeaf,
} from '@cantoo/pdf-lib';

/** The object if it has the expected type: broken files never make these lookups throw. */
const dictOf = (o: unknown) => (o instanceof PDFDict ? o : undefined);


const N = (s: string) => PDFName.of(s);

function text(o: unknown): string | undefined {
  return o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : undefined;
}

function nameTreeLookup(node: PDFDict | undefined, key: string, depth = 0): PDFObject | undefined {
  if (!node || depth > 32) return undefined;
  const names = node.lookup(N('Names'));
  if (names instanceof PDFArray) {
    for (let k = 0; k + 1 < names.size(); k += 2) if (text(names.lookup(k)) === key) return names.lookup(k + 1);
  }
  const kids = node.lookup(N('Kids'));
  if (kids instanceof PDFArray) {
    for (let k = 0; k < kids.size(); k++) {
      const hit = nameTreeLookup(dictOf(kids.lookup(k)), key, depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** A named destination of `doc` as its explicit array (or undefined). */
export function resolveNamedDest(doc: PDFDocument, name: PDFObject): PDFArray | undefined {
  let d: PDFObject | undefined;
  if (name instanceof PDFName) d = dictOf(doc.catalog.lookup(N('Dests')))?.lookup(name);
  else if (name instanceof PDFString || name instanceof PDFHexString) {
    d = nameTreeLookup(dictOf(dictOf(doc.catalog.lookup(N('Names')))?.lookup(N('Dests'))), name.decodeText());
  }
  if (d instanceof PDFRef) d = doc.context.lookup(d);
  if (d instanceof PDFDict) d = d.lookup(N('D'));
  return d instanceof PDFArray ? d : undefined;
}

interface Env {
  src: PDFDocument;
  dest: PDFDocument;
  same: boolean;
  /** Stands for "a page that was not copied" (never assigned in the target). */
  dead: PDFRef;
  copier: PDFObjectCopier;
}

const isDead = (o: PDFObject | undefined, env: Env) => o instanceof PDFRef && o === env.dead;

/**
 * A copied destination (explicit array or a name of the source), made to work in the
 * target: the explicit array when it points at a page that is there, otherwise undefined.
 */
function fixDest(d: PDFObject | undefined, env: Env): PDFObject | undefined {
  if (d === undefined) return undefined;
  const ctx = env.dest.context;
  let arr = d instanceof PDFRef ? ctx.lookup(d) : d;
  if (arr instanceof PDFDict) arr = arr.lookup(N('D'));
  if (arr instanceof PDFName || arr instanceof PDFString || arr instanceof PDFHexString) {
    // Within one document its names keep working; another document has none of them.
    if (env.same) return d;
    const resolved = resolveNamedDest(env.src, arr);
    return resolved ? fixDest(env.copier.copy(resolved), env) : undefined;
  }
  if (!(arr instanceof PDFArray) || !arr.size()) return undefined;
  const target = arr.get(0);
  if (target instanceof PDFRef) return isDead(target, env) || !ctx.lookup(target) ? undefined : arr;
  return arr; // a page number (remote destinations); left as it is
}

/** Point a copied annotation's links at the copied pages; false when its link went nowhere. */
function fixActions(annot: PDFDict, env: Env): boolean {
  let ok = true;
  if (annot.has(N('Dest'))) {
    const d = fixDest(annot.get(N('Dest')), env);
    if (d) annot.set(N('Dest'), d);
    else {
      annot.delete(N('Dest'));
      ok = false;
    }
  }
  const action = dictOf(annot.lookup(N('A')));
  if (action && action.lookup(N('S'))?.toString() === '/GoTo') {
    const d = fixDest(action.get(N('D')), env);
    if (d) action.set(N('D'), d);
    else {
      annot.delete(N('A'));
      ok = false;
    }
  }
  return ok;
}

/** Replace every remaining reference to a page that was left behind (beads, struct refs…). */
function sweepDead(root: PDFObject, env: Env) {
  const seen = new Set<PDFObject>();
  const ctx = env.dest.context;
  const stack: PDFObject[] = [root];
  while (stack.length) {
    let o = stack.pop()!;
    if (o instanceof PDFRef) {
      if (o === env.dead) continue;
      const v = ctx.lookup(o);
      // Pages are handled on their own: do not wander through the page tree.
      if (!v || (v instanceof PDFDict && v.get(N('Type'))?.toString() === '/Page' && v !== root)) continue;
      o = v;
    }
    if (seen.has(o)) continue;
    seen.add(o);
    if (o instanceof PDFStream) o = o.dict;
    if (o instanceof PDFDict) {
      for (const [k, v] of o.entries()) {
        if (isDead(v, env)) o.delete(k);
        else if (k !== N('Parent')) stack.push(v);
      }
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) {
        const v = o.get(i);
        if (isDead(v, env)) o.set(i, PDFNull);
        else stack.push(v);
      }
    }
  }
}

/** The form dictionary of `doc`, created when it has none. */
function acroForm(doc: PDFDocument): PDFDict {
  const existing = dictOf(doc.catalog.lookup(N('AcroForm')));
  if (existing) return existing;
  const form = doc.context.obj({ Fields: [] }) as PDFDict;
  doc.catalog.set(N('AcroForm'), doc.context.register(form));
  return form;
}

function fieldsArray(form: PDFDict, doc: PDFDocument): PDFArray {
  const f = form.lookup(N('Fields'));
  if (f instanceof PDFArray) return f;
  const arr = doc.context.obj([]) as PDFArray;
  form.set(N('Fields'), arr);
  return arr;
}

/**
 * Keep only the parts of a copied field tree that lead to a widget on a copied page.
 * Returns false when nothing of `field` is left.
 */
function pruneField(field: PDFDict, keep: Set<PDFDict>, ctx: PDFDocument['context'], depth = 0): boolean {
  if (keep.has(field)) return true;
  const kids = field.lookup(N('Kids'));
  if (!(kids instanceof PDFArray) || depth > 32) return false;
  const kept: PDFObject[] = [];
  for (const k of kids.asArray()) {
    const kid = ctx.lookup(k);
    if (kid instanceof PDFDict && pruneField(kid, keep, ctx, depth + 1)) kept.push(k);
  }
  field.set(N('Kids'), ctx.obj(kept));
  return kept.length > 0;
}

/** The top of a field tree (following /Parent), with a guard against loops. */
function fieldRoot(widget: PDFDict, ctx: PDFDocument['context']): { dict: PDFDict; ref?: PDFRef } {
  let dict = widget;
  let ref: PDFRef | undefined;
  for (let i = 0; i < 32; i++) {
    const p = dict.get(N('Parent'));
    if (!(p instanceof PDFRef)) break;
    const parent = ctx.lookup(p);
    if (!(parent instanceof PDFDict)) break;
    dict = parent;
    ref = p;
  }
  return { dict, ref };
}

/** Register the fields of the copied widgets in the target's form, renaming on a name clash. */
function registerFields(pages: PDFPage[], env: Env) {
  const ctx = env.dest.context;
  const widgets = new Set<PDFDict>();
  const widgetRefs = new Map<PDFDict, PDFRef>();
  for (const page of pages) {
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      const a = ctx.lookup(ref);
      if (a instanceof PDFDict && a.get(N('Subtype'))?.toString() === '/Widget') {
        widgets.add(a);
        if (ref instanceof PDFRef) widgetRefs.set(a, ref);
      }
    }
  }
  if (!widgets.size) return;
  const form = acroForm(env.dest);
  // The form gains fields: XFA data (kept while a form is untouched, see loadForEdit)
  // would no longer describe it.
  form.delete(N('XFA'));
  form.delete(N('NeedsRendering'));
  const fields = fieldsArray(form, env.dest);
  const present = new Set(fields.asArray().map((r) => r.toString()));
  const names = new Set(fields.asArray().map((r) => text(dictOf(ctx.lookup(r))?.lookup(N('T')))).filter((t): t is string => !!t));
  const roots = new Map<string, { dict: PDFDict; ref: PDFRef }>();
  for (const w of widgets) {
    const root = fieldRoot(w, ctx);
    const ref = root.ref ?? widgetRefs.get(w);
    if (!ref || !root.dict.has(N('T')) && root.dict === w && !root.dict.has(N('FT'))) continue; // a widget without a field
    roots.set(ref.toString(), { dict: root.dict, ref });
  }
  for (const { dict, ref } of roots.values()) {
    pruneField(dict, widgets, ctx);
    if (present.has(ref.toString())) continue;
    // Two fields with one name would share one value in other programs (and clash in type).
    const t = text(dict.lookup(N('T')));
    if (t !== undefined && names.has(t)) {
      let n = 2;
      while (names.has(`${t}_${n}`)) n++;
      dict.set(N('T'), PDFHexString.fromText(`${t}_${n}`));
      names.add(`${t}_${n}`);
    } else if (t !== undefined) names.add(t);
    fields.push(ref);
    present.add(ref.toString());
  }
  // The appearance defaults the copied fields rely on.
  if (!env.same) {
    const srcForm = dictOf(env.src.catalog.lookup(N('AcroForm')));
    if (srcForm) {
      for (const key of ['DA', 'Q', 'NeedAppearances']) {
        const v = srcForm.get(N(key));
        if (v && !form.has(N(key))) form.set(N(key), env.copier.copy(v));
      }
      const srcDr = dictOf(srcForm.lookup(N('DR')));
      if (srcDr) {
        const dr = dictOf(form.lookup(N('DR')));
        if (!dr) form.set(N('DR'), env.copier.copy(srcDr));
        else {
          for (const [k, v] of srcDr.entries()) {
            const sub = srcDr.lookup(k);
            const own = dr.lookup(k);
            if (!own) dr.set(k, env.copier.copy(v));
            else if (sub instanceof PDFDict && own instanceof PDFDict) {
              for (const [name, val] of sub.entries()) if (!own.has(name)) own.set(name, env.copier.copy(val));
            }
          }
        }
      }
    }
  }
}

/** Annotation names (/NM) already used on the target's pages. */
function usedNames(doc: PDFDocument, skip: Set<PDFPageLeaf>): Set<string> {
  const used = new Set<string>();
  for (const p of doc.getPages()) {
    if (skip.has(p.node)) continue;
    for (const ref of p.node.Annots()?.asArray() ?? []) {
      const nm = text(dictOf(doc.context.lookup(ref))?.lookup(N('NM')));
      if (nm) used.add(nm);
    }
  }
  return used;
}

/**
 * `dest.copyPages(src, indices)` without the pages the copied ones refer to. The result's
 * pages still have to be added to `dest`'s page tree by the caller.
 */
export async function copyPages(dest: PDFDocument, src: PDFDocument, indices: number[]): Promise<PDFPage[]> {
  await src.flush();
  const copier = PDFObjectCopier.for(src.context, dest.context);
  // The copier's memo of what it already copied (pdf-lib keeps it private).
  const traversed = (copier as unknown as { traversedObjects: Map<PDFObject, PDFObject> }).traversedObjects;
  const same = src.context === dest.context;
  const env: Env = { src, dest, same, dead: dest.context.nextRef(), copier };
  const srcPages = src.getPages();
  const refs = indices.map(() => dest.context.nextRef());
  for (const p of srcPages) traversed.set(p.ref, same ? p.ref : env.dead);
  indices.forEach((i, k) => {
    if (!srcPages[i]) throw new Error(`Page ${i + 1} does not exist.`);
    if (traversed.get(srcPages[i].ref) === (same ? srcPages[i].ref : env.dead)) traversed.set(srcPages[i].ref, refs[k]);
  });
  const pages = indices.map((i, k) => {
    const node = copier.copy(srcPages[i].node) as PDFPageLeaf;
    dest.context.assign(refs[k], node);
    return PDFPage.of(node, refs[k], dest);
  });

  const copiedNodes = new Set(pages.map((p) => p.node));
  const names = usedNames(dest, copiedNodes);
  const ctx = dest.context;
  for (const page of pages) {
    // Threads (article beads) belong to the source's thread list, which is not copied.
    page.node.delete(N('B'));
    const annots = page.node.Annots();
    if (!annots) continue;
    const kept: PDFObject[] = [];
    for (const ref of annots.asArray()) {
      const a = ctx.lookup(ref);
      if (!(a instanceof PDFDict)) continue;
      if (a.has(N('P'))) a.set(N('P'), page.ref);
      const linked = fixActions(a, env);
      // A link that leads nowhere any more is just a dead rectangle.
      if (!linked && a.get(N('Subtype'))?.toString() === '/Link') continue;
      // A reply to a comment on a page that stayed behind is a comment of its own now.
      const irt = a.lookup(N('IRT'));
      if (irt instanceof PDFDict && isDead(irt.get(N('P')), env)) a.delete(N('IRT'));
      // Two annotations with one name confuse comment sync (XFDF) and reply threads.
      const nm = text(a.lookup(N('NM')));
      if (nm) {
        if (names.has(nm)) {
          let n = 2;
          while (names.has(`${nm}-${n}`)) n++;
          a.set(N('NM'), PDFHexString.fromText(`${nm}-${n}`));
          names.add(`${nm}-${n}`);
        } else names.add(nm);
      }
      kept.push(ref);
    }
    page.node.set(N('Annots'), ctx.obj(kept));
  }
  registerFields(pages, env);
  for (const page of pages) sweepDead(page.node, env);
  return pages;
}
