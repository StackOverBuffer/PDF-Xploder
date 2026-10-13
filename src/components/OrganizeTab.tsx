import { RotateCcw, RotateCw, FilePlus2, FileInput, Copy, Trash2, FileOutput, Scissors, ArrowDownUp, Crop, Droplets, Heading, LayoutGrid } from 'lucide-react';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import * as cmd from '../store/commands';
import { useDialog } from './Dialogs';
import { Btn, Group, I, L, SidebarBtn, Stack } from './ribbonParts';

/** The Organize ("Dokumentaufbau") ribbon tab. */
export function OrganizeTab() {
  const show = useDialog((d) => d.show);
  const canModify = useCan('modify');
  const canAssemble = useCan('assemble');
  const canCopy = useCan('copy');
  const hasDoc = useStore((s) => !!s.pdf);
  void hasDoc;
  return (
    <>
      <Group label="Pages">
        <Btn icon={<FilePlus2 size={L} />} label="Insert" disabled={!canAssemble} onClick={() => cmd.insertFromFile()} menu={[
          { label: 'Blank page', icon: <FilePlus2 size={14} />, onClick: () => cmd.insertBlank() },
          { label: 'From file', icon: <FileInput size={14} />, onClick: () => cmd.insertFromFile() },
        ]} />
        <Btn icon={<Trash2 size={L} />} label="Delete" disabled={!canAssemble} onClick={() => cmd.deletePages()} />
        <Btn icon={<FileOutput size={L} />} label="Extract" disabled={!canCopy} onClick={() => cmd.extract()} />
        <Btn icon={<Scissors size={L} />} label="Split" disabled={!canCopy} onClick={() => show('split')} />
        <Stack>
          <Btn size="small" icon={<Copy size={I} />} label="Duplicate" disabled={!canAssemble} onClick={() => cmd.duplicate()} />
          <Btn size="small" icon={<ArrowDownUp size={I} />} label="Reverse" disabled={!canAssemble} onClick={cmd.reverseOrder} />
          <Btn size="small" icon={<Crop size={I} />} label="Crop" disabled={!canModify} onClick={() => show('crop')} />
        </Stack>
      </Group>
      <Group label="Rotate">
        <Btn icon={<RotateCcw size={L} />} label="Rotate left" disabled={!canAssemble} onClick={() => cmd.rotate(-90)} />
        <Btn icon={<RotateCw size={L} />} label="Rotate right" disabled={!canAssemble} onClick={() => cmd.rotate(90)} />
      </Group>
      <Group label="Page marks">
        <Btn icon={<Droplets size={L} />} label="Watermark" disabled={!canModify} onClick={() => show('watermark')} />
        <Btn icon={<Heading size={L} />} label="Header/Footer" disabled={!canModify} onClick={() => show('headerFooter')} />
      </Group>
      <Group label="View">
        <SidebarBtn tab="pages" icon={<LayoutGrid size={L} />} label="Thumbnails" />
      </Group>
    </>
  );
}
