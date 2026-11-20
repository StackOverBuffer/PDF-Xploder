/**
 * Check spelling (Home › Spelling, F7): every word of the page text and of the
 * comments, against the dictionary of the document's language. Wrong words are
 * underlined on the page; each can be changed, ignored or added to the dictionary.
 * The dictionaries load in a worker on first use (lib/spell).
 */
import { allRuns, measure } from '../components/SearchPanel';
import { excerpt, guessLanguage, spellLangFor, words, type SpellLang } from '../lib/spell/text';
import { pageWords } from '../lib/spell/pageWords';
import { addWord, checkWords, suggestions, type WordAt } from '../lib/spell';
import { useLang, tf, tr } from '../lib/i18n';
import { documentLang } from '../lib/docLang';
import type { Annotation } from '../lib/types';
import { replaceAll, replaceHit } from './findReplace';
import { useStore } from './store';
import { useSpell, type SpellIssue } from './spellState';

export { useSpell, type SpellIssue } from './spellState';

const S = () => useStore.getState();

/** Words ignored with "Ignore all", for this visit. */
const ignoredWords = new Set<string>();
/** Single places ignored with "Ignore". */
const ignoredOnce = new Set<string>();

/** The text fields of a comment that people write (not the page text a highlight marks). */
function commentTexts(a: Annotation): { field: 'text' | 'comment' | 'reply'; replyId?: string; text: string }[] {
  const out: { field: 'text' | 'comment' | 'reply'; replyId?: string; text: string }[] = [];
  if ((a.type === 'text' || a.type === 'note') && a.text) out.push({ field: 'text', text: a.text });
  if (a.comment) out.push({ field: 'comment', text: a.comment });
  for (const r of a.replies ?? []) if (r.text) out.push({ field: 'reply', replyId: r.id, text: r.text });
  return out;
}

/** The dictionary for the open document: its language, else a guess from its text, else the interface's. */
export async function documentLanguage(): Promise<SpellLang> {
  const pdf = S().pdf;
  const tagged = spellLangFor(pdf ? await documentLang(pdf) : undefined);
  if (tagged) return tagged;
  const runs = await allRuns().catch(() => []);
  const guess = guessLanguage(runs.slice(0, 5).flat().map((r) => r.str).join(' '));
  const browser = typeof navigator !== 'undefined' ? navigator.language : '';
  const english = spellLangFor(browser) === 'en-GB' ? 'en-GB' : 'en-US';
  if (guess === 'de') return 'de';
  if (guess === 'en') return english;
  return useLang.getState().lang === 'de' ? 'de' : english;
}

let runId = 0;

/** Check the whole document (again), keeping the current place where possible. */
export async function checkDocument(lang?: SpellLang): Promise<void> {
  const id = ++runId;
  const keep = useSpell.getState().issues[useSpell.getState().index]?.key;
  useSpell.setState({ running: true, error: null });
  try {
    const l = lang ?? useSpell.getState().lang ?? (await documentLanguage());
    if (id !== runId) return;
    useSpell.setState({ lang: l });
    const found: (SpellIssue & { next: string })[] = [];
    const seen = new Map<string, number>();
    const keyFor = (where: string, word: string) => {
      const k = `${where}:${word}`;
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      return `${k}:${n}`;
    };
    const runs = await allRuns();
    runs.forEach((page, p) => {
      for (const w of pageWords(page, measure)) found.push({ key: keyFor(`p${p}`, w.word), word: w.word, next: w.next, page: p, rect: w.rect, context: w.context, source: { kind: 'page', split: w.split } });
    });
    const s = S();
    s.pageIds.forEach((pageId, p) => {
      for (const a of s.annotations[pageId] ?? []) {
        for (const f of commentTexts(a)) {
          for (const w of words(f.text)) {
            found.push({
              key: keyFor(`c${a.id}:${f.field}:${f.replyId ?? ''}`, w.word),
              word: w.word,
              next: f.text[w.start + w.word.length] ?? '',
              page: p,
              context: excerpt(f.text, w.start, w.word.length),
              source: { kind: 'comment', pageId, annotId: a.id, field: f.field, replyId: f.replyId, start: w.start },
            });
          }
        }
      }
    });
    // Each distinct word once.
    const distinct = new Map<string, WordAt>();
    for (const f of found) distinct.set(`${f.word}\u0000${f.next === '.' ? '.' : ''}`, [f.word, f.next === '.' ? '.' : '']);
    const list = [...distinct.values()];
    const ok = await checkWords(l, list);
    if (id !== runId) return;
    const good = new Set(list.filter((_, i) => ok[i]).map(([w, n]) => `${w}\u0000${n}`));
    const issues = found
      .filter((f) => !good.has(`${f.word}\u0000${f.next === '.' ? '.' : ''}`) && !ignoredWords.has(f.word) && !ignoredOnce.has(f.key))
      .map(({ next: _next, ...issue }) => issue);
    const at = keep ? issues.findIndex((i) => i.key === keep) : -1;
    const prev = useSpell.getState().index;
    useSpell.setState({ issues, checked: true, running: false, index: issues.length ? (at >= 0 ? at : Math.min(Math.max(prev, 0), issues.length - 1)) : -1 });
  } catch (e) {
    if (id === runId) useSpell.setState({ running: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Forget the results (the pane closed or another document is shown). */
export function clearSpelling() {
  runId++;
  useSpell.setState({ issues: [], index: -1, checked: false, running: false, error: null, lang: null });
}

/** Show issue `i` (wrapping around): its page, and its comment selected. */
export function showIssue(i: number) {
  const { issues } = useSpell.getState();
  if (!issues.length) return;
  const index = (i + issues.length) % issues.length;
  useSpell.setState({ index });
  const issue = issues[index];
  const s = S();
  if (issue.source.kind === 'comment') {
    s.setTool('select');
    s.select({ pageId: issue.source.pageId, id: issue.source.annotId });
  }
  s.goToPage(issue.page, issue.rect && s.geoms[issue.page]?.rotation === 0 ? issue.rect.y : undefined);
}

export const suggestFor = (word: string) => suggestions(useSpell.getState().lang ?? 'en-US', word);

/** Put `replacement` in place of the word in a comment's text. */
function changeInComment(issue: SpellIssue, replacement: string, history = true): boolean {
  if (issue.source.kind !== 'comment') return false;
  const { pageId, annotId, field, replyId, start } = issue.source;
  const a = (S().annotations[pageId] ?? []).find((x) => x.id === annotId);
  if (!a) return false;
  const swap = (text: string) => (text.slice(start, start + issue.word.length) === issue.word ? text.slice(0, start) + replacement + text.slice(start + issue.word.length) : null);
  if (field === 'reply') {
    const replies = (a.replies ?? []).map((r) => (r.id === replyId ? { ...r, text: swap(r.text) ?? r.text } : r));
    S().updateAnnotation(pageId, annotId, { replies }, { history });
    return true;
  }
  const text = field === 'text' ? (a as { text: string }).text : a.comment ?? '';
  const changed = swap(text);
  if (changed === null) return false;
  S().updateAnnotation(pageId, annotId, field === 'text' ? ({ text: changed } as Partial<Annotation>) : { comment: changed }, { history });
  return true;
}

const OPTS = { matchCase: true, wholeWord: true };

/** Change the current issue's word. */
export async function changeIssue(replacement: string) {
  const { issues, index } = useSpell.getState();
  const issue = issues[index];
  if (!issue || !replacement || replacement === issue.word) return;
  if (issue.source.kind === 'comment') {
    if (changeInComment(issue, replacement)) await checkDocument();
    return;
  }
  if (issue.source.split) return S().notify(tr('This word is hyphenated across two lines: change it with Edit Text.'));
  // The page text changes: checkDocument runs again with the new document (see SpellPanel).
  await replaceHit({ page: issue.page, rect: issue.rect!, context: issue.context }, issue.word, replacement, OPTS);
}

/** Change every place of the current issue's word, in the page text and the comments. */
export async function changeAll(replacement: string) {
  const { issues, index } = useSpell.getState();
  const issue = issues[index];
  if (!issue || !replacement || replacement === issue.word) return;
  const same = issues.filter((i) => i.word === issue.word);
  const inComments = same.filter((i) => i.source.kind === 'comment');
  if (inComments.length) {
    S().checkpoint();
    // From the end, so earlier offsets in the same text stay right.
    for (const i of [...inComments].reverse()) changeInComment(i, replacement, false);
  }
  if (same.some((i) => i.source.kind === 'page')) await replaceAll(issue.word, replacement, OPTS);
  else if (inComments.length) S().notify(tf('Replaced {n} occurrence(s).', { n: inComments.length }));
  await checkDocument();
}

function drop(pred: (i: SpellIssue) => boolean) {
  const { issues, index } = useSpell.getState();
  const before = issues.slice(0, index).filter((i) => !pred(i)).length;
  const rest = issues.filter((i) => !pred(i));
  useSpell.setState({ issues: rest, index: rest.length ? Math.min(before, rest.length - 1) : -1 });
  if (rest.length) showIssue(Math.min(before, rest.length - 1));
}

export function ignoreIssue() {
  const issue = useSpell.getState().issues[useSpell.getState().index];
  if (!issue) return;
  ignoredOnce.add(issue.key);
  drop((i) => i.key === issue.key);
}

export function ignoreAll() {
  const issue = useSpell.getState().issues[useSpell.getState().index];
  if (!issue) return;
  ignoredWords.add(issue.word);
  drop((i) => i.word === issue.word);
}

export async function addToDictionary() {
  const issue = useSpell.getState().issues[useSpell.getState().index];
  if (!issue) return;
  await addWord(issue.word);
  drop((i) => i.word === issue.word);
}
