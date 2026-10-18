import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, EraserIcon, Highlighter } from 'lucide-react';
import { styleFor, uid, useStore, type SearchHit } from '../store/store';
import { useCan } from '../store/permissions';
import { pageTextRuns, type TextRun } from '../lib/pdfjs';
import { tf, useT } from '../lib/i18n';
import { markMatchesForRedaction, replaceAll, replaceHit } from '../store/findReplace';

/** Open the search pane; `mode` also shows the replace row or starts with redaction in mind. */
let pendingMode: string | null = null;

export function openSearch(mode: 'find' | 'replace' | 'redact' = 'find') {
  const s = useStore.getState();
  // Picked up when the pane mounts, or by the event when it is already open.
  pendingMode = mode;
  s.setSidebar('search');
  requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('awesome-pdf:focus-search', { detail: mode })));
}

let ctx2d: CanvasRenderingContext2D | null | undefined;
/** Width of text in a generic sans-serif font (relative widths are what matters). */
function measure(text: string): number {
  if (ctx2d === undefined) {
    ctx2d = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    if (ctx2d) ctx2d.font = '100px Arial, Helvetica, sans-serif';
  }
  return ctx2d ? ctx2d.measureText(text).width : 0;
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);

let cache: { version: number; runs: TextRun[][] } | null = null;

async function allRuns(): Promise<TextRun[][]> {
  const { pdf, docVersion } = useStore.getState();
  if (!pdf) return [];
  if (cache?.version === docVersion) return cache.runs;
  const runs: TextRun[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) runs.push(await pageTextRuns(await pdf.getPage(i)));
  cache = { version: docVersion, runs };
  return runs;
}

export async function runSearch(query: string, matchCase: boolean, wholeWord = false): Promise<SearchHit[]> {
  if (!query) return [];
  const runs = await allRuns();
  const q = matchCase ? query : query.toLowerCase();
  const hits: SearchHit[] = [];
  runs.forEach((page, p) => {
    for (const run of page) {
      const str = matchCase ? run.str : run.str.toLowerCase();
      let at = str.indexOf(q);
      while (at !== -1) {
        if (wholeWord && (isWordChar(run.str[at - 1]) || isWordChar(run.str[at + q.length]))) {
          at = str.indexOf(q, at + 1);
          continue;
        }
        // The viewer only knows the whole run's width: split it by measured text widths.
        const total = measure(run.str);
        const x0 = total ? (measure(run.str.slice(0, at)) / total) * run.rect.w : (at / run.str.length) * run.rect.w;
        const w = total ? (measure(run.str.slice(at, at + q.length)) / total) * run.rect.w : (q.length / run.str.length) * run.rect.w;
        hits.push({
          page: p,
          rect: { x: run.rect.x + x0, y: run.rect.y, w: Math.max(2, w), h: run.rect.h },
          context: run.str.slice(Math.max(0, at - 30), at + q.length + 30),
        });
        at = str.indexOf(q, at + q.length);
      }
    }
  });
  return hits;
}

/** Show search hit `index` (wrapping around). */
export function goToHit(index: number) {
  const s = useStore.getState();
  const hits = s.search.hits;
  if (!hits.length) return;
  const i = (index + hits.length) % hits.length;
  s.setSearch({ index: i });
  s.goToPage(hits[i].page, s.geoms[hits[i].page].rotation === 0 ? hits[i].rect.y : undefined);
}

export function SearchPanel() {
  const t = useT();
  const search = useStore((s) => s.search);
  const docVersion = useStore((s) => s.docVersion);
  const editable = useCan('annotate');
  const canModify = useCan('modify');
  const [query, setQuery] = useState(search.query);
  const [replacing, setReplacing] = useState(() => pendingMode === 'replace');
  const [replacement, setReplacement] = useState('');
  const wholeWord = !!search.wholeWord;
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    pendingMode = null;
    const onFocus = (e: Event) => {
      const mode = (e as CustomEvent<string>).detail;
      pendingMode = null;
      if (mode === 'replace') setReplacing(true);
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('awesome-pdf:focus-search', onFocus);
    return () => window.removeEventListener('awesome-pdf:focus-search', onFocus);
  }, []);

  const go = goToHit;

  const submit = async (matchCase = search.matchCase, q = query, whole = wholeWord) => {
    setRunning(true);
    const hits = await runSearch(q, matchCase, whole);
    setRunning(false);
    useStore.getState().setSearch({ query: q, hits, index: -1, matchCase, wholeWord: whole });
    if (hits.length) go(0);
  };

  // "Search for selected text" from a context menu.
  useEffect(() => {
    const onRun = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      setQuery(q);
      submit(useStore.getState().search.matchCase, q, !!useStore.getState().search.wholeWord);
    };
    window.addEventListener('awesome-pdf:run-search', onRun);
    return () => window.removeEventListener('awesome-pdf:run-search', onRun);
  });

  // Re-run the search when the document changes.
  useEffect(() => {
    if (search.query) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docVersion]);

  const opts = { matchCase: search.matchCase, wholeWord };
  const replaceCurrent = async () => {
    const s = useStore.getState();
    const hit = s.search.hits[Math.max(0, s.search.index)];
    if (!hit || !query) return;
    const index = Math.max(0, s.search.index);
    // The search re-runs on the changed document; stay at the same position.
    if (await replaceHit(hit, query, replacement, opts)) requestAnimationFrame(() => setTimeout(() => goToHit(index), 300));
  };

  const highlightAll = () => {
    const s = useStore.getState();
    const st = styleFor('highlight');
    s.checkpoint();
    const byPage = new Map<number, SearchHit[]>();
    for (const h of s.search.hits) byPage.set(h.page, [...(byPage.get(h.page) ?? []), h]);
    const annotations = { ...s.annotations };
    for (const [p, hs] of byPage) {
      const id = s.pageIds[p];
      annotations[id] = [
        ...(annotations[id] ?? []),
        ...hs.map((h) => ({ id: uid('annot'), type: 'highlight' as const, color: st.color, opacity: st.opacity, author: s.author, createdAt: Date.now(), rects: [h.rect], text: s.search.query })),
      ];
    }
    useStore.setState({ annotations, dirty: true });
    s.notify(tf('Highlighted {n} match(es).', { n: s.search.hits.length }));
  };

  return (
    <div className="panel">
      <div className="panel-title">{t('Search')}</div>
      <form className="search-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input ref={inputRef} placeholder={t('Find text…')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className="primary">{t('Find')}</button>
      </form>
      <div className="search-opts">
        <label><input type="checkbox" checked={search.matchCase} onChange={(e) => submit(e.target.checked)} /> {t('Match case')}</label>
        <label><input type="checkbox" checked={wholeWord} onChange={(e) => submit(search.matchCase, query, e.target.checked)} /> {t('Whole words')}</label>
      </div>
      <div className="search-opts">
        <span className="spacer" />
        <button className="icon-btn" title={t('Previous')} onClick={() => go(search.index - 1)}><ChevronUp size={16} /></button>
        <button className="icon-btn" title={t('Next')} onClick={() => go(search.index + 1)}><ChevronDown size={16} /></button>
        <button className="icon-btn" title={t('Highlight all matches')} disabled={!editable || !search.hits.length} onClick={highlightAll}><Highlighter size={16} /></button>
        <button className="icon-btn" title={t('Mark all matches for redaction')} disabled={!editable || !search.hits.length} onClick={() => markMatchesForRedaction(search.query, opts, search.hits)}><EraserIcon size={16} /></button>
      </div>
      <button className="search-replace-toggle" aria-expanded={replacing} onClick={() => setReplacing(!replacing)}>
        {replacing ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {t('Replace')}
      </button>
      {replacing && (
        <div className="search-replace">
          <input placeholder={t('Replace with…')} aria-label={t('Replace with')} value={replacement} onChange={(e) => setReplacement(e.target.value)} />
          <div className="search-replace-buttons">
            <button disabled={!canModify || !search.hits.length || query !== search.query} onClick={replaceCurrent}>{t('Replace')}</button>
            <button disabled={!canModify || !search.hits.length || query !== search.query} onClick={() => replaceAll(search.query, replacement, opts)}>{t('Replace all')}</button>
          </div>
        </div>
      )}
      <div className="muted small pad">
        {running ? t('Searching…') : search.query ? `${tf('{n} match(es)', { n: search.hits.length })}${search.index >= 0 ? ` · ${tf('{i} of {n}', { i: search.index + 1, n: search.hits.length })}` : ''}` : ''}
      </div>
      <div className="search-results">
        {search.hits.slice(0, 500).map((h, i) => (
          <button key={i} className={`search-result ${i === search.index ? 'current' : ''}`} onClick={() => go(i)}>
            <span className="muted small">{tf('p.{n}', { n: h.page + 1 })}</span> {h.context}
          </button>
        ))}
      </div>
    </div>
  );
}
