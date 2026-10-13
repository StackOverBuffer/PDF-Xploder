import {
  BookmarkPlus, ListTree, ListOrdered, FileText, FileType2, CaseSensitive, Replace, TextCursorInput, Combine, Unlink, ShieldCheck,
  Download, ArrowDownWideNarrow, TableOfContents, Trash2, ChevronUp, ChevronDown, Heading,
} from 'lucide-react';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import * as bc from '../store/bookmarkCommands';
import { useDialog } from './Dialogs';
import { Btn, Group, I, L, SidebarBtn, Stack } from './ribbonParts';
import { addBookmarkAt } from '../store/contentActions';
import { currentViewTarget } from '../store/viewActions';
import { useTextBox } from './TextBoxSelect';

/** The Bookmarks ("Lesezeichen") ribbon tab. */
export function BookmarksTab() {
  const show = useDialog((d) => d.show);
  const hasDoc = useStore((s) => !!s.pdf);
  const canModify = useCan('modify');
  const canAssemble = useCan('assemble');
  const noEdit = !canModify;
  return (
    <>
      <Group label="Bookmarks">
        <SidebarBtn tab="outline" icon={<ListTree size={L} />} label="Bookmarks" />
        <Btn icon={<BookmarkPlus size={L} />} label="Add" title="Add a bookmark for the current view (Ctrl+Shift+B)" disabled={noEdit} onClick={() => {
          const s = useStore.getState();
          s.setSidebar('outline');
          addBookmarkAt(s.currentPage, currentViewTarget().y, useTextBox.getState().sel?.text.split('\n')[0] ?? '');
        }} />
        <Stack>
          <Btn size="small" icon={<ChevronUp size={I} />} label="Previous bookmark" keys="Alt+PgUp" disabled={!hasDoc} onClick={() => bc.goToBookmark(-1)} />
          <Btn size="small" icon={<ChevronDown size={I} />} label="Next bookmark" keys="Alt+PgDn" disabled={!hasDoc} onClick={() => bc.goToBookmark(1)} />
        </Stack>
      </Group>
      <Group label="Generate">
        <Btn icon={<Heading size={L} />} label="From page text" title="Generate bookmarks from headings" disabled={noEdit} onClick={() => show('bmHeadings')} />
        <Btn icon={<TableOfContents size={L} />} label="From table of contents" disabled={noEdit} onClick={() => show('bmToc')} />
        <Stack>
          <Btn size="small" icon={<ListOrdered size={I} />} label="Every Nth page" disabled={noEdit} onClick={() => show('bmEveryNth')} />
          <Btn size="small" icon={<FileText size={I} />} label="From text file" disabled={noEdit} onClick={() => show('bmText')} />
        </Stack>
      </Group>
      <Group label="Titles">
        <Btn icon={<Replace size={L} />} label="Find and replace" disabled={noEdit} onClick={() => show('bmReplace')} />
        <Stack>
          <Btn size="small" icon={<CaseSensitive size={I} />} label="Change case" disabled={noEdit} onClick={() => show('bmCase')} />
          <Btn size="small" icon={<TextCursorInput size={I} />} label="Add text" disabled={noEdit} onClick={() => show('bmAddText')} />
        </Stack>
      </Group>
      <Group label="Tools">
        <Btn icon={<ShieldCheck size={L} />} label="Validate" disabled={!hasDoc} onClick={() => show('bmValidate')} />
        <Stack>
          <Btn size="small" icon={<Combine size={I} />} label="Merge duplicates" disabled={noEdit} onClick={bc.mergeDuplicates} />
          <Btn size="small" icon={<Unlink size={I} />} label="Remove actions" disabled={noEdit} onClick={bc.removeActions} />
          <Btn size="small" icon={<Trash2 size={I} />} label="Delete all" disabled={noEdit} onClick={bc.deleteAllBookmarks} />
        </Stack>
      </Group>
      <Group label="Pages">
        <Btn icon={<ListOrdered size={L} />} label="Build table of contents" disabled={!canAssemble} onClick={() => show('bmBuildToc')} />
        <Btn icon={<ArrowDownWideNarrow size={L} />} label="Sort pages by bookmarks" disabled={!canAssemble} onClick={bc.sortPagesByBookmarks} />
      </Group>
      <Group label="Export">
        <Stack>
          <Btn size="small" icon={<Download size={I} />} label="As text file" disabled={!hasDoc} onClick={() => bc.exportBookmarks('txt')} />
          <Btn size="small" icon={<FileType2 size={I} />} label="As HTML" disabled={!hasDoc} onClick={() => bc.exportBookmarks('html')} />
        </Stack>
      </Group>
    </>
  );
}
