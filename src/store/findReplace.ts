/** Find and replace text, and find and redact (Home → Find, Protect → Redaction). */
import type { FindOptions, TextMatch } from '../lib/content/findText';
import { content as contentW } from '../lib/worker';
import { tf, tr } from '../lib/i18n';
import type { Annotation, Rect } from '../lib/types';
import { bytesKey, confirmPagesEditable, markPagesVerified } from './content';
import { requirePermission } from './permissions';
import { styleFor, uid, useStore, type SearchHit } from './store';

const S = () => useStore.getState();

/** Matches in the page content, per page. */
async function contentMatches(query: string, o: FindOptions, pages?: number[]): Promise<Map<number, TextMatch[]>> {
  const bytes = S().bytes!;
  return new Map(await contentW.findMatches(bytes, query, o, pages, bytesKey(bytes)));
}

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const inside = (p: { x: number; y: number }, r: Rect, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Replace every match in the document (one undo step). */
export async function replaceAll(query: string, replacement: string, o: FindOptions) {
  if (!query || !requirePermission('modify')) return;
  await S().run('Replacing…', async () => {
    const found = await contentMatches(query, o);
    if (!found.size) return S().notify(noEditableMatches());
    const pages = await confirmPagesEditable([...found.keys()]);
    if (!pages.length) return;
    const { bytes, n } = await contentW.replaceInPages(S().bytes!, pages, query, replacement, o);
    await S().commitBytes(bytes);
    markPagesVerified(pages);
    S().notify(tf('Replaced {n} occurrence(s) on {pages} page(s).', { n, pages: pages.length }));
  });
}

/** Replace the match at a search hit (the current result). Returns whether something was replaced. */
export async function replaceHit(hit: SearchHit, query: string, replacement: string, o: FindOptions): Promise<boolean> {
  if (!query || !requirePermission('modify')) return false;
  let done = false;
  await S().run('Replacing…', async () => {
    const matches = (await contentMatches(query, o, [hit.page])).get(hit.page) ?? [];
    // The match whose box holds the hit's centre, or the nearest one.
    const c = centre(hit.rect);
    const dist = (m: TextMatch) => Math.min(...m.rects.map((r) => (inside(c, r, 2) ? 0 : Math.hypot(centre(r).x - c.x, centre(r).y - c.y))));
    const target = [...matches].sort((a, b) => dist(a) - dist(b))[0];
    if (!target || dist(target) > Math.max(hit.rect.h, 12) * 2) return S().notify(noEditableMatches());
    if (!(await confirmPagesEditable([hit.page])).length) return;
    const { bytes } = await contentW.replaceInPages(S().bytes!, [hit.page], query, replacement, o, { object: target.object, start: target.start });
    await S().commitBytes(bytes);
    markPagesVerified([hit.page]);
    done = true;
  });
  return done;
}

const noEditableMatches = () => tr('No matches in the page text that can be edited (text in comments, form fields or embedded graphics cannot be replaced).');

/**
 * Mark every match for redaction. Boxes come from the page content (exact);
 * hits found only by the viewer (e.g. inside embedded graphics) get their
 * approximate box, so nothing is missed.
 */
export async function markMatchesForRedaction(query: string, o: FindOptions, hits: SearchHit[]) {
  if (!query || !requirePermission('annotate')) return;
  await S().run('Marking for redaction…', async () => {
    const found = await contentMatches(query, o);
    const s = S();
    const st = styleFor('redact');
    const byPage = new Map<number, Rect[]>();
    for (const [p, ms] of found) byPage.set(p, ms.flatMap((m) => m.rects));
    for (const h of hits) {
      const rects = byPage.get(h.page) ?? [];
      if (!rects.some((r) => overlaps(r, h.rect))) byPage.set(h.page, [...rects, h.rect]);
    }
    const total = [...byPage.values()].reduce((n, l) => n + l.length, 0);
    if (!total) return s.notify(tr('No matches.'));
    s.checkpoint();
    const annotations = { ...s.annotations };
    for (const [p, rects] of byPage) {
      const id = s.pageIds[p];
      const marks: Annotation[] = rects.map((r) => ({
        id: uid('annot'), type: 'redact', color: st.color, opacity: st.opacity, author: s.author, createdAt: Date.now(),
        // A little padding so no glyph edge stays visible.
        rect: { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 },
        text: query,
      }));
      annotations[id] = [...(annotations[id] ?? []), ...marks];
    }
    useStore.setState({ annotations, dirty: true });
    s.notify(tf('Marked {n} match(es) on {pages} page(s) for redaction. Check them, then use Protect → Apply.', { n: total, pages: byPage.size }));
  });
}
