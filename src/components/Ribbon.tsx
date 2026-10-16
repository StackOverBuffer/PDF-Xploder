import { useLayoutEffect, useRef, useState } from 'react';
import {
  MonitorDown, FilePlus, FolderOpen, Save, SaveAll, Printer, Image as ImageIcon, Info, X, Undo2, Redo2, Hand, MousePointer2,
  ZoomIn, ZoomOut, MoveHorizontal, Maximize, Highlighter, Underline, Strikethrough, Pencil, Square, Circle, Minus,
  MoveUpRight, Type, StickyNote, Stamp, MessageSquare, Layers, RotateCcw, RotateCw,
  ImagePlus, Signature, FormInput, EraserIcon, ShieldCheck, Pentagon, Spline, Cloud,
  Lock, LockOpen, PencilLine, ListChecks, SquareDashedMousePointer, TypeOutline, PencilRuler, TextCursorInput, SquareCheck,
  CircleDot, ChevronDownSquare, List, KeyRound, FileSignature, FileKey2, PanelLeft, PanelRight, Keyboard, Search, ListTree,
  LayoutGrid, ChevronDown, TextSelect, Camera, Clipboard, ClipboardCopy, ClipboardPaste, Bookmark, Paperclip, SquarePlus,
  BoxSelect, Share2, Accessibility, Volume2, VolumeX, Contrast, Languages, FileImage, ChevronUp, ScanText,
} from 'lucide-react';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import * as cmd from '../store/commands';
import * as extra from '../store/extras';
import { selectContent, type ContentFilter } from '../store/content';
import { useDialog } from './Dialogs';
import { STAMPS } from './PropertiesPanel';
import { goToHit } from './SearchPanel';
import { OrganizeTab } from './OrganizeTab';
import { BookmarksTab } from './BookmarksTab';
import { customStamps, deleteCustomStamp, placeCustomStamp, usePendingStamp } from '../store/contentActions';
import { tr, useLang, useT } from '../lib/i18n';
import { installApp, usePwa } from '../lib/pwa';
import { Btn, Group, I, L, Row, SidebarBtn, Stack, ToolBtn, ZoomBox, type MenuItem } from './ribbonParts';

type TabName = 'File' | 'Home' | 'View' | 'Comment' | 'Protect' | 'Form' | 'Organize' | 'Convert' | 'Share' | 'Review' | 'Accessibility' | 'Bookmarks' | 'Help';
const TABS: TabName[] = ['File', 'Home', 'View', 'Comment', 'Protect', 'Form', 'Organize', 'Convert', 'Share', 'Review', 'Accessibility', 'Bookmarks', 'Help'];

const S = useStore.getState;


export function Ribbon({ showProps, toggleProps }: { showProps: boolean; toggleProps: () => void }) {
  const t = useT();
  const lang = useLang((l) => l.lang);
  const setLang = useLang((l) => l.setLang);
  const [tab, setTab] = useState<TabName>('Home');
  // Like PDF-XChange, squeeze the ribbon when the window is too narrow: first tighter buttons,
  // then small buttons lose their labels group by group, from the right.
  const bodyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const fits = () => el.scrollWidth <= el.clientWidth + 1;
    const fit = () => {
      const groups = [...el.querySelectorAll<HTMLElement>(':scope > .rgroup')];
      el.dataset.compact = '0';
      groups.forEach((g) => delete g.dataset.icons);
      if (fits()) return;
      el.dataset.compact = '1';
      for (const g of groups.reverse()) {
        if (fits()) return;
        if (g.querySelector('.rbtn.size-small .rlabel')) g.dataset.icons = '';
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab, lang]);
  const hasDoc = useStore((s) => !!s.pdf);
  const editable = useStore((s) => s.editable);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const fileName = useStore((s) => s.fileName);
  const dirty = useStore((s) => s.dirty);
  const scale = useStore((s) => s.scale);
  const fit = useStore((s) => s.fit);
  const tool = useStore((s) => s.tool);
  const stampLabel = useStore((s) => s.styles.stamp.stampLabel);
  const lock = useStore((s) => !!s.lock);
  const hits = useStore((s) => s.search.hits.length);
  const hitIndex = useStore((s) => s.search.index);
  const show = useDialog((d) => d.show);
  const reading = extra.useExtras((x) => x.reading);
  const invert = extra.useExtras((x) => x.invert);
  const noDoc = !hasDoc;
  const installPrompt = usePwa((p) => !!p.prompt);
  const installed = usePwa((p) => p.installed);
  const canModify = useCan('modify');
  const canCopy = useCan('copy');
  const canPrint = useCan('print');
  const canAnnotate = useCan('annotate');
  const canSign = useCan('fillForms');
  const canDesign = useCan('designForms');
  const formDesign = useStore((s) => s.formDesign);
  const contentFilter = useStore((s) => s.contentFilter);
  const highlightFields = useStore((s) => s.highlightFields);

  const editObjects = (f: ContentFilter) => {
    useStore.setState({ contentFilter: f, contentSelection: null });
    S().setTool('content');
  };
  const contentTool = tool === 'content';
  const objectMenu: MenuItem[] = [
    { label: 'All objects', icon: <SquareDashedMousePointer size={14} />, checked: contentTool && contentFilter === 'all', onClick: () => editObjects('all') },
    { label: 'Text objects', icon: <Type size={14} />, checked: contentTool && contentFilter === 'text', onClick: () => editObjects('text') },
    { label: 'Image objects', icon: <ImageIcon size={14} />, checked: contentTool && contentFilter === 'image', onClick: () => editObjects('image') },
    { label: 'Shape objects', icon: <Square size={14} />, checked: contentTool && contentFilter === 'shape', onClick: () => editObjects('shape') },
  ];
  const addMenu: MenuItem[] = [
    { label: 'Text', icon: <TypeOutline size={14} />, disabled: !canModify, onClick: () => S().setTool('contentText') },
    { label: 'Image', icon: <ImagePlus size={14} />, disabled: !canModify, onClick: cmd.addContentImage },
    null,
    { label: 'Rectangle', icon: <Square size={14} />, disabled: !canModify, onClick: () => S().setTool('contentRect') },
    { label: 'Ellipse', icon: <Circle size={14} />, disabled: !canModify, onClick: () => S().setTool('contentEllipse') },
    { label: 'Line', icon: <Minus size={14} />, disabled: !canModify, onClick: () => S().setTool('contentLine') },
  ];
  const selectMenu: MenuItem[] = [
    { label: 'Select all', icon: <BoxSelect size={14} />, hint: 'Ctrl+A', onClick: () => selectContent('all') },
    { label: 'Invert selection', onClick: () => selectContent('invert') },
    { label: 'Select none', hint: 'Esc', onClick: () => selectContent('none') },
  ];

  return (
    <header className="ribbon">
      <div className="titlebar">
        <div className="brand">PDF-Xploder</div>
        <div className="quick">
          <button title={`${t('Open')} (Ctrl+O)`} onClick={cmd.openFromDialog}><FolderOpen size={16} /></button>
          <button title={`${t('Save')} (Ctrl+S)`} disabled={noDoc} onClick={cmd.save}><Save size={16} /></button>
          <button title={`${t('Print')} (Ctrl+P)`} disabled={!canPrint} onClick={cmd.print}><Printer size={16} /></button>
          <button title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => S().run('Undoing…', () => S().undo())}><Undo2 size={16} /></button>
          <button title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => S().run('Redoing…', () => S().redo())}><Redo2 size={16} /></button>
        </div>
        <div className="doc-title">{fileName ? `${fileName}${dirty ? ' •' : ''}` : ''}{hasDoc && !editable ? ' (read-only)' : ''}</div>
      </div>
      <nav className="tabs-row" role="tablist">
        {TABS.map((n) => (
          <button key={n} role="tab" aria-selected={tab === n} className={`rtab ${tab === n ? 'active' : ''} ${n === 'File' ? 'file' : ''}`} onClick={() => setTab(n)}>{t(n)}</button>
        ))}
      </nav>
      <div className="rbody" role="tabpanel" ref={bodyRef}>
        {tab === 'File' && (
          <>
            <Group label="Document">
              <Btn icon={<FilePlus size={L} />} label="New" onClick={cmd.newDocument} />
              <Btn icon={<FolderOpen size={L} />} label="Open" onClick={cmd.openFromDialog} />
              <Btn icon={<Save size={L} />} label="Save" disabled={noDoc} onClick={cmd.save} />
              <Btn icon={<SaveAll size={L} />} label="Save as" disabled={noDoc} onClick={cmd.saveAs} />
              <Btn icon={<X size={L} />} label="Close" disabled={noDoc} onClick={() => S().closeTab(S().activeTab)} />
            </Group>
            <Group label="Output">
              <Btn icon={<Printer size={L} />} label="Print" disabled={!canPrint} onClick={cmd.print} />
              <Btn icon={<Share2 size={L} />} label="Share file" disabled={noDoc} onClick={extra.shareFile} />
            </Group>
            <Group label="Info">
              <Btn icon={<Info size={L} />} label="Properties" disabled={noDoc} onClick={() => show('metadata')} />
            </Group>
            {!installed && (
              <Group label="App">
                <Btn
                  icon={<MonitorDown size={L} />}
                  label="Install app"
                  disabled={!installPrompt}
                  title={installPrompt ? 'Own window, works offline and opens PDFs from your computer' : 'Your browser does not offer installation here (Chrome and Edge do; on other browsers use “Add to Home Screen” or similar)'}
                  onClick={() => installApp()}
                />
              </Group>
            )}
          </>
        )}
        {tab === 'Home' && (
          <>
            <Group label="Tools">
              <ToolBtn tool="hand" icon={<Hand size={L} />} label="Hand" keys="H" />
              <ToolBtn tool="selectText" icon={<TextSelect size={L} />} label="Select Text" keys="X" />
              <ToolBtn tool="select" icon={<MousePointer2 size={L} />} label="Edit Comments" keys="V" />
              <Stack>
                <ToolBtn tool="snapshot" size="small" icon={<Camera size={I} />} label="Snapshot" keys="G" menu={[
                  { label: 'Snapshot tool', icon: <Camera size={14} />, hint: 'G', disabled: !canCopy, onClick: () => S().setTool('snapshot') },
                  { label: 'Copy page as image', icon: <ClipboardCopy size={14} />, disabled: !canCopy, onClick: () => extra.copyPageImage() },
                  { label: 'Save page as image', icon: <FileImage size={14} />, disabled: !canCopy, onClick: () => cmd.exportPageImage() },
                ]} />
                <Btn size="small" icon={<Clipboard size={I} />} label="Clipboard" disabled={noDoc} menu={[
                  { label: 'Copy selected text', icon: <ClipboardCopy size={14} />, hint: 'Ctrl+C', disabled: !canCopy, onClick: extra.copySelectedText },
                  { label: 'Copy page as image', icon: <ImageIcon size={14} />, disabled: !canCopy, onClick: () => extra.copyPageImage() },
                  null,
                  { label: 'Paste image as comment', icon: <ClipboardPaste size={14} />, disabled: !canAnnotate, onClick: extra.pasteImage },
                ]} />
                <Btn size="small" icon={<Search size={I} />} label="Find" disabled={noDoc} menu={[
                  { label: 'Find…', icon: <Search size={14} />, hint: 'Ctrl+F', onClick: () => { S().setSidebar('search'); requestAnimationFrame(() => window.dispatchEvent(new Event('awesome-pdf:focus-search'))); } },
                  { label: 'Next result', icon: <ChevronDown size={14} />, disabled: !hits, onClick: () => goToHit(hitIndex + 1) },
                  { label: 'Previous result', icon: <ChevronUp size={14} />, disabled: !hits, onClick: () => goToHit(hitIndex - 1) },
                ]} />
              </Stack>
            </Group>
            <Group label="View">
              <Stack>
                <Row>
                  <Btn size="icon" icon={<ZoomOut size={I} />} label="Zoom out" keys="Ctrl −" disabled={noDoc} onClick={() => S().setScale(scale / 1.2)} />
                  <ZoomBox />
                  <Btn size="icon" icon={<ZoomIn size={I} />} label="Zoom in" keys="Ctrl +" disabled={noDoc} onClick={() => S().setScale(scale * 1.2)} />
                </Row>
                <Row>
                  <Btn size="icon" icon={<span className="one-to-one">1:1</span>} label="Actual size" active={!fit && Math.abs(scale - 1) < 0.001} disabled={noDoc} onClick={() => S().setScale(1)} />
                  <Btn size="icon" icon={<Maximize size={I} />} label="Fit page" active={fit === 'page'} disabled={noDoc} onClick={() => S().setScale(scale, 'page')} />
                  <Btn size="icon" icon={<MoveHorizontal size={I} />} label="Fit width" keys="Ctrl+0" active={fit === 'width'} disabled={noDoc} onClick={() => S().setScale(scale, 'width')} />
                  <Btn size="icon" icon={<RotateCcw size={I} />} label="Rotate view left" disabled={noDoc} onClick={() => S().rotateView(-90)} />
                  <Btn size="icon" icon={<RotateCw size={I} />} label="Rotate view right" disabled={noDoc} onClick={() => S().rotateView(90)} />
                </Row>
                <Row>
                  <SidebarBtn size="icon" tab="outline" icon={<Bookmark size={I} />} label="Bookmarks" />
                  <SidebarBtn size="icon" tab="pages" icon={<LayoutGrid size={I} />} label="Thumbnails" />
                  <SidebarBtn size="icon" tab="comments" icon={<MessageSquare size={I} />} label="Comments" />
                  <SidebarBtn size="icon" tab="attachments" icon={<Paperclip size={I} />} label="Attachments" />
                  <SidebarBtn size="icon" tab="forms" icon={<FormInput size={I} />} label="Form fields" />
                </Row>
              </Stack>
            </Group>
            <Group label="Objects">
              <Btn icon={<Type size={L} />} label="Edit Text" active={contentTool && contentFilter === 'text'} disabled={noDoc} onClick={() => editObjects('text')} />
              <Btn icon={<SquareDashedMousePointer size={L} />} label="Edit Objects" active={contentTool && contentFilter !== 'text'} disabled={noDoc} onClick={() => editObjects(contentFilter === 'text' ? 'all' : contentFilter)} menu={objectMenu} />
              <Btn icon={<SquarePlus size={L} />} label="Add" active={tool === 'contentText' || tool === 'contentRect' || tool === 'contentEllipse' || tool === 'contentLine'} disabled={!canModify} menu={addMenu} />
              <Btn icon={<BoxSelect size={L} />} label="Select" disabled={noDoc} menu={selectMenu} />
            </Group>
          </>
        )}
        {tab === 'View' && (
          <>
            <Group label="Panes">
              <SidebarBtn tab="pages" icon={<LayoutGrid size={L} />} label="Thumbnails" />
              <SidebarBtn tab="outline" icon={<ListTree size={L} />} label="Bookmarks" />
              <SidebarBtn tab="comments" icon={<MessageSquare size={L} />} label="Comments" />
              <SidebarBtn tab="attachments" icon={<Paperclip size={L} />} label="Attachments" />
              <SidebarBtn tab="search" icon={<Search size={L} />} label="Search" />
              <Stack>
                <Btn size="small" icon={<PanelLeft size={I} />} label="Sidebar" disabled={noDoc} onClick={() => S().setSidebar(S().sidebar ? null : 'pages')} />
                <Btn size="small" icon={<PanelRight size={I} />} label="Properties" active={showProps} onClick={toggleProps} />
              </Stack>
            </Group>
            <Group label="Zoom">
              <Stack>
                <Row>
                  <Btn size="icon" icon={<ZoomOut size={I} />} label="Zoom out" disabled={noDoc} onClick={() => S().setScale(scale / 1.2)} />
                  <ZoomBox />
                  <Btn size="icon" icon={<ZoomIn size={I} />} label="Zoom in" disabled={noDoc} onClick={() => S().setScale(scale * 1.2)} />
                </Row>
                <Btn size="small" icon={<Maximize size={I} />} label="Fit page" active={fit === 'page'} disabled={noDoc} onClick={() => S().setScale(scale, 'page')} />
                <Btn size="small" icon={<MoveHorizontal size={I} />} label="Fit width" active={fit === 'width'} disabled={noDoc} onClick={() => S().setScale(scale, 'width')} />
              </Stack>
            </Group>
            <Group label="Rotate">
              <Btn icon={<RotateCcw size={L} />} label="Rotate view left" disabled={noDoc} onClick={() => S().rotateView(-90)} />
              <Btn icon={<RotateCw size={L} />} label="Rotate view right" disabled={noDoc} onClick={() => S().rotateView(90)} />
            </Group>
            <Group label="Language">
              <Btn icon={<Languages size={L} />} label={lang === 'de' ? 'Deutsch' : 'English'} menu={[
                { label: 'Deutsch', checked: lang === 'de', onClick: () => setLang('de') },
                { label: 'English', checked: lang === 'en', onClick: () => setLang('en') },
              ]} />
            </Group>
            <Group label="Help">
              <Btn icon={<Keyboard size={L} />} label="Shortcuts" onClick={() => show('shortcuts')} />
            </Group>
          </>
        )}
        {tab === 'Comment' && (
          <>
            <Group label="Text markup">
              <ToolBtn tool="highlight" icon={<Highlighter size={L} />} label="Highlight" />
              <ToolBtn tool="underline" icon={<Underline size={L} />} label="Underline" />
              <ToolBtn tool="strikeout" icon={<Strikethrough size={L} />} label="Strikeout" />
            </Group>
            <Group label="Drawing">
              <ToolBtn tool="ink" icon={<Pencil size={L} />} label="Pencil" />
              <ToolBtn tool="rect" icon={<Square size={L} />} label="Rectangle" />
              <ToolBtn tool="ellipse" icon={<Circle size={L} />} label="Ellipse" />
              <Stack>
                <ToolBtn size="small" tool="line" icon={<Minus size={I} />} label="Line" />
                <ToolBtn size="small" tool="arrow" icon={<MoveUpRight size={I} />} label="Arrow" />
              </Stack>
              <Stack>
                <ToolBtn size="small" tool="polygon" icon={<Pentagon size={I} />} label="Polygon" />
                <ToolBtn size="small" tool="polyline" icon={<Spline size={I} />} label="Polyline" />
                <ToolBtn size="small" tool="cloud" icon={<Cloud size={I} />} label="Cloud" />
              </Stack>
            </Group>
            <Group label="Text">
              <ToolBtn tool="text" icon={<Type size={L} />} label="Text box" />
              <ToolBtn tool="note" icon={<StickyNote size={L} />} label="Note" />
            </Group>
            <Group label="Stamp">
              <ToolBtn tool="stamp" icon={<Stamp size={L} />} label="Stamp" menu={() => {
                const custom = customStamps();
                return [
                  ...STAMPS.map((l): MenuItem => ({ label: l, checked: stampLabel === l, onClick: () => { usePendingStamp.setState({ stamp: null }); S().setStyle('stamp', { stampLabel: l }); S().setTool('stamp'); } })),
                  null,
                  ...(custom.length
                    ? custom.map((c): MenuItem => ({ label: c.name, icon: <img className="stamp-thumb" src={c.src} alt="" />, disabled: !canAnnotate, onClick: () => placeCustomStamp(c) }))
                    : [{ label: 'No custom stamps yet', disabled: true, hint: 'Right-click objects → New Stamp from Selection' } as MenuItem]),
                  ...(custom.length ? [{ label: 'Delete custom stamp', submenu: custom.map((c): MenuItem => ({ label: c.name, onClick: () => confirm(`${tr('Delete')} “${c.name}”?`) && deleteCustomStamp(c.id) })) } as MenuItem] : []),
                ];
              }} />
              <Stack>
                <Btn size="small" icon={<ImagePlus size={I} />} label="Image" disabled={!canAnnotate} onClick={cmd.insertImageFromFile} />
                <Btn size="small" icon={<Signature size={I} />} label="Signature" disabled={!canAnnotate} onClick={() => show('signature')} />
              </Stack>
            </Group>
            <Group label="Manage">
              <SidebarBtn tab="comments" icon={<MessageSquare size={L} />} label="Comments" />
              <Btn icon={<Layers size={L} />} label="Flatten" disabled={!canModify} onClick={cmd.flattenAnnotations} />
            </Group>
          </>
        )}
        {tab === 'Protect' && (
          <>
            <Group label="Redaction">
              <ToolBtn tool="redact" icon={<EraserIcon size={L} />} label="Mark area" />
              <Btn icon={<ShieldCheck size={L} />} label="Apply" disabled={!canModify} onClick={cmd.applyRedactions} />
            </Group>
            <Group label="Security">
              <Btn icon={<Lock size={L} />} label="Password" disabled={noDoc} title="Passwords and encryption" onClick={() => show('security')} />
              <Btn icon={<ListChecks size={L} />} label="Permissions" disabled={noDoc} title="What others may do with the document" onClick={() => show('permissions')} />
              {lock && <Btn icon={<KeyRound size={L} />} label="Unlock" onClick={() => show('security')} />}
            </Group>
            <Group label="Digital signatures">
              <ToolBtn tool="sign" icon={<FileSignature size={L} />} label="Sign" />
              <Btn icon={<FileKey2 size={L} />} label="Sign invisibly" disabled={!canSign} onClick={() => show('sign')} />
              <SidebarBtn tab="signatures" icon={<ShieldCheck size={L} />} label="Signatures" />
            </Group>
          </>
        )}
        {tab === 'Form' && (
          <>
            <Group label="Fill">
              <SidebarBtn tab="forms" icon={<FormInput size={L} />} label="Form fields" />
              <Btn icon={<Highlighter size={L} />} label="Highlight" active={highlightFields} disabled={noDoc} onClick={() => useStore.setState({ highlightFields: !highlightFields })} />
            </Group>
            <Group label="Design">
              <Btn icon={<PencilRuler size={L} />} label="Edit form" active={formDesign} disabled={!canDesign} title="Select, move and change form fields" onClick={() => useStore.setState({ formDesign: !formDesign, selectedField: null })} />
              <ToolBtn tool="fieldText" icon={<TextCursorInput size={L} />} label="Text field" />
              <ToolBtn tool="fieldCheckbox" icon={<SquareCheck size={L} />} label="Check box" />
              <ToolBtn tool="fieldRadio" icon={<CircleDot size={L} />} label="Radio" />
              <Stack>
                <ToolBtn size="small" tool="fieldDropdown" icon={<ChevronDownSquare size={I} />} label="Dropdown" />
                <ToolBtn size="small" tool="fieldList" icon={<List size={I} />} label="List box" />
              </Stack>
            </Group>
            <Group label="Lock">
              <Btn icon={<PencilLine size={L} />} label="Make editable" disabled={!canDesign} title="Clear read-only, value locks and Locked on every field" onClick={() => cmd.makeAllFieldsEditable()} />
              <Stack>
                <Btn size="small" icon={<LockOpen size={I} />} label="Unlock all" disabled={!canDesign} title="Clear only the Locked property of every field" onClick={() => cmd.setAllFieldsLocked(false)} />
                <Btn size="small" icon={<Lock size={I} />} label="Lock all" disabled={!canDesign} title="Set the Locked property on every field" onClick={() => cmd.setAllFieldsLocked(true)} />
              </Stack>
            </Group>
            <Group label="Finish">
              <Btn icon={<Layers size={L} />} label="Flatten form" disabled={!canModify} onClick={() => confirm('Flatten the form? Fields will no longer be editable.') && cmd.fillForm(true)} />
            </Group>
          </>
        )}
        {tab === 'Organize' && <OrganizeTab />}
        {tab === 'Bookmarks' && <BookmarksTab />}
        {tab === 'Help' && (
          <>
            <Group label="Help">
              <Btn icon={<Keyboard size={L} />} label="Shortcuts" onClick={() => show('shortcuts')} />
              <Btn icon={<ListChecks size={L} />} label="Feature roadmap" title="Which PDF-XChange features are available" onClick={() => window.open('https://github.com/StackOverBuffer/PDF-Xploder/blob/HEAD/ROADMAP.md', '_blank', 'noopener')} />
              <Btn icon={<MessageSquare size={L} />} label="Report a problem" onClick={() => window.open('https://github.com/StackOverBuffer/PDF-Xploder/issues/new', '_blank', 'noopener')} />
            </Group>
            <Group label="Language">
              <Btn icon={<Languages size={L} />} label={lang === 'de' ? 'Deutsch' : 'English'} menu={[
                { label: 'Deutsch', checked: lang === 'de', onClick: () => setLang('de') },
                { label: 'English', checked: lang === 'en', onClick: () => setLang('en') },
              ]} />
            </Group>
          </>
        )}
        {tab === 'Convert' && (
          <>
            <Group label="OCR">
              <Btn icon={<ScanText size={L} />} label="OCR Pages" title="Recognise text in scanned pages (runs locally in the browser)" disabled={!canModify} onClick={() => show('ocr')} />
            </Group>
            <Group label="Convert">
              <Btn icon={<FileImage size={L} />} label="To image" title="Save the current page as a PNG image" disabled={!canCopy} onClick={() => cmd.exportPageImage()} />
              <ToolBtn tool="snapshot" icon={<Camera size={L} />} label="Region to image" title="Drag a box to copy that part of the page as an image" />
            </Group>
            <Group label="Flatten">
              <Btn icon={<Layers size={L} />} label="Flatten comments" disabled={!canModify} onClick={cmd.flattenAnnotations} />
              <Btn icon={<FormInput size={L} />} label="Flatten form" disabled={!canModify} onClick={() => confirm('Flatten the form? Fields will no longer be editable.') && cmd.fillForm(true)} />
              <Btn icon={<SaveAll size={L} />} label="Flattened copy" title="Save a copy with comments burnt into the pages" disabled={noDoc} onClick={cmd.saveFlattenedCopy} />
            </Group>
          </>
        )}
        {tab === 'Share' && (
          <>
            <Group label="Send">
              <Btn icon={<Share2 size={L} />} label="Share file" title="Send the PDF with another app (mail, messenger…)" disabled={noDoc} onClick={extra.shareFile} />
              <Btn icon={<SaveAll size={L} />} label="Download" disabled={noDoc} onClick={cmd.saveAs} />
              <Btn icon={<Printer size={L} />} label="Print" disabled={!canPrint} onClick={cmd.print} />
            </Group>
            <Group label="Attachments">
              <Btn icon={<Paperclip size={L} />} label="Attach file" disabled={!canModify} onClick={extra.attachFiles} />
              <SidebarBtn tab="attachments" icon={<ListTree size={L} />} label="Attachments" />
            </Group>
          </>
        )}
        {tab === 'Review' && (
          <>
            <Group label="Comments">
              <SidebarBtn tab="comments" icon={<MessageSquare size={L} />} label="Comments list" />
              <ToolBtn tool="note" icon={<StickyNote size={L} />} label="Note" />
              <ToolBtn tool="highlight" icon={<Highlighter size={L} />} label="Highlight" />
            </Group>
            <Group label="Signatures">
              <SidebarBtn tab="signatures" icon={<ShieldCheck size={L} />} label="Validate" />
            </Group>
            <Group label="Document">
              <SidebarBtn tab="search" icon={<Search size={L} />} label="Search" />
              <Btn icon={<Info size={L} />} label="Document properties" disabled={noDoc} onClick={() => show('metadata')} />
            </Group>
          </>
        )}
        {tab === 'Accessibility' && (
          <>
            <Group label="Check">
              <Btn icon={<Accessibility size={L} />} label="Accessibility check" disabled={noDoc} onClick={() => show('accessibility')} />
            </Group>
            <Group label="Reading">
              <Btn icon={reading ? <VolumeX size={L} /> : <Volume2 size={L} />} label={reading ? 'Stop reading' : 'Read aloud'} active={reading} disabled={noDoc} onClick={extra.toggleReadAloud} />
            </Group>
            <Group label="Display">
              <Btn icon={<Contrast size={L} />} label="Invert colours" active={invert} disabled={noDoc} onClick={extra.toggleInvert} />
            </Group>
          </>
        )}
      </div>
    </header>
  );
}
