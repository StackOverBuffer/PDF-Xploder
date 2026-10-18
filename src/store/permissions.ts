/**
 * What the user may do with the open document, derived from its security
 * permissions (ISO 32000-1, table 22). Applies only while the document is open
 * without its owner password; with it, everything is allowed.
 */
import { useStore, type Store } from './store';
import { tf, tr } from '../lib/i18n';

export type Action =
  /** Add, change or delete comments (annotations). */
  | 'annotate'
  /** Fill in existing form fields. */
  | 'fillForms'
  /** Change page content: watermarks, headers/footers, crop, flatten, redact, properties. */
  | 'modify'
  /** Insert, delete, rotate and reorder pages. */
  | 'assemble'
  /** Create, delete and change form fields. */
  | 'designForms'
  /** Copy text and graphics, extract pages, export images. */
  | 'copy'
  | 'print'
  /** Change passwords and permissions. */
  | 'security';

type PermState = Pick<Store, 'pdf' | 'editable' | 'permissions' | 'ownerAccess'>;

/** Just the fields permissions depend on, so components re-render only when those change. */
export function usePermState(): PermState {
  const pdf = useStore((s) => s.pdf);
  const editable = useStore((s) => s.editable);
  const permissions = useStore((s) => s.permissions);
  const ownerAccess = useStore((s) => s.ownerAccess);
  return { pdf, editable, permissions, ownerAccess };
}

export function allowed(s: PermState, a: Action): boolean {
  if (!s.pdf) return false;
  const p = s.permissions;
  switch (a) {
    case 'print':
      return p.printing;
    case 'copy':
      return p.copying;
    case 'security':
      return s.editable && s.ownerAccess;
  }
  if (!s.editable) return false;
  switch (a) {
    case 'annotate':
      return p.annotating;
    case 'fillForms':
      // Bit 6 (comment) also allows filling forms; bit 9 allows it on its own.
      return p.fillingForms || p.annotating;
    case 'modify':
      return p.modifying;
    case 'assemble':
      // Bit 11 grants assembly "even if bit 4 is clear".
      return p.documentAssembly || p.modifying;
    case 'designForms':
      // Bits 4 and 6 together allow creating and modifying form fields.
      return p.modifying && p.annotating;
  }
}

/** English labels (translation keys): show them with t()/tr(). */
export const ACTION_LABELS: Record<Action, string> = {
  annotate: 'Commenting',
  fillForms: 'Filling in form fields',
  modify: 'Changing the document',
  assemble: 'Inserting, deleting and rotating pages',
  designForms: 'Creating and changing form fields',
  copy: 'Copying content and extracting pages',
  print: 'Printing',
  security: 'Changing security',
};

/** Current permission for an action (non-reactive). */
export const can = (a: Action) => allowed(useStore.getState(), a);

/** Reactive permission for an action, for components. */
export const useCan = (a: Action) => useStore((s) => allowed(s, a));

/** Check a permission and explain the refusal if it is missing. */
export function requirePermission(a: Action): boolean {
  const s = useStore.getState();
  if (!s.bytes) return false;
  if (allowed(s, a)) return true;
  s.notify(
    !s.editable
      ? tr('This document is read-only.')
      : tf('{action} is not allowed by this document’s security settings. Unlock it with the permissions password to change them.', { action: tr(ACTION_LABELS[a]) }),
    'error',
  );
  return false;
}
