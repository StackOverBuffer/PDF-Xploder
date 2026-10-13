/** A minimal DER reader that keeps exact byte offsets (needed to verify signatures). */

export interface Tlv {
  tag: number;
  /** Offset of the tag byte. */
  start: number;
  /** Offset of the first content byte. */
  contentStart: number;
  /** Offset just past the content. */
  end: number;
  constructed: boolean;
  children: Tlv[];
}

export function parseDer(bytes: Uint8Array, offset = 0, end = bytes.length): Tlv {
  const tag = bytes[offset];
  let p = offset + 1;
  let len = bytes[p++];
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error('Unsupported DER length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + bytes[p++];
  }
  const contentEnd = p + len;
  if (contentEnd > end) throw new Error('Truncated DER');
  const constructed = (tag & 0x20) !== 0;
  const children: Tlv[] = [];
  if (constructed) {
    let q = p;
    while (q < contentEnd) {
      const child = parseDer(bytes, q, contentEnd);
      children.push(child);
      q = child.end;
    }
  }
  return { tag, start: offset, contentStart: p, end: contentEnd, constructed, children };
}

export const content = (b: Uint8Array, t: Tlv) => b.subarray(t.contentStart, t.end);
export const whole = (b: Uint8Array, t: Tlv) => b.subarray(t.start, t.end);

export function oid(b: Uint8Array, t: Tlv): string {
  const c = content(b, t);
  const parts = [Math.floor(c[0] / 40), c[0] % 40];
  let v = 0;
  for (let i = 1; i < c.length; i++) {
    v = v * 128 + (c[i] & 0x7f);
    if (!(c[i] & 0x80)) {
      parts.push(v);
      v = 0;
    }
  }
  return parts.join('.');
}

export function text(b: Uint8Array, t: Tlv): string {
  const c = content(b, t);
  if (t.tag === 0x1e) {
    // BMPString: UTF-16BE
    let s = '';
    for (let i = 0; i + 1 < c.length; i += 2) s += String.fromCharCode((c[i] << 8) | c[i + 1]);
    return s;
  }
  return new TextDecoder(t.tag === 0x0c ? 'utf-8' : 'latin1').decode(c);
}

export function time(b: Uint8Array, t: Tlv): Date {
  const s = new TextDecoder('latin1').decode(content(b, t));
  const m = s.match(/^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/);
  if (!m) return new Date(NaN);
  let y = Number(m[1]);
  if (m[1].length === 2) y += y < 50 ? 2000 : 1900; // UTCTime
  return new Date(Date.UTC(y, +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)));
}

export function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Distinguished name as "CN=…, O=…" plus its common name. */
export function name(b: Uint8Array, t: Tlv): { dn: string; cn?: string; o?: string; email?: string } {
  const labels: Record<string, string> = { '2.5.4.3': 'CN', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST', '1.2.840.113549.1.9.1': 'E' };
  const parts: string[] = [];
  const out: { dn: string; cn?: string; o?: string; email?: string } = { dn: '' };
  for (const rdn of t.children) {
    for (const atv of rdn.children) {
      const id = oid(b, atv.children[0]);
      const v = text(b, atv.children[1]);
      const label = labels[id] ?? id;
      parts.push(`${label}=${v}`);
      if (label === 'CN') out.cn = v;
      if (label === 'O') out.o = v;
      if (label === 'E') out.email = v;
    }
  }
  out.dn = parts.join(', ');
  return out;
}
