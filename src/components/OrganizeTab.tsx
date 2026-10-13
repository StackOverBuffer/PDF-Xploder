import {
  Hand, TextSelect, Wrench, MousePointer2, Camera, ZoomIn, SquareDashedMousePointer, FilePlus2, FileInput, ImagePlus, ClipboardPaste,
  Trash2, FileX2, FileOutput, ArrowRightLeft, Combine, Split, Copy, Replace, Repeat2, Layers, Shrink, CopyCheck, ArrowDownUp, RotateCcw,
  RotateCw, RefreshCcw, Crop, ScanLine, Scaling, Frame, Droplets, Eraser, PaintBucket, PanelTop, Hash, ListOrdered, Files, Bookmark,
  FileStack, SquareSplitVertical,
} from 'lucide-react';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import * as cmd from '../store/commands';
import * as oc from '../store/organizeCommands';
import { useDialog, type DialogName } from './Dialogs';
import { Btn, Group, I, L, Stack, ToolBtn, type MenuItem } from './ribbonParts';
import type { Tool } from '../lib/types';

const S = useStore.getState;
const M = 14; // menu icon size

/** The Organize ("Dokumentaufbau") ribbon tab, laid out like PDF-XChange Editor's. */
export function OrganizeTab() {
  const show = useDialog((d) => d.show);
  const tool = useStore((s) => s.tool);
  const hasDoc = useStore((s) => !!s.pdf);
  const canModify = useCan('modify');
  const canAssemble = useCan('assemble');
  const canCopy = useCan('copy');
  const open = (d: DialogName, payload?: unknown) => () => show(d, payload);

  const toolItem = (t: Tool, label: string, icon: JSX.Element, hint?: string, disabled = !hasDoc): MenuItem => ({ label, icon, hint, disabled, checked: tool === t, onClick: () => S().setTool(t) });
  const otherTools: MenuItem[] = [
    toolItem('select', 'Edit Comments', <MousePointer2 size={M} />, 'V'),
    toolItem('snapshot', 'Snapshot', <Camera size={M} />, 'G', !canCopy),
    toolItem('zoom', 'Zoom', <ZoomIn size={M} />),
    toolItem('content', 'Edit Objects', <SquareDashedMousePointer size={M} />),
  ];
  const marks = (add: () => void, addLabel: string, remove: () => void, removeLabel: string): MenuItem[] => [
    { label: addLabel, onClick: add, disabled: !canModify },
    { label: removeLabel, icon: <Eraser size={M} />, onClick: remove, disabled: !canModify },
  ];

  return (
    <>
      <Group label="Tools">
        <Stack>
          <ToolBtn tool="hand" size="small" icon={<Hand size={I} />} label="Hand" keys="H" />
          <ToolBtn tool="selectText" size="small" icon={<TextSelect size={I} />} label="Select Text" keys="X" />
          <Btn size="small" icon={<Wrench size={I} />} label="Other Tools" active={['select', 'snapshot', 'zoom', 'content'].includes(tool)} disabled={!hasDoc} menu={otherTools} />
        </Stack>
      </Group>
      <Group label="Pages">
        <Btn icon={<FilePlus2 size={L} />} label="Insert" disabled={!canAssemble} menu={[
          { label: 'Blank Pages…', icon: <FilePlus2 size={M} />, onClick: open('orgInsertBlank') },
          { label: 'Pages from File…', icon: <FileInput size={M} />, onClick: open('orgInsertFile') },
          { label: 'Images as Pages…', icon: <ImagePlus size={M} />, onClick: open('orgImagePages') },
          { label: 'Page from Clipboard Image', icon: <ClipboardPaste size={M} />, onClick: () => oc.insertClipboardImage() },
        ]} />
        <Btn icon={<Trash2 size={L} />} label="Delete" disabled={!canAssemble} onClick={open('orgDelete')} menu={[
          { label: 'Delete Pages…', icon: <Trash2 size={M} />, onClick: open('orgDelete') },
          { label: 'Delete Blank Pages', icon: <FileX2 size={M} />, onClick: oc.deleteBlankPages },
        ]} />
        <Btn icon={<FileOutput size={L} />} label="Extract Pages" disabled={!canCopy} onClick={open('orgExtract')} />
        <Btn icon={<ArrowRightLeft size={L} />} label="Move Pages" disabled={!canAssemble} onClick={open('orgMove')} />
        <Stack>
          <Btn size="small" icon={<Combine size={I} />} label="Merge Pages" disabled={!canAssemble} onClick={open('orgMerge')} />
          <Btn size="small" icon={<Split size={I} />} label="Split Document" disabled={!canCopy} menu={[
            { label: 'By Number of Pages…', icon: <FileStack size={M} />, onClick: open('orgSplit', 'pages') },
            { label: 'Into Single Pages…', icon: <Files size={M} />, onClick: open('orgSplit', 'single') },
            { label: 'By Page Ranges…', icon: <SquareSplitVertical size={M} />, onClick: open('orgSplit', 'ranges') },
            { label: 'By Bookmarks…', icon: <Bookmark size={M} />, onClick: open('orgSplit', 'bookmarks') },
            { label: 'By File Size…', onClick: open('orgSplit', 'size') },
          ]} />
          <Btn size="small" icon={<Copy size={I} />} label="Duplicate Pages" disabled={!canAssemble} onClick={open('orgDuplicate')} />
        </Stack>
        <Stack>
          <Btn size="small" icon={<Replace size={I} />} label="Replace Pages" disabled={!canAssemble} onClick={open('orgReplace')} />
          <Btn size="small" icon={<Repeat2 size={I} />} label="Swap Pages" disabled={!canAssemble} onClick={open('orgSwap')} />
          <Btn size="small" icon={<Layers size={I} />} label="Overlay Pages" disabled={!canModify} onClick={open('orgOverlay')} />
        </Stack>
        <Stack>
          <Btn size="small" icon={<Shrink size={I} />} label="Normalize Pages" disabled={!canModify} onClick={open('orgNormalize')} />
          <Btn size="small" icon={<CopyCheck size={I} />} label="Find Duplicates" disabled={!hasDoc} onClick={open('orgFindDuplicates')} />
          <Btn size="small" icon={<ArrowDownUp size={I} />} label="Reverse Order" title="Reverse the order of the selected pages (or of all pages)" disabled={!canAssemble} onClick={() => oc.reversePages(S().selectedPages)} />
        </Stack>
      </Group>
      <Group label="Page Shape">
        <Btn icon={<RotateCw size={L} />} label="Rotate" disabled={!canAssemble} onClick={open('orgRotate')} menu={[
          { label: 'Rotate left', icon: <RotateCcw size={M} />, onClick: () => cmd.rotate(-90) },
          { label: 'Rotate right', icon: <RotateCw size={M} />, onClick: () => cmd.rotate(90) },
          { label: 'Rotate 180°', icon: <RefreshCcw size={M} />, onClick: () => cmd.rotate(180) },
          null,
          { label: 'Rotate Pages…', onClick: open('orgRotate') },
        ]} />
        <Btn icon={<Crop size={L} />} label="Crop" disabled={!canModify} onClick={open('orgCrop')} menu={[
          { label: 'Crop Pages…', icon: <Crop size={M} />, onClick: open('orgCrop') },
          { label: 'Remove White Margins…', icon: <ScanLine size={M} />, onClick: open('orgAutoCrop') },
        ]} />
        <Stack>
          <Btn size="small" icon={<Scaling size={I} />} label="Resize Pages" disabled={!canModify} onClick={open('orgResize')} />
          <Btn size="small" icon={<Frame size={I} />} label="Margins" title="Add page margins" disabled={!canModify} onClick={open('orgMargins')} />
        </Stack>
      </Group>
      <Group label="Page marks">
        <Btn icon={<Droplets size={L} />} label="Watermark" disabled={!canModify} onClick={open('orgWatermark')}
          menu={marks(open('orgWatermark'), 'Add Watermark…', () => oc.removeMarks(['Watermark']), 'Remove Watermarks')} />
        <Btn icon={<PaintBucket size={L} />} label="Background" disabled={!canModify} onClick={open('orgBackground')}
          menu={marks(open('orgBackground'), 'Add Background…', () => oc.removeMarks(['Background']), 'Remove Backgrounds')} />
        <Btn icon={<PanelTop size={L} />} label="Headers & Footers" disabled={!canModify} onClick={open('orgHeaderFooter')}
          menu={marks(open('orgHeaderFooter'), 'Add Headers & Footers…', () => oc.removeMarks(['Header', 'Footer']), 'Remove Headers & Footers')} />
        <Btn icon={<Hash size={L} />} label="Bates Numbering" disabled={!canModify} onClick={open('orgBates')}
          menu={marks(open('orgBates'), 'Add Bates Numbering…', () => oc.removeMarks(['BatesN']), 'Remove Bates Numbering')} />
        <Btn icon={<ListOrdered size={L} />} label="Number Pages" title="Page labels: the page numbers viewers show" disabled={!canModify} onClick={open('orgPageLabels')} />
      </Group>
    </>
  );
}
