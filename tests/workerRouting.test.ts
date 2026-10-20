import { describe, expect, it } from 'vitest';
import { ops, routed, sec } from '../src/lib/worker';

describe('worker routing', () => {
  it('works on frozen module namespaces (as bundles produce them)', async () => {
    // A Proxy over a frozen namespace failed here ("read-only and non-configurable data property").
    const fn = async (b: Uint8Array) => b.length;
    const mod = Object.freeze({ inspectEncryption: fn, decrypt: fn, encrypt: fn, reencryptLike: fn, other: 5 });
    const r = routed('sec', mod as never) as unknown as typeof mod;
    expect(r.other).toBe(5);
    // No Worker in tests: the call runs here.
    expect(await r.inspectEncryption(new Uint8Array(3))).toBe(3);
  });

  it('routes every listed function of the real modules', () => {
    expect(typeof ops.insertDocument).toBe('function');
    expect(typeof sec.decrypt).toBe('function');
  });
});
