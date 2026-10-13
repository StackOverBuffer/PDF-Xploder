/** Dialogs of the Bookmarks tab. */
import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../store/store';
import * as bc from '../store/bookmarkCommands';
import { validateBookmarks, type BookmarkProblem, type CaseMode } from '../lib/bookmarkTools';
import { pickFile } from '../lib/download';
import { useT } from '../lib/i18n';
import { Modal } from './Dialogs';
import { resolvePages } from './OrganizeDialogs';

export type BookmarkDialogName = 'bmEveryNth' | 'bmHeadings' | 'bmToc' | 'bmText' | 'bmCase' | 'bmReplace' | 'bmAddText' | 'bmValidate' | 'bmBuildToc';
export const BOOKMARK_DIALOGS: BookmarkDialogName[] = ['bmEveryNth', 'bmHeadings', 'bmToc', 'bmText', 'bmCase', 'bmReplace', 'bmAddText', 'bmValidate', 'bmBuildToc'];

const S = useStore.getState;

function Row({ label, children }: { label: string; children: ReactNode }) {
  const t = useT();
  return <label className="row"><span>{t(label)}</span>{children}</label>;
}

function Footer({ close, ok, label = 'OK', disabled }: { close: () => void; ok: () => void; label?: string; disabled?: boolean }) {
  const t = useT();
  return (
    <>
      <button onClick={close}>{t('Cancel')}</button>
      <button className="primary" disabled={disabled} onClick={() => { close(); ok(); }}>{t(label)}</button>
    </>
  );
}

function ModeChoice({ mode, setMode }: { mode: bc.GenerateMode; setMode: (m: bc.GenerateMode) => void }) {
  const t = useT();
  return (
    <div className="row">
      <span>{t('Existing bookmarks')}</span>
      <span className="inline">
        <label className="inline"><input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /> {t('Keep and add')}</label>
        <label className="inline"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> {t('Replace')}</label>
      </span>
    </div>
  );
}

function EveryNth({ close }: { close: () => void }) {
  const t = useT();
  const [every, setEvery] = useState(1);
  const [start, setStart] = useState(1);
  const [template, setTemplate] = useState(t('Page {page}'));
  const [mode, setMode] = useState<bc.GenerateMode>('append');
  return (
    <Modal title={t('Bookmark Every Nth Page')} onClose={close} footer={<Footer close={close} ok={() => bc.bookmarkEveryNth(every, template, start - 1, mode)} label="Add" />}>
      <Row label="Every"><input type="number" min={1} value={every} onChange={(e) => setEvery(Math.max(1, Number(e.target.value)))} /><span>{t('page(s)')}</span></Row>
      <Row label="Starting at page"><input type="number" min={1} max={S().pageIds.length} value={start} onChange={(e) => setStart(Math.max(1, Number(e.target.value)))} /></Row>
      <Row label="Title"><input value={template} onChange={(e) => setTemplate(e.target.value)} /></Row>
      <p className="muted small">{t('{page} is replaced by the page number, {n} by a running number.')}</p>
      <ModeChoice mode={mode} setMode={setMode} />
    </Modal>
  );
}

function Headings({ close }: { close: () => void }) {
  const t = useT();
  const [pages, setPages] = useState(t('all'));
  const [levels, setLevels] = useState(3);
  const [mode, setMode] = useState<bc.GenerateMode>('replace');
  return (
    <Modal title={t('Generate Bookmarks from Page Text')} onClose={close} footer={<Footer close={close} ok={() => bc.bookmarksFromHeadings(resolvePages(pages), levels, mode)} label="Generate" />}>
      <p className="muted small">{t('Lines set in a larger font than the body text become bookmarks; the largest size is the top level.')}</p>
      <Row label="Pages"><input value={pages} onChange={(e) => setPages(e.target.value)} /></Row>
      <Row label="Levels"><input type="number" min={1} max={6} value={levels} onChange={(e) => setLevels(Math.max(1, Math.min(6, Number(e.target.value))))} /></Row>
      <ModeChoice mode={mode} setMode={setMode} />
    </Modal>
  );
}

function FromToc({ close }: { close: () => void }) {
  const t = useT();
  const [pages, setPages] = useState(String(S().currentPage + 1));
  const [offset, setOffset] = useState(0);
  const [mode, setMode] = useState<bc.GenerateMode>('replace');
  return (
    <Modal title={t('Generate Bookmarks from Table of Contents')} onClose={close} footer={<Footer close={close} ok={() => bc.bookmarksFromToc(resolvePages(pages), offset, mode)} label="Generate" />}>
      <p className="muted small">{t('Reads entries like “2.1 Title ........ 17”; numbering or indentation sets the level.')}</p>
      <Row label="Contents pages"><input value={pages} onChange={(e) => setPages(e.target.value)} /></Row>
      <Row label="Page number offset"><input type="number" value={offset} onChange={(e) => setOffset(Number(e.target.value))} /></Row>
      <p className="muted small">{t('Use an offset when printed page numbers differ from the PDF pages (e.g. +2 if page “1” is the third page).')}</p>
      <ModeChoice mode={mode} setMode={setMode} />
    </Modal>
  );
}

function FromText({ close }: { close: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<bc.GenerateMode>('replace');
  const load = async () => {
    const [f] = await pickFile('.txt,text/plain');
    if (f) setText(await f.text());
  };
  return (
    <Modal wide title={t('Generate Bookmarks from a Text File')} onClose={close} footer={<Footer close={close} ok={() => bc.bookmarksFromText(text, mode)} label="Generate" disabled={!text.trim()} />}>
      <p className="muted small">{t('One bookmark per line; indent with tabs for sub-bookmarks; put the page number at the end after a tab or “|”.')}</p>
      <div className="row"><span /><button onClick={load}>{t('Open text file…')}</button></div>
      <textarea className="mono" rows={12} style={{ width: '100%', boxSizing: 'border-box' }} value={text} placeholder={'Kapitel 1\t1\n\tAbschnitt 1.1\t2\nKapitel 2\t5'} onChange={(e) => setText(e.target.value)} />
      <ModeChoice mode={mode} setMode={setMode} />
    </Modal>
  );
}

function ChangeCase({ close }: { close: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<CaseMode>('title');
  const modes: [CaseMode, string][] = [['upper', 'UPPER CASE'], ['lower', 'lower case'], ['title', 'Title Case'], ['sentence', 'Sentence case']];
  return (
    <Modal title={t('Change Case of Bookmark Titles')} onClose={close} footer={<Footer close={close} ok={() => bc.changeCase(mode)} label="Apply" />}>
      {modes.map(([m, l]) => <label key={m} className="row"><input type="radio" checked={mode === m} onChange={() => setMode(m)} /> <span>{t(l)}</span></label>)}
    </Modal>
  );
}

function Replace({ close }: { close: () => void }) {
  const t = useT();
  const [find, setFind] = useState('');
  const [rep, setRep] = useState('');
  const [regex, setRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  let error = '';
  if (regex && find) {
    try {
      new RegExp(find, 'u');
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return (
    <Modal title={t('Find and Replace Bookmark Text')} onClose={close} footer={<Footer close={close} ok={() => bc.replaceInTitles(find, rep, { regex, matchCase })} label="Replace all" disabled={!find || !!error} />}>
      <Row label="Find"><input autoFocus value={find} onChange={(e) => setFind(e.target.value)} /></Row>
      <Row label="Replace with"><input value={rep} onChange={(e) => setRep(e.target.value)} /></Row>
      <label className="row"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> <span>{t('Match case')}</span></label>
      <label className="row"><input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> <span>{t('Regular expression ($1, $2… in the replacement)')}</span></label>
      {error && <p className="error-text small">{error}</p>}
    </Modal>
  );
}

function AddText({ close }: { close: () => void }) {
  const t = useT();
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  return (
    <Modal title={t('Add Text to Bookmark Titles')} onClose={close} footer={<Footer close={close} ok={() => bc.addText(prefix, suffix)} label="Apply" disabled={!prefix && !suffix} />}>
      <Row label="Before the title"><input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="{n}. " /></Row>
      <Row label="After the title"><input value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder=" (S. {page})" /></Row>
      <p className="muted small">{t('{page} is replaced by the page number, {n} by a running number.')}</p>
    </Modal>
  );
}

const PROBLEM: Record<BookmarkProblem['problem'], string> = {
  'no-destination': 'has no destination',
  'bad-page': 'points to a page that does not exist',
  'empty-title': 'has no title',
  action: 'runs an action instead of going to a page',
};

function Validate({ close }: { close: () => void }) {
  const t = useT();
  const [problems, setProblems] = useState<BookmarkProblem[] | null>(null);
  useEffect(() => {
    bc.currentOutline().then((tree) => setProblems(validateBookmarks(tree, S().pageIds.length))).catch(() => setProblems([]));
  }, []);
  return (
    <Modal title={t('Validate Bookmarks')} onClose={close} footer={<button className="primary" onClick={close}>{t('Close')}</button>}>
      {!problems ? <p className="muted">{t('Checking…')}</p> : problems.length === 0 ? <p>{t('All bookmarks are valid.')}</p> : (
        <ul className="a11y-results">
          {problems.map((p, i) => (
            <li key={i} className={p.problem === 'action' ? 'a11y-warn' : 'a11y-fail'}>
              <span className="a11y-icon">{p.problem === 'action' ? '!' : '✕'}</span>
              <div><div className="a11y-label">{p.title || t('(untitled)')}</div><div className="muted small">{t(PROBLEM[p.problem])}{p.detail ? `: ${p.detail}` : ''}</div></div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function BuildToc({ close }: { close: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(t('Contents'));
  const [levels, setLevels] = useState(2);
  const [fontSize, setFontSize] = useState(11);
  const [links, setLinks] = useState(true);
  return (
    <Modal title={t('Build Table of Contents from Bookmarks')} onClose={close} footer={<Footer close={close} ok={() => bc.buildToc({ title, levels, fontSize, links })} label="Insert" />}>
      <p className="muted small">{t('Inserts contents pages at the start of the document, with page numbers and links.')}</p>
      <Row label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Row>
      <Row label="Levels"><input type="number" min={1} max={6} value={levels} onChange={(e) => setLevels(Math.max(1, Number(e.target.value)))} /></Row>
      <Row label="Font size"><input type="number" min={6} max={24} value={fontSize} onChange={(e) => setFontSize(Math.max(6, Number(e.target.value)))} /><span>pt</span></Row>
      <label className="row"><input type="checkbox" checked={links} onChange={(e) => setLinks(e.target.checked)} /> <span>{t('Link entries to their pages')}</span></label>
    </Modal>
  );
}

export function BookmarkDialog({ name, close }: { name: BookmarkDialogName; close: () => void }) {
  switch (name) {
    case 'bmEveryNth': return <EveryNth close={close} />;
    case 'bmHeadings': return <Headings close={close} />;
    case 'bmToc': return <FromToc close={close} />;
    case 'bmText': return <FromText close={close} />;
    case 'bmCase': return <ChangeCase close={close} />;
    case 'bmReplace': return <Replace close={close} />;
    case 'bmAddText': return <AddText close={close} />;
    case 'bmValidate': return <Validate close={close} />;
    case 'bmBuildToc': return <BuildToc close={close} />;
  }
}
