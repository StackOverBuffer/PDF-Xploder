export type WorkerModule = 'ops' | 'org' | 'sec' | 'content' | 'db';

/** An argument the worker already holds: `{ [REF]: key }` instead of the bytes. */
export const REF = '__workerRef';
/** The error when the worker no longer holds a referenced document. */
export const MISSING_REF = 'missing-ref';

/** Send the document held as `share` to the port passed along (the bytes, or null if no longer held). */
export interface ShareRequest {
  share: string;
}

export interface Reply {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
  /** Keys of the documents the worker holds now. */
  has: string[];
  /** Keys of documents in the result ('' for the result itself, else the property). */
  resultKeys?: Record<string, string>;
}

/** Buffers of the byte arrays in a result (top level, in arrays, or one level into objects), to hand over without copying. */
export function transferables(v: unknown): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  const add = (x: unknown) => {
    if (x instanceof Uint8Array && x.buffer instanceof ArrayBuffer && x.byteOffset === 0 && x.byteLength === x.buffer.byteLength) out.add(x.buffer);
  };
  const walk = (x: unknown, depth: number) => {
    add(x);
    if (depth > 2 || !x || typeof x !== 'object' || x instanceof Uint8Array) return;
    for (const y of Array.isArray(x) ? x : Object.values(x)) walk(y, depth + 1);
  };
  walk(v, 0);
  return [...out];
}
