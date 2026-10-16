/**
 * File System Access API (Chrome, Edge): open files with a handle so Save can write
 * back to the original file, like a desktop editor. Other browsers fall back to
 * the file input and downloads.
 */

type Mode = { mode: 'read' | 'readwrite' };
type PickerType = { description: string; accept: Record<string, string[]> };

interface Pickers {
  showOpenFilePicker?(o: { types: PickerType[]; multiple?: boolean; excludeAcceptAllOption?: boolean }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(o: { types: PickerType[]; suggestedName?: string; excludeAcceptAllOption?: boolean }): Promise<FileSystemFileHandle>;
}

interface PermissionHandle {
  queryPermission?(o: Mode): Promise<PermissionState>;
  requestPermission?(o: Mode): Promise<PermissionState>;
}

const PDF_TYPES: PickerType[] = [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }];

const pickers = () => (typeof window === 'undefined' ? {} : (window as unknown as Pickers));

/** Whether Save can write to the opened file in this browser. */
export const canSaveInPlace = () => typeof pickers().showSaveFilePicker === 'function';

export interface PickedFile {
  file: File;
  handle: FileSystemFileHandle | null;
}

/** The user cancelled a picker. */
export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** Show the open picker. Returns null when the API is unavailable (use a file input instead), [] on cancel. */
export async function pickPdfHandles(): Promise<PickedFile[] | null> {
  const open = pickers().showOpenFilePicker;
  if (!open) return null;
  try {
    const handles = await open.call(window, { types: PDF_TYPES, multiple: true });
    return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
  } catch (e) {
    if (isAbort(e)) return [];
    // Blocked (e.g. in a cross-origin frame): let the caller use the file input.
    return null;
  }
}

/** Show the save picker. Returns null when unavailable, undefined on cancel. */
export async function pickSaveHandle(suggestedName: string): Promise<FileSystemFileHandle | null | undefined> {
  const save = pickers().showSaveFilePicker;
  if (!save) return null;
  try {
    return await save.call(window, { types: PDF_TYPES, suggestedName });
  } catch (e) {
    if (isAbort(e)) return undefined;
    return null;
  }
}

/**
 * Handles for dropped files, in the order of `dataTransfer.files`.
 * Must be called synchronously inside the drop event: the items expire afterwards.
 */
export function droppedHandles(dt: DataTransfer): Promise<(FileSystemFileHandle | null)[]> {
  const items = Array.from(dt.items).filter((i) => i.kind === 'file');
  type Item = DataTransferItem & { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> };
  const pending = items.map((i) =>
    (i as Item).getAsFileSystemHandle
      ? (i as Item).getAsFileSystemHandle!()
          .then((h) => (h && h.kind === 'file' ? (h as FileSystemFileHandle) : null))
          .catch(() => null)
      : Promise.resolve(null),
  );
  return Promise.all(pending);
}

/** Ask for write access (prompts the user once per file and session). Call early, while the click still counts as a user gesture. */
export async function ensureWritable(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as FileSystemFileHandle & PermissionHandle;
  try {
    if ((await h.queryPermission?.({ mode: 'readwrite' })) === 'granted') return true;
    if (!h.requestPermission) return true; // Let createWritable decide.
    return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

export async function writeToHandle(handle: FileSystemFileHandle, data: Uint8Array): Promise<void> {
  const w = await handle.createWritable();
  try {
    await w.write(data);
  } catch (e) {
    await w.abort().catch(() => {});
    throw e;
  }
  await w.close();
}
