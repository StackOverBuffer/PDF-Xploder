/**
 * A small IndexedDB store for the session backup and recent files: values by key,
 * and document bytes as separate records (so unchanged documents are not rewritten).
 * Everything stays in this browser; nothing is sent anywhere.
 */
const DB_NAME = 'pdf-xploder';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'));
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // Let a later call try again (e.g. after the user allowed storage).
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function run<T>(store: 'kv' | 'blobs', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const getValue = <T>(key: string) => run<T>('kv', 'readonly', (s) => s.get(key) as IDBRequest<T>);
export const setValue = (key: string, value: unknown) => run('kv', 'readwrite', (s) => void s.put(value, key));
export const deleteValue = (key: string) => run('kv', 'readwrite', (s) => void s.delete(key));

export const getBlob = (id: string) => run<Uint8Array>('blobs', 'readonly', (s) => s.get(id) as IDBRequest<Uint8Array>);
export const putBlob = (id: string, bytes: Uint8Array) => run('blobs', 'readwrite', (s) => void s.put(bytes, id));

/** Delete every stored document that is not in `keep`. */
export async function pruneBlobs(keep: Set<string>): Promise<void> {
  const keys = (await run<IDBValidKey[]>('blobs', 'readonly', (s) => s.getAllKeys())) ?? [];
  const drop = keys.filter((k) => !keep.has(String(k)));
  if (drop.length) await run('blobs', 'readwrite', (s) => drop.forEach((k) => s.delete(k)));
}

/** Remove everything (the session backup and recent files). */
export async function clearAll(): Promise<void> {
  await run('kv', 'readwrite', (s) => void s.clear());
  await run('blobs', 'readwrite', (s) => void s.clear());
}
