import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Highlighter } from 'lucide-react';
import { styleFor, uid, useStore, type SearchHit } from '../store/store';
import { useCan } from '../store/permissions';
import { pageTextRuns, type TextRun } from '../lib/pdfjs';

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

export async function runSearch(query: string, matchCase: boolean): Promise<SearchHit[]> {
  if (!query) return [];
  const runs = await allRuns();
  const q = matchCase ? query : query.toLowerCase();
  const hits: SearchHit[] = [];
  runs.forEach((page, p) => {
    for (const run of page) {
      const str = matchCase ? run.str : run.str.toLowerCase();
      let at = str.indexOf(q);
      while (at !== -1) {
        // Approximate the match box by its share of the run's width.
        const frac = run.rect.w / Math.max(1, run.str.length);
        hits.push({
          page: p,
          rect: { x: run.rect.x + at * frac, y: run.rect.y, w: Math.max(2, q.length * frac), h: run.rect.h },
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
  const search = useStore((s) => s.search);
  const docVersion = useStore((s) => s.docVersion);
  const editable = useCan('annotate');
  const [query, setQuery] = useState(search.query);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onFocus = () => inputRef.current?.focus();
    window.addEventListener('awesome-pdf:focus-search', onFocus);
    return () => window.removeEventListener('awesome-pdf:focus-search', onFocus);
  }, []);

  const go = goToHit;

  const submit = async (matchCase = search.matchCase, q = query) => {
    setRunning(true);
    const hits = await runSearch(q, matchCase);
    setRunning(false);
    useStore.getState().setSearch({ query: q, hits, index: -1, matchCase });
    if (hits.length) go(0);
  };

  // "Search for selected text" from a context menu.
  useEffect(() => {
    const onRun = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      setQuery(q);
      submit(useStore.getState().search.matchCase, q);
    };
    window.addEventListener('awesome-pdf:run-search', onRun);
    return () => window.removeEventListener('awesome-pdf:run-search', onRun);
  });

  // Re-run the search when the document changes.
  useEffect(() => {
    if (search.query) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docVersion]);

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
    s.notify(`Highlighted ${s.search.hits.length} match(es).`);
  };

  return (
    <div className="panel">
      <div className="panel-title">Search</div>
      <form className="search-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input ref={inputRef} placeholder="Find text…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className="primary">Find</button>
      </form>
      <div className="search-opts">
        <label><input type="checkbox" checked={search.matchCase} onChange={(e) => submit(e.target.checked)} /> Match case</label>
        <span className="spacer" />
        <button className="icon-btn" title="Previous" onClick={() => go(search.index - 1)}><ChevronUp size={16} /></button>
        <button className="icon-btn" title="Next" onClick={() => go(search.index + 1)}><ChevronDown size={16} /></button>
        <button className="icon-btn" title="Highlight all matches" disabled={!editable || !search.hits.length} onClick={highlightAll}><Highlighter size={16} /></button>
      </div>
      <div className="muted small pad">
        {running ? 'Searching…' : search.query ? `${search.hits.length} match(es)${search.index >= 0 ? ` · ${search.index + 1} of ${search.hits.length}` : ''}` : ''}
      </div>
      <div className="search-results">
        {search.hits.slice(0, 500).map((h, i) => (
          <button key={i} className={`search-result ${i === search.index ? 'current' : ''}`} onClick={() => go(i)}>
            <span className="muted small">p.{h.page + 1}</span> {h.context}
          </button>
        ))}
      </div>
    </div>
  );
}
