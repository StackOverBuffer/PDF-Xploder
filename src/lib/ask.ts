/**
 * Questions in the app's own dialogs instead of the browser's confirm() and prompt(),
 * which look foreign, block the page and cannot be styled or translated. The dialogs
 * are shown by AskHost; callers await the answer.
 */
import { create } from 'zustand';

export interface Question {
  /** Dialog title (English key, translated when shown). */
  title?: string;
  /** The question itself, already translated. */
  message: string;
  /** Label of the confirming button (English key). */
  ok?: string;
  /** The confirming button does something destructive. */
  danger?: boolean;
  /** Ask for a line of text: its initial value. */
  value?: string;
  /** The text is a password (hidden while typing). */
  password?: boolean;
}

interface Pending extends Question {
  id: number;
  text: boolean;
  resolve(answer: string | boolean | null): void;
}

export const useAsk = create<{ queue: Pending[] }>()(() => ({ queue: [] }));
let nextId = 1;

function enqueue(q: Question, text: boolean): Promise<string | boolean | null> {
  return new Promise((resolve) => {
    const id = nextId++;
    const done = (answer: string | boolean | null) => {
      useAsk.setState((s) => ({ queue: s.queue.filter((p) => p.id !== id) }));
      resolve(answer);
    };
    useAsk.setState((s) => ({ queue: [...s.queue, { ...q, id, text, resolve: done }] }));
  });
}

/** A yes/no question: true when confirmed. */
export const ask = (q: Question | string) => enqueue(typeof q === 'string' ? { message: q } : q, false) as Promise<boolean>;

/** A line of text, or null when cancelled. */
export const askText = (q: Question) => enqueue(q, true) as Promise<string | null>;

/** Open a web link from the document after asking (links in PDFs can point anywhere). */
export async function openLinkAfterAsking(url: string): Promise<void> {
  const { tr } = await import('./i18n');
  if (await ask({ title: 'Open link', message: `${tr('Open this link in a new tab?')}\n\n${url}`, ok: 'Open' })) window.open(url, '_blank', 'noopener,noreferrer');
}
