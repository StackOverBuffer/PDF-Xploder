/** The spell check's results, kept small: the page layer draws them without loading the checker (spelling.ts). */
import { create } from 'zustand';
import type { SpellLang } from '../lib/spell/text';
import type { Rect } from '../lib/types';

export type IssueSource =
  | { kind: 'page'; split?: boolean }
  | { kind: 'comment'; pageId: string; annotId: string; field: 'text' | 'comment' | 'reply'; replyId?: string; start: number };

export interface SpellIssue {
  /** Stays the same while the text before it on its page does not change (for Ignore). */
  key: string;
  word: string;
  page: number;
  /** The word's box in the page text (comments have none). */
  rect?: Rect;
  context: string;
  source: IssueSource;
}

export interface SpellState {
  lang: SpellLang | null;
  issues: SpellIssue[];
  index: number;
  /** Whether the document has been checked (the list is meaningful). */
  checked: boolean;
  running: boolean;
  error: string | null;
}


export const useSpell = create<SpellState>()(() => ({ lang: null, issues: [], index: -1, checked: false, running: false, error: null }));
