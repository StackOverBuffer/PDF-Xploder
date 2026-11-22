/**
 * Other programs' annotation keys, kept through the round trip into our model.
 *
 * On import every direct key of the annotation dictionary is kept in PDF syntax. While the
 * annotation is unchanged, saving writes them back as they were: Squiggly stays Squiggly,
 * line ends, dashes, clouds, the note icon, rich text and the modification date all
 * survive. Once the user edits it, our keys win and only the keys we never write (and
 * that do not describe the old drawing) are kept.
 */
import { PDFArray, PDFContext, PDFDict, PDFName, PDFObject, PDFObjectParser, PDFRef } from '@cantoo/pdf-lib';
import type { Annotation, ForeignKeys } from './types';

/** Keys that belong to this file's object graph or to us, never copied. */
const SKIP = new Set(['Type', 'Rect', 'AP', 'AS', 'P', 'Popup', 'IRT', 'Parent', 'NM', 'StructParent', 'AwesomePDF', 'AwesomePDFSrc', 'AwesomePDFAppearance']);

/** Keys that describe the old drawing or text: dropped once the annotation is edited. */
const DRAWING = new Set(['RC', 'DS', 'BE', 'LE', 'RD', 'Cap', 'CP', 'LL', 'LLE', 'LLO', 'CL', 'IT', 'Border', 'Q', 'BM']);

function hasRef(o: PDFObject | undefined): boolean {
  if (o instanceof PDFRef) return true;
  if (o instanceof PDFArray) return o.asArray().some(hasRef);
  if (o instanceof PDFDict) return o.entries().some(([, v]) => hasRef(v));
  return false;
}

/** The direct keys of `dict`, in PDF syntax (keys that point at other objects are left out). */
export function readKeys(dict: PDFDict): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of dict.entries()) {
    const name = k.decodeText();
    if (SKIP.has(name) || hasRef(v)) continue;
    out[name] = v.toString();
  }
  return out;
}

/** What the model held at import: any difference means the user edited the annotation. */
export function foreignKey(a: Annotation): string {
  const { foreign, popup, replies, status, statusLog, ...rest } = a as Annotation & Record<string, unknown>;
  void foreign, void popup, void replies, void status, void statusLog;
  return JSON.stringify(rest);
}

export function unchanged(a: Annotation): a is Annotation & { foreign: ForeignKeys } {
  return !!a.foreign && a.foreign.of === foreignKey(a);
}

/** The other program's own drawing, while the annotation still looks as it drew it. */
export function keptAppearance(a: Annotation): { ap: string; rect: NonNullable<ForeignKeys['rect']> } | undefined {
  return unchanged(a) && a.foreign.ap && a.foreign.rect ? { ap: a.foreign.ap, rect: a.foreign.rect } : undefined;
}

function parse(ctx: PDFContext, src: string): PDFObject | undefined {
  try {
    return PDFObjectParser.forBytes(new TextEncoder().encode(src), ctx).parseObject();
  } catch {
    return undefined;
  }
}

/** Write the kept keys into the dictionary we just built for `a`. */
export function restoreKeys(dict: PDFDict, a: Annotation, ctx: PDFContext): void {
  const f = a.foreign;
  if (!f) return;
  const same = unchanged(a);
  for (const [k, src] of Object.entries(f.keys)) {
    const name = PDFName.of(k);
    if (!same && (dict.has(name) || DRAWING.has(k))) continue;
    const v = parse(ctx, src);
    if (v) dict.set(name, v);
  }
}

/**
 * Whether our drawing of this annotation would look different from the file's own:
 * then its appearance is kept too, until the annotation is edited.
 */
export function drawsDifferently(dict: PDFDict, a: Annotation): boolean {
  const get = (k: string) => dict.lookup(PDFName.of(k));
  const name = (k: string) => (get(k) instanceof PDFName ? (get(k) as PDFName).decodeText() : undefined);
  const bs = get('BS');
  const style = bs instanceof PDFDict ? (bs.lookup(PDFName.of('S')) as PDFName | undefined)?.decodeText() : undefined;
  const le = get('LE');
  const ends = le instanceof PDFArray ? le.asArray().map((x) => (x instanceof PDFName ? x.decodeText() : '')).join(' ') : le instanceof PDFName ? le.decodeText() : undefined;
  const border = get('Border');
  if (name('Subtype') === 'Squiggly') return true;
  if (style && style !== 'S') return true;
  if (border instanceof PDFArray && border.size() > 3) return true;
  if (ends !== undefined && ends !== (a.type === 'arrow' ? 'None OpenArrow' : 'None None') && ends !== 'None') return true;
  if (get('BE') && a.type !== 'cloud') return true;
  if (a.type === 'note' && (name('Name') ?? 'Note') !== 'Comment') return true;
  return ['LL', 'LLE', 'Cap', 'RD', 'CL'].some((k) => get(k) !== undefined);
}
