import type { Annotation, ReviewStatus, StatusEntry } from './types';

/**
 * The status history to write for a comment. The entries read from the file keep their
 * author and date; a status that differs from the last entry (set in this session) is
 * added as a new change by `author` at `now`.
 */
export function statusHistory(a: Pick<Annotation, 'id' | 'status' | 'statusLog'>, author: string, now: number): StatusEntry[] {
  const log = a.statusLog ?? [];
  const last = log.length ? log[log.length - 1].state : 'None';
  const want = a.status ?? 'None';
  if (want === last) return log;
  return [...log, { id: log.length ? `state-${a.id}-${log.length}` : `state-${a.id}`, state: want, author, at: now }];
}

/** The fields to update when the user sets a comment's status. */
export function setStatus(a: Pick<Annotation, 'id' | 'status' | 'statusLog'>, status: ReviewStatus | undefined, author: string, now = Date.now()): Pick<Annotation, 'status' | 'statusLog'> {
  return { status, statusLog: statusHistory({ ...a, status }, author, now) };
}
