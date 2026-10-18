/**
 * Saving with pdf-lib, minus what nothing refers to any more. pdf-lib writes every
 * object it ever loaded or created, so without this a deleted page, an edited
 * page's old content or a redacted page's original text would stay in the file
 * (and the file would grow with every edit).
 */
import { PDFArray, PDFDict, PDFRef, PDFStream, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib';

/** Delete indirect objects that cannot be reached from the trailer. Returns how many were removed. */
export function pruneUnreachable(doc: PDFDocument): number {
  const ctx = doc.context;
  const reached = new Set<string>();
  const stack: PDFObject[] = [];
  const { Root, Info, Encrypt, ID } = ctx.trailerInfo;
  for (const o of [Root, Info, Encrypt, ID]) if (o) stack.push(o);
  while (stack.length) {
    const o = stack.pop()!;
    if (o instanceof PDFRef) {
      const tag = o.toString();
      if (reached.has(tag)) continue;
      reached.add(tag);
      const v = ctx.lookup(o);
      if (v) stack.push(v);
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v);
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) stack.push(v);
    } else if (o instanceof PDFStream) {
      stack.push(o.dict);
    }
  }
  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!reached.has(ref.toString())) {
      ctx.delete(ref);
      removed++;
    }
  }
  return removed;
}

/** Save a document (with object streams), leaving out unreachable objects. */
export async function saveDoc(doc: PDFDocument, opts: { useObjectStreams?: boolean } = {}): Promise<Uint8Array> {
  // Embedded fonts and images become objects only when flushed: do that before pruning.
  await doc.flush();
  pruneUnreachable(doc);
  return doc.save({ useObjectStreams: opts.useObjectStreams ?? true });
}
