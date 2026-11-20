/** The Spelling pane (Home › Spelling, F7): unknown words of the page text and the comments. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import { tf, useT } from '../lib/i18n';
import { SPELL_LANGS, type SpellLang } from '../lib/spell/text';
import { addToDictionary, changeAll, changeIssue, checkDocument, clearSpelling, ignoreAll, ignoreIssue, showIssue, suggestFor, useSpell } from '../store/spelling';

const LANG_LABELS: Record<SpellLang, string> = { 'en-US': 'English (US)', 'en-GB': 'English (UK)', de: 'German' };

export function SpellPanel() {
  const t = useT();
  const { lang, issues, index, checked, running, error } = useSpell();
  const docVersion = useStore((s) => s.docVersion);
  const annotations = useStore((s) => s.annotations);
  const canModify = useCan('modify');
  const canAnnotate = useCan('annotate');
  const [suggested, setSuggested] = useState<string[] | null>(null);
  const [replacement, setReplacement] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef(true);
  const issue = issues[index];
  // The list shows each word once, where it first occurs; Previous and Next go through every place.
  const groups = useMemo(() => {
    const m = new Map<string, { word: string; first: number; count: number }>();
    issues.forEach((x, i) => {
      const g = m.get(x.word);
      if (g) g.count++;
      else m.set(x.word, { word: x.word, first: i, count: 1 });
    });
    return [...m.values()];
  }, [issues]);

  // Check when the pane opens, and again after the document or its comments change.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      void checkDocument().then(() => useSpell.getState().index >= 0 && showIssue(useSpell.getState().index));
      return;
    }
    const timer = setTimeout(() => void checkDocument(), 400);
    return () => clearTimeout(timer);
  }, [docVersion, annotations]);
  useEffect(() => () => clearSpelling(), []);

  // Suggestions for the current word.
  const word = issue?.word;
  useEffect(() => {
    setSuggested(null);
    setReplacement('');
    if (!word) return;
    let live = true;
    void suggestFor(word).then((list) => {
      if (!live) return;
      setSuggested(list);
      setReplacement(list[0] ?? '');
    }).catch(() => live && setSuggested([]));
    return () => {
      live = false;
    };
  }, [word, lang]);

  const editable = issue && (issue.source.kind === 'comment' ? canAnnotate : canModify && !issue.source.split);
  const act = async (fn: () => unknown) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const ready = !!issue && !busy && !running;
  const changeOk = ready && editable && !!replacement.trim() && replacement !== issue.word;

  return (
    <div className="panel spell-panel">
      <div className="panel-title">
        {t('Spelling')}
        <button className="small-btn" disabled={running} onClick={() => void checkDocument()} title={t('Check the document again')}><RefreshCw size={12} /> {t('Check again')}</button>
      </div>
      <div className="search-opts">
        <label>
          {t('Language')}{' '}
          <select value={lang ?? ''} disabled={!lang} onChange={(e) => void checkDocument(e.target.value as SpellLang)}>
            {!lang && <option value="">…</option>}
            {SPELL_LANGS.map((l) => <option key={l} value={l}>{t(LANG_LABELS[l])}</option>)}
          </select>
        </label>
        <span className="spacer" />
        <button className="icon-btn" title={t('Previous')} disabled={!issues.length} onClick={() => showIssue(index - 1)}><ChevronUp size={16} /></button>
        <button className="icon-btn" title={t('Next')} disabled={!issues.length} onClick={() => showIssue(index + 1)}><ChevronDown size={16} /></button>
      </div>
      <div className="muted small pad" role="status">
        {error
          ? <span className="error-text">{t('The spell checker could not start.')} {error}</span>
          : running && !checked
            ? t('Loading the dictionary and checking…')
            : running
              ? t('Checking…')
              : checked && !issues.length
                ? t('No spelling mistakes found.')
                : checked
                  ? `${tf('{n} unknown word(s)', { n: issues.length })}${index >= 0 ? ` · ${tf('{i} of {n}', { i: index + 1, n: issues.length })}` : ''}`
                  : ''}
      </div>
      {issue && (
        <div className="spell-current">
          <div className="spell-word">
            <b>{issue.word}</b> <span className="muted small">{tf('p.{n}', { n: issue.page + 1 })}{issue.source.kind === 'comment' ? ` · ${t('in a comment')}` : ''}</span>
          </div>
          <div className="spell-context muted small">{issue.context}</div>
          <div className="spell-suggestions" role="listbox" aria-label={t('Suggestions')}>
            {suggested === null && <span className="muted small">{t('Looking for suggestions…')}</span>}
            {suggested?.length === 0 && <span className="muted small">{t('No suggestions')}</span>}
            {suggested?.map((s) => (
              <button key={s} role="option" aria-selected={s === replacement} className={s === replacement ? 'current' : ''} onClick={() => setReplacement(s)} onDoubleClick={() => editable && act(() => changeIssue(s))}>{s}</button>
            ))}
          </div>
          <form className="search-replace" onSubmit={(e) => { e.preventDefault(); if (changeOk) void act(() => changeIssue(replacement.trim())); }}>
            <input aria-label={t('Change to')} placeholder={t('Change to…')} value={replacement} spellCheck={false} onChange={(e) => setReplacement(e.target.value)} />
            <div className="search-replace-buttons">
              <button type="submit" className="primary" disabled={!changeOk}>{t('Change')}</button>
              <button type="button" disabled={!changeOk || (issue.source.kind === 'page' ? false : !canAnnotate)} onClick={() => void act(() => changeAll(replacement.trim()))}>{t('Change all')}</button>
            </div>
            <div className="search-replace-buttons">
              <button type="button" disabled={!ready} onClick={ignoreIssue}>{t('Ignore')}</button>
              <button type="button" disabled={!ready} onClick={ignoreAll}>{t('Ignore all')}</button>
            </div>
            <div className="search-replace-buttons">
              <button type="button" disabled={!ready} onClick={() => void act(addToDictionary)} title={t('Accept this word from now on, in every document (kept in this browser)')}>{t('Add to dictionary')}</button>
            </div>
          </form>
        </div>
      )}
      <div className="search-results">
        {groups.map((g) => (
          <button key={g.word} className={`search-result ${g.word === issue?.word ? 'current' : ''}`} onClick={() => showIssue(g.first)}>
            <b>{g.word}</b> {g.count > 1 && <span className="muted small">×{g.count}</span>} <span className="muted small">{tf('p.{n}', { n: issues[g.first].page + 1 })}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
