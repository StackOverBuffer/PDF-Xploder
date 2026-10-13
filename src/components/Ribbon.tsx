import { useState, type ReactNode } from 'react';
import {
  FilePlus, FolderOpen, Save, SaveAll, Printer, Image as ImageIcon, Info, X, Undo2, Redo2, Hand, MousePointer2,
  ZoomIn, ZoomOut, MoveHorizontal, Maximize, Highlighter, Underline, Strikethrough, Pencil, Square, Circle, Minus,
  MoveUpRight, Type, StickyNote, Stamp, MessageSquare, Layers, RotateCcw, RotateCw, FilePlus2, FileInput, Copy, Trash2,
  FileOutput, Scissors, ArrowDownUp, Crop, ImagePlus, Signature, Droplets, Heading, FormInput, EraserIcon, ShieldCheck,
  Lock, ListChecks, KeyRound, FileSignature, FileKey2, PanelLeft, PanelRight, Keyboard, Search, ListTree, LayoutGrid,
} from 'lucide-react';
import { useStore, type SidebarTab } from '../store/store';
import { allowed, useCan } from '../store/permissions';
import * as cmd from '../store/commands';
import { useDialog } from './Dialogs';
import { STAMPS } from './PropertiesPanel';
import type { Tool } from '../lib/types';

type TabName = 'File' | 'Home' | 'Comment' | 'Organize' | 'Edit' | 'Form' | 'Protect' | 'View';
const TABS: TabName[] = ['File', 'Home', 'Comment', 'Organize', 'Edit', 'Form', 'Protect', 'View'];

function Btn({ icon, label, onClick, active, disabled, title }: { icon: ReactNode; label: string; onClick: () => void; active?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button className={`rbtn ${active ? 'active' : ''}`} onClick={onClick} disabled={disabled} title={title ?? label}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rgroup">
      <div className="rgroup-items">{children}</div>
      <div className="rgroup-label">{label}</div>
    </div>
  );
}

function ToolBtn({ tool, icon, label }: { tool: Tool; icon: ReactNode; label: string }) {
  const current = useStore((s) => s.tool);
  const hasDoc = useStore((s) => !!s.pdf);
  const viewOnly = tool === 'select' || tool === 'hand';
  const permitted = useStore((s) => allowed(s, tool === 'sign' ? 'fillForms' : tool.startsWith('field') ? 'designForms' : 'annotate'));
  return <Btn icon={icon} label={label} active={current === tool} disabled={!hasDoc || (!viewOnly && !permitted)} onClick={() => useStore.getState().setTool(current === tool && !viewOnly ? 'select' : tool)} />;
}

function SidebarBtn({ tab, icon, label }: { tab: SidebarTab; icon: ReactNode; label: string }) {
  const sidebar = useStore((s) => s.sidebar);
  return <Btn icon={icon} label={label} active={sidebar === tab} onClick={() => useStore.getState().setSidebar(sidebar === tab ? null : tab)} />;
}

const I = 18;

export function Ribbon({ showProps, toggleProps }: { showProps: boolean; toggleProps: () => void }) {
  const [tab, setTab] = useState<TabName>('Home');
  const hasDoc = useStore((s) => !!s.pdf);
  const editable = useStore((s) => s.editable);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const fileName = useStore((s) => s.fileName);
  const dirty = useStore((s) => s.dirty);
  const scale = useStore((s) => s.scale);
  const fit = useStore((s) => s.fit);
  const stampLabel = useStore((s) => s.styles.stamp.stampLabel);
  const lock = useStore((s) => !!s.lock);
  const show = useDialog((d) => d.show);
  const S = useStore.getState;
  const noDoc = !hasDoc;
  const canModify = useCan('modify');
  const canAssemble = useCan('assemble');
  const canCopy = useCan('copy');
  const canPrint = useCan('print');
  const canAnnotate = useCan('annotate');
  const canSign = useCan('fillForms');

  return (
    <header className="ribbon">
      <div className="titlebar">
        <div className="brand">Awesome&nbsp;PDF</div>
        <div className="quick">
          <button title="Open (Ctrl+O)" onClick={cmd.openFromDialog}><FolderOpen size={16} /></button>
          <button title="Save (Ctrl+S)" disabled={noDoc} onClick={cmd.save}><Save size={16} /></button>
          <button title="Print (Ctrl+P)" disabled={!canPrint} onClick={cmd.print}><Printer size={16} /></button>
          <button title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => S().undo()}><Undo2 size={16} /></button>
          <button title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => S().redo()}><Redo2 size={16} /></button>
        </div>
        <div className="doc-title">{fileName ? `${fileName}${dirty ? ' •' : ''}` : ''}{hasDoc && !editable ? ' (read-only)' : ''}</div>
      </div>
      <nav className="tabs-row" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`rtab ${tab === t ? 'active' : ''} ${t === 'File' ? 'file' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>
      <div className="rbody">
        {tab === 'File' && (
          <>
            <Group label="Document">
              <Btn icon={<FilePlus size={I} />} label="New" onClick={cmd.newDocument} />
              <Btn icon={<FolderOpen size={I} />} label="Open" onClick={cmd.openFromDialog} />
              <Btn icon={<Save size={I} />} label="Save" disabled={noDoc} onClick={cmd.save} />
              <Btn icon={<SaveAll size={I} />} label="Save as" disabled={noDoc} onClick={cmd.saveAs} />
              <Btn icon={<Layers size={I} />} label="Save flattened" title="Save a copy with comments burnt into the pages" disabled={noDoc} onClick={cmd.saveFlattenedCopy} />
              <Btn icon={<X size={I} />} label="Close" disabled={noDoc} onClick={() => (!S().dirty || confirm('Discard unsaved changes?')) && S().closeDocument()} />
            </Group>
            <Group label="Output">
              <Btn icon={<Printer size={I} />} label="Print" disabled={!canPrint} onClick={cmd.print} />
              <Btn icon={<ImageIcon size={I} />} label="Page to PNG" disabled={!canCopy} onClick={() => cmd.exportPageImage()} />
            </Group>
            <Group label="Info">
              <Btn icon={<Info size={I} />} label="Properties" disabled={noDoc} onClick={() => show('metadata')} />
            </Group>
          </>
        )}
        {tab === 'Home' && (
          <>
            <Group label="Tools">
              <ToolBtn tool="hand" icon={<Hand size={I} />} label="Hand" />
              <ToolBtn tool="select" icon={<MousePointer2 size={I} />} label="Select" />
            </Group>
            <Group label="Zoom">
              <Btn icon={<ZoomOut size={I} />} label="Out" disabled={noDoc} onClick={() => S().setScale(scale / 1.2)} />
              <Btn icon={<ZoomIn size={I} />} label="In" disabled={noDoc} onClick={() => S().setScale(scale * 1.2)} />
              <Btn icon={<MoveHorizontal size={I} />} label="Fit width" active={fit === 'width'} disabled={noDoc} onClick={() => S().setScale(scale, 'width')} />
              <Btn icon={<Maximize size={I} />} label="Fit page" active={fit === 'page'} disabled={noDoc} onClick={() => S().setScale(scale, 'page')} />
            </Group>
            <Group label="Comment">
              <ToolBtn tool="highlight" icon={<Highlighter size={I} />} label="Highlight" />
              <ToolBtn tool="text" icon={<Type size={I} />} label="Text box" />
              <ToolBtn tool="note" icon={<StickyNote size={I} />} label="Note" />
            </Group>
            <Group label="Find">
              <Btn icon={<Search size={I} />} label="Search" disabled={noDoc} onClick={() => S().setSidebar('search')} />
            </Group>
            <Group label="Pages">
              <Btn icon={<RotateCcw size={I} />} label="Rotate left" disabled={!canAssemble} onClick={() => cmd.rotate(-90)} />
              <Btn icon={<RotateCw size={I} />} label="Rotate right" disabled={!canAssemble} onClick={() => cmd.rotate(90)} />
            </Group>
          </>
        )}
        {tab === 'Comment' && (
          <>
            <Group label="Text markup">
              <ToolBtn tool="highlight" icon={<Highlighter size={I} />} label="Highlight" />
              <ToolBtn tool="underline" icon={<Underline size={I} />} label="Underline" />
              <ToolBtn tool="strikeout" icon={<Strikethrough size={I} />} label="Strikeout" />
            </Group>
            <Group label="Drawing">
              <ToolBtn tool="ink" icon={<Pencil size={I} />} label="Pencil" />
              <ToolBtn tool="rect" icon={<Square size={I} />} label="Rectangle" />
              <ToolBtn tool="ellipse" icon={<Circle size={I} />} label="Ellipse" />
              <ToolBtn tool="line" icon={<Minus size={I} />} label="Line" />
              <ToolBtn tool="arrow" icon={<MoveUpRight size={I} />} label="Arrow" />
            </Group>
            <Group label="Text">
              <ToolBtn tool="text" icon={<Type size={I} />} label="Text box" />
              <ToolBtn tool="note" icon={<StickyNote size={I} />} label="Note" />
            </Group>
            <Group label="Stamp">
              <ToolBtn tool="stamp" icon={<Stamp size={I} />} label="Stamp" />
              <select className="rselect" disabled={!canAnnotate} value={stampLabel} onChange={(e) => { S().setStyle('stamp', { stampLabel: e.target.value }); S().setTool('stamp'); }}>
                {STAMPS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Group>
            <Group label="Manage">
              <SidebarBtn tab="comments" icon={<MessageSquare size={I} />} label="Comments" />
              <Btn icon={<Layers size={I} />} label="Flatten" disabled={!canModify} onClick={cmd.flattenAnnotations} />
            </Group>
          </>
        )}
        {tab === 'Organize' && (
          <>
            <Group label="Rotate">
              <Btn icon={<RotateCcw size={I} />} label="Left" disabled={!canAssemble} onClick={() => cmd.rotate(-90)} />
              <Btn icon={<RotateCw size={I} />} label="Right" disabled={!canAssemble} onClick={() => cmd.rotate(90)} />
            </Group>
            <Group label="Insert">
              <Btn icon={<FilePlus2 size={I} />} label="Blank page" disabled={!canAssemble} onClick={() => cmd.insertBlank()} />
              <Btn icon={<FileInput size={I} />} label="From file" disabled={!canAssemble} onClick={() => cmd.insertFromFile()} />
              <Btn icon={<Copy size={I} />} label="Duplicate" disabled={!canAssemble} onClick={() => cmd.duplicate()} />
            </Group>
            <Group label="Pages">
              <Btn icon={<Trash2 size={I} />} label="Delete" disabled={!canAssemble} onClick={() => cmd.deletePages()} />
              <Btn icon={<FileOutput size={I} />} label="Extract" disabled={!canCopy} onClick={() => cmd.extract()} />
              <Btn icon={<Scissors size={I} />} label="Split" disabled={!canCopy} onClick={() => show('split')} />
              <Btn icon={<ArrowDownUp size={I} />} label="Reverse" disabled={!canAssemble} onClick={cmd.reverseOrder} />
              <Btn icon={<Crop size={I} />} label="Crop" disabled={!canModify} onClick={() => show('crop')} />
            </Group>
            <Group label="View">
              <SidebarBtn tab="pages" icon={<LayoutGrid size={I} />} label="Thumbnails" />
            </Group>
          </>
        )}
        {tab === 'Edit' && (
          <>
            <Group label="Add content">
              <ToolBtn tool="text" icon={<Type size={I} />} label="Text" />
              <Btn icon={<ImagePlus size={I} />} label="Image" disabled={!canAnnotate} onClick={cmd.insertImageFromFile} />
              <Btn icon={<Signature size={I} />} label="Signature" disabled={!canAnnotate} onClick={() => show('signature')} />
            </Group>
            <Group label="Page marks">
              <Btn icon={<Droplets size={I} />} label="Watermark" disabled={!canModify} onClick={() => show('watermark')} />
              <Btn icon={<Heading size={I} />} label="Header/Footer" disabled={!canModify} onClick={() => show('headerFooter')} />
            </Group>
          </>
        )}
        {tab === 'Form' && (
          <>
            <Group label="Fill">
              <SidebarBtn tab="forms" icon={<FormInput size={I} />} label="Form fields" />
            </Group>
          </>
        )}
        {tab === 'Protect' && (
          <>
            <Group label="Redaction">
              <ToolBtn tool="redact" icon={<EraserIcon size={I} />} label="Mark area" />
              <Btn icon={<ShieldCheck size={I} />} label="Apply" disabled={!canModify} onClick={cmd.applyRedactions} />
            </Group>
            <Group label="Security">
              <Btn icon={<Lock size={I} />} label="Password" disabled={noDoc} title="Passwords and encryption" onClick={() => show('security')} />
              <Btn icon={<ListChecks size={I} />} label="Permissions" disabled={noDoc} title="What others may do with the document" onClick={() => show('permissions')} />
              {lock && <Btn icon={<KeyRound size={I} />} label="Unlock" onClick={() => show('security')} />}
            </Group>
            <Group label="Digital signatures">
              <ToolBtn tool="sign" icon={<FileSignature size={I} />} label="Sign" />
              <Btn icon={<FileKey2 size={I} />} label="Sign invisibly" disabled={!canSign} onClick={() => show('sign')} />
              <SidebarBtn tab="signatures" icon={<ShieldCheck size={I} />} label="Signatures" />
            </Group>
          </>
        )}
        {tab === 'View' && (
          <>
            <Group label="Panes">
              <SidebarBtn tab="pages" icon={<LayoutGrid size={I} />} label="Thumbnails" />
              <SidebarBtn tab="outline" icon={<ListTree size={I} />} label="Bookmarks" />
              <SidebarBtn tab="comments" icon={<MessageSquare size={I} />} label="Comments" />
              <SidebarBtn tab="search" icon={<Search size={I} />} label="Search" />
              <Btn icon={<PanelLeft size={I} />} label="Sidebar" onClick={() => S().setSidebar(S().sidebar ? null : 'pages')} />
              <Btn icon={<PanelRight size={I} />} label="Properties" active={showProps} onClick={toggleProps} />
            </Group>
            <Group label="Zoom">
              {[0.5, 1, 1.5, 2].map((z) => <Btn key={z} icon={<span className="zoom-chip">{z * 100}%</span>} label="" disabled={noDoc} active={!fit && Math.abs(scale - z) < 0.01} onClick={() => S().setScale(z)} />)}
            </Group>
            <Group label="Help">
              <Btn icon={<Keyboard size={I} />} label="Shortcuts" onClick={() => show('shortcuts')} />
            </Group>
          </>
        )}
      </div>
    </header>
  );
}
