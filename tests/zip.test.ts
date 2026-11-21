import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { crc32, zip } from '../src/lib/zip';

describe('zip', () => {
  it('computes CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes an archive that unzip reads back', () => {
    const files = [
      { name: 'a.txt', data: new TextEncoder().encode('hello') },
      { name: 'Bilder/größe.bin', data: new Uint8Array([0, 1, 2, 255]) },
    ];
    const bytes = zip(files);
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    try {
      const file = join(dir, 'x.zip');
      writeFileSync(file, bytes);
      let python = true;
      try {
        execFileSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; z.extractall(sys.argv[2])', file, dir]);
      } catch (e) {
        // Windows answers for a missing python3 with the Store alias, which fails
        // differently from a missing command: skip the check there too.
        if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as { status?: number }).status === 9009 || /Python was not found/.test(String((e as { stderr?: unknown }).stderr))) python = false;
        else throw e;
      }
      if (python) {
        expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('hello');
        expect([...readFileSync(join(dir, 'Bilder/größe.bin'))]).toEqual([0, 1, 2, 255]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // End of central directory: two entries.
    const end = new DataView(bytes.buffer, bytes.length - 22);
    expect(end.getUint32(0, true)).toBe(0x06054b50);
    expect(end.getUint16(10, true)).toBe(2);
  });
});
