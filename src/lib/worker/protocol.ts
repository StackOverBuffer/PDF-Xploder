export type WorkerModule = 'ops' | 'org' | 'sec';

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
