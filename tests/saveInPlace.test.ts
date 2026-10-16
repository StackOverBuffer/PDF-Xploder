import { describe, expect, it, vi, beforeEach } from 'vitest';

const downloads: string[] = [];
vi.mock('../src/lib/download', async (orig) => ({
  ...(await orig<typeof import('../src/lib/download')>()),
  downloadBlob: (_data: Uint8Array, name: string) => void downloads.push(name),
}));

const { useStore } = await import('../src/store/store');
const { save } = await import('../src/store/commands');
const S = () => useStore.getState();

/** A FileSystemFileHandle stand-in that records what was written. */
function fakeHandle(name: string, o: { permission?: PermissionState; failWrite?: boolean } = {}) {
  const written: Uint8Array[] = [];
  const handle = {
    kind: 'file',
    name,
    queryPermission: async () => o.permission ?? 'granted',
    requestPermission: async () => o.permission ?? 'granted',
    createWritable: async () => ({
      write: async (d: Uint8Array) => {
        if (o.failWrite) throw new Error('disk full');
        written.push(d);
      },
      close: async () => {},
      abort: async () => {},
    }),
  };
  return { handle: handle as unknown as FileSystemFileHandle, written };
}

const bytes = new Uint8Array([37, 80, 68, 70]);
const openFake = (handle: FileSystemFileHandle | null) =>
  useStore.setState({ fileName: 'a.pdf', bytes, originalBytes: bytes, dirty: false, savedOnce: false, fileHandle: handle, signatures: [] });

describe('save in place', () => {
  beforeEach(() => {
    downloads.length = 0;
  });

  it('writes back to the opened file', async () => {
    const { handle, written } = fakeHandle('a.pdf');
    openFake(handle);
    await save();
    expect(written).toEqual([bytes]);
    expect(downloads).toEqual([]);
    expect(S()).toMatchObject({ dirty: false, savedOnce: true, fileHandle: handle });
  });

  it('downloads when there is no handle or no write access', async () => {
    openFake(null);
    await save();
    const { handle, written } = fakeHandle('a.pdf', { permission: 'denied' });
    openFake(handle);
    await save();
    expect(written).toEqual([]);
    expect(downloads).toEqual(['a.pdf', 'a.pdf']);
  });

  it('falls back to a download when writing fails', async () => {
    const { handle } = fakeHandle('a.pdf', { failWrite: true });
    openFake(handle);
    await save();
    expect(downloads).toEqual(['a.pdf']);
    expect(S().toast?.kind).toBe('error');
  });
});
