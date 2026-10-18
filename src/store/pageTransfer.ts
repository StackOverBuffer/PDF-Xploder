/**
 * Drag pages between documents, like PDF-XChange: drag thumbnails onto another
 * tab (hovering switches to it) and drop them into its page list or onto the
 * tab itself; drop them on "+" to open them as a new document. Pages are
 * copied, comments included (they stay editable).
 */
import * as ops from '../lib/pdfOps';
import { rangeText } from '../lib/organize';
import { baseName } from '../lib/download';
import { tf } from '../lib/i18n';
import type { Annotation } from '../lib/types';
import { allowed, requirePermission } from './permissions';
import { uid, useStore } from './store';

const S = () => useStore.getState();

/** Data type of a thumbnail drag (the payload is the 0-based page list). */
export const PAGE_DRAG_TYPE = 'application/x-awesome-pages';

interface PageClip {
  tab: string;
  fileName: string;
  pages: number[];
  /** Only the dragged pages, with form values applied (built on drop, from the document as it was when the drag started). */
  bytes: () => Promise<Uint8Array>;
  annotations: Annotation[][];
  canCopy: boolean;
}

let clip: PageClip | null = null;

/** Remember what is being dragged: the source tab is parked once another tab shows. */
export function startPageDrag(pages: number[]) {
  const s = S();
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const canCopy = allowed(s, 'copy');
  // Nothing is built yet: most drags just reorder pages within the document.
  const { bytes: source, formValues } = s;
  let built: Promise<Uint8Array> | null = null;
  const bytes = () =>
    (built ??= (Object.keys(formValues).length ? ops.setFormValues(source!, formValues) : Promise.resolve(source!)).then((b) => ops.extractPages(b, sorted)));
  clip = { tab: s.activeTab, fileName: s.fileName, pages: sorted, bytes, annotations: sorted.map((i) => s.annotations[s.pageIds[i]] ?? []), canCopy };
}

export function endPageDrag() {
  clip = null;
}

/** A page drag from another document is under way. */
export const draggingFromOtherTab = () => !!clip && clip.tab !== S().activeTab;
export const draggingPages = () => !!clip;

const cloneAll = (list: Annotation[]): Annotation[] => list.map((a) => ({ ...structuredClone(a), id: uid('annot') }));

function take(): PageClip | null {
  const c = clip;
  clip = null;
  if (c && !c.canCopy) {
    S().notify('The document the pages come from does not allow copying.', 'error');
    return null;
  }
  return c;
}

/** Insert the dragged pages into the active document before `at` (default: at the end). */
export async function dropPages(at?: number): Promise<void> {
  if (!draggingFromOtherTab()) return;
  const c = take();
  if (!c || !requirePermission('assemble')) return;
  await S().run('Inserting pages…', async () => {
    const pos = Math.min(at ?? S().pageIds.length, S().pageIds.length);
    const { bytes, count } = await ops.insertDocument(S().bytes!, await c.bytes(), pos);
    const added = Array.from({ length: count }, () => uid('page'));
    const ids = [...S().pageIds];
    ids.splice(pos, 0, ...added);
    const annotations = { ...S().annotations };
    added.forEach((id, k) => {
      if (c.annotations[k]?.length) annotations[id] = cloneAll(c.annotations[k]);
    });
    await S().commitBytes(bytes, ids, annotations);
    S().setSelectedPages(added.map((_, k) => pos + k));
    S().goToPage(pos);
    S().notify(tf('Copied {n} page(s) from {name}.', { n: count, name: c.fileName }));
  });
}

/** Open the dragged pages as a new document in a tab of its own. */
export async function dropPagesAsNewDocument(): Promise<void> {
  const c = take();
  if (!c) return;
  await S().run('Opening…', async () => {
    const name = `${baseName(c.fileName || 'document')} (${rangeText(c.pages)}).pdf`;
    await S().openInNewTab(await c.bytes(), name);
    const s = S();
    const annotations: Record<string, Annotation[]> = {};
    s.pageIds.forEach((id, k) => {
      if (c.annotations[k]?.length) annotations[id] = cloneAll(c.annotations[k]);
    });
    // A new, unsaved document.
    useStore.setState({ annotations, dirty: true });
  });
}
