/**
 * sfnt font-file bytes: read and write tables, the PDF/A subset name tag ("ABCDEF+"),
 * and unpacking the WOFF containers @fontsource ships. hb-subset and pdf-lib read plain
 * sfnt; the name table is where the subset tag lives.
 */

interface Table {
  tag: string;
  data: Uint8Array;
}

const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
// Bitwise coercion makes reads past the end count as zero padding.
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const fourCC = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** Sum of the uint32 words of the data (a short final word counts as zero-padded). */
function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum = (sum + be32(data, i)) >>> 0;
  return sum;
}

function readSfnt(bytes: Uint8Array): { flavor: number; tables: Table[] } {
  const tables: Table[] = [];
  const num = be16(bytes, 4);
  for (let i = 0; i < num; i++) {
    const r = 12 + i * 16;
    const at = be32(bytes, r + 8);
    tables.push({ tag: fourCC(bytes, r), data: bytes.slice(at, at + be32(bytes, r + 12)) });
  }
  return { flavor: be32(bytes, 0), tables };
}

/** Write tables back into an sfnt file: tags sorted, checksums and head adjustment recomputed. */
function writeSfnt(flavor: number, tables: Table[]): Uint8Array {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const headIndex = sorted.findIndex((t) => t.tag === 'head');
  if (headIndex >= 0) {
    sorted[headIndex].data = sorted[headIndex].data.slice(); // input bytes are shared
    // The spec's procedure: zero head's checkSumAdjustment, checksum everything, then write the
    // difference to 0xB1B0AFBA back into the field, so the whole file sums to 0xB1B0AFBA.
    const h = sorted[headIndex].data;
    h[8] = h[9] = h[10] = h[11] = 0;
  }
  const num = sorted.length;
  const entrySelector = Math.floor(Math.log2(num));
  const searchRange = 16 * 2 ** entrySelector;
  let at = 12 + 16 * num;
  const offsets = sorted.map((t) => {
    const start = at;
    at += (t.data.length + 3) & ~3;
    return start;
  });
  const out = new Uint8Array(at);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, flavor);
  dv.setUint16(4, num);
  dv.setUint16(6, searchRange);
  dv.setUint16(8, entrySelector);
  dv.setUint16(10, num * 16 - searchRange);
  sorted.forEach((t, i) => {
    const r = 12 + i * 16;
    for (let j = 0; j < 4; j++) dv.setUint8(r + j, t.tag.charCodeAt(j));
    dv.setUint32(r + 4, checksum(t.data));
    dv.setUint32(r + 8, offsets[i]);
    dv.setUint32(r + 12, t.data.length);
    out.set(t.data, offsets[i]);
  });
  if (headIndex >= 0) dv.setUint32(offsets[headIndex] + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

/** Decode a name record's string: Unicode/Windows records are UTF-16BE, the rest ASCII. */
function nameText(raw: Uint8Array, utf16: boolean): string {
  let text = '';
  if (utf16) for (let i = 0; i + 1 < raw.length; i += 2) text += String.fromCharCode((raw[i] << 8) | raw[i + 1]);
  else for (const b of raw) text += String.fromCharCode(b);
  return text;
}

/** Text of the first name record with one of `ids`. */
function nameOf(bytes: Uint8Array, ids: number[]): string | undefined {
  const name = readSfnt(bytes).tables.find((t) => t.tag === 'name')?.data;
  if (!name) return undefined;
  const count = be16(name, 2);
  const storage = be16(name, 4);
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (!ids.includes(be16(name, r + 6))) continue;
    const at = storage + be16(name, r + 10);
    return nameText(name.subarray(at, at + be16(name, r + 8)), be16(name, r) === 0 || be16(name, r) === 3);
  }
  return undefined;
}

/** Six uppercase letters: the subset tag the PDF spec wants before the '+' of a subset font name. */
function subsetTag(postscriptName: string): string {
  let h = 0x811c9dc5; // FNV-1a over the name: stable across runs, different per font
  for (const b of new TextEncoder().encode(postscriptName)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  let tag = '';
  for (let i = 0; i < 6; i++) tag += String.fromCharCode(65 + ((h >>> (i * 5)) & 31) % 26);
  return tag;
}

const utf16be = (s: string) => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    out[2 * i] = s.charCodeAt(i) >>> 8;
    out[2 * i + 1] = s.charCodeAt(i) & 0xff;
  }
  return out;
};

/** Prefix the family/subfamily/full/postscript name records (IDs 1/2/4/6), keeping every
 * record's platform/encoding/language; the other records are copied verbatim. */
function tagNames(bytes: Uint8Array, prefix: string): Uint8Array {
  const { flavor, tables } = readSfnt(bytes);
  const name = tables.find((t) => t.tag === 'name');
  if (!name) return bytes;
  const old = name.data;
  if (be16(old, 0) !== 0) return bytes; // format 1 (language tags) is not what harfbuzz writes
  const count = be16(old, 2);
  const storage = be16(old, 4);
  const header = new Uint8Array(6 + 12 * count);
  const dv = new DataView(header.buffer);
  dv.setUint16(2, count);
  dv.setUint16(4, header.length);
  let at = header.length;
  const chunks: Uint8Array[] = [header];
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const platform = be16(old, r);
    const id = be16(old, r + 6);
    const start = storage + be16(old, r + 10);
    let text = old.slice(start, start + be16(old, r + 8));
    if (id === 1 || id === 2 || id === 4 || id === 6) {
      const tagged = prefix + nameText(text, platform === 0 || platform === 3);
      // Mac records carry plain ASCII names; Windows/Unicode carry UTF-16BE.
      text = platform === 0 || platform === 3 ? utf16be(tagged) : new TextEncoder().encode(tagged);
    }
    dv.setUint16(6 + i * 12, platform);
    dv.setUint16(6 + i * 12 + 2, be16(old, r + 2)); // encoding
    dv.setUint16(6 + i * 12 + 4, be16(old, r + 4)); // language
    dv.setUint16(6 + i * 12 + 6, id);
    dv.setUint16(6 + i * 12 + 8, text.length);
    dv.setUint16(6 + i * 12 + 10, at - header.length);
    chunks.push(text);
    at += text.length;
  }
  const table = new Uint8Array((at + 3) & ~3);
  let o = 0;
  for (const c of chunks) {
    table.set(c, o);
    o += c.length;
  }
  return writeSfnt(flavor, tables.map((t) => (t === name ? { tag: 'name', data: table, checksum: 0 } : t)));
}

/** Embedded subsets must carry the spec's "ABCDEF+" tag in their name (PDF/A and validators
 * expect it); harfbuzz keeps the original name table, so rewrite it after subsetting. */
export function tagSubset(bytes: Uint8Array): Uint8Array {
  try {
    const name = nameOf(bytes, [6]) ?? nameOf(bytes, [4]) ?? nameOf(bytes, [1]);
    return name ? tagNames(bytes, `${subsetTag(name)}+`) : bytes;
  } catch (e) {
    // An untagged font is still a valid font: embedding goes on without the tag.
    console.warn('Could not write the subset tag into the font name', e);
    return bytes;
  }
}

/** Unpack a WOFF 1.0 container into sfnt bytes: @fontsource ships woff, while hb-subset and
 * pdf-lib read sfnt only. */
export const isWoff = (bytes: Uint8Array) => fourCC(bytes, 0) === 'wOFF';

export async function sfntFromWoff(woff: Uint8Array): Promise<Uint8Array> {
  if (!isWoff(woff)) throw new Error('Not a WOFF file');
  const tables: Table[] = [];
  const num = be16(woff, 12);
  for (let i = 0; i < num; i++) {
    const r = 44 + i * 20;
    const at = be32(woff, r + 4);
    const comp = be32(woff, r + 8);
    const len = be32(woff, r + 12);
    const raw = woff.subarray(at, at + comp);
    // A compressed table is shorter than its original; DecompressionStream('deflate') is the
    // zlib decoder that every current browser and Node ships.
    const data = comp < len ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()) : raw.slice();
    tables.push({ tag: fourCC(woff, r), data });
  }
  return writeSfnt(be32(woff, 4), tables);
}
