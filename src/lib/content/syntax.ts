/**
 * Content stream syntax: tokenising operators with their operands, and writing
 * them back. Inline images (BI … ID … EI) are kept as raw bytes.
 */

export interface PdfName {
  t: 'name';
  v: string;
}
export interface PdfStr {
  t: 'str';
  bytes: Uint8Array;
  hex: boolean;
}
export interface PdfDictVal {
  t: 'dict';
  v: Map<string, Operand>;
}
export type Operand = number | boolean | null | PdfName | PdfStr | PdfDictVal | Operand[];

export interface Op {
  op: string;
  args: Operand[];
  /** Inline image: its dictionary and data (only for op 'BI'). */
  inline?: { dict: Map<string, Operand>; data: Uint8Array };
}

export const name = (v: string): PdfName => ({ t: 'name', v });
export const str = (bytes: Uint8Array, hex = true): PdfStr => ({ t: 'str', bytes, hex });
export const isName = (o: Operand): o is PdfName => typeof o === 'object' && o !== null && !Array.isArray(o) && o.t === 'name';
export const isStr = (o: Operand): o is PdfStr => typeof o === 'object' && o !== null && !Array.isArray(o) && o.t === 'str';
export const num = (o: Operand | undefined, fallback = 0): number => (typeof o === 'number' ? o : fallback);

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]); // ( ) < > [ ] { } / %
const isRegular = (c: number) => !WS.has(c) && !DELIM.has(c);

class Lexer {
  pos = 0;
  constructor(readonly b: Uint8Array) {}

  skipWs() {
    const b = this.b;
    while (this.pos < b.length) {
      const c = b[this.pos];
      if (WS.has(c)) this.pos++;
      else if (c === 37) {
        while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos++;
      } else break;
    }
  }

  /** Next token: an operand, an operator keyword (as {kw}), or null at the end. */
  next(): Operand | { kw: string } | { close: string } | undefined {
    this.skipWs();
    const b = this.b;
    if (this.pos >= b.length) return undefined;
    const c = b[this.pos];
    if (c === 47) return this.name();
    if (c === 40) return this.literal();
    if (c === 60) {
      if (b[this.pos + 1] === 60) {
        this.pos += 2;
        return this.dict();
      }
      return this.hexString();
    }
    if (c === 62 && b[this.pos + 1] === 62) {
      this.pos += 2;
      return { close: '>>' };
    }
    if (c === 91) {
      this.pos++;
      return this.array();
    }
    if (c === 93) {
      this.pos++;
      return { close: ']' };
    }
    if (c === 123 || c === 125 || c === 41 || c === 62) {
      // Stray delimiters (e.g. PostScript braces): skip.
      this.pos++;
      return this.next();
    }
    const start = this.pos;
    while (this.pos < b.length && isRegular(b[this.pos])) this.pos++;
    const word = String.fromCharCode(...b.subarray(start, this.pos));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    return { kw: word };
  }

  name(): PdfName {
    const b = this.b;
    this.pos++;
    let s = '';
    while (this.pos < b.length && isRegular(b[this.pos])) {
      const c = b[this.pos];
      if (c === 35 && this.pos + 2 < b.length) {
        const hex = String.fromCharCode(b[this.pos + 1], b[this.pos + 2]);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          s += String.fromCharCode(parseInt(hex, 16));
          this.pos += 3;
          continue;
        }
      }
      s += String.fromCharCode(c);
      this.pos++;
    }
    return name(s);
  }

  literal(): PdfStr {
    const b = this.b;
    this.pos++;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < b.length) {
      const c = b[this.pos++];
      if (c === 92) {
        const n = b[this.pos++];
        const esc: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 };
        if (n in esc) out.push(esc[n]);
        else if (n >= 48 && n <= 55) {
          let v = n - 48;
          for (let k = 0; k < 2 && b[this.pos] >= 48 && b[this.pos] <= 55; k++) v = v * 8 + (b[this.pos++] - 48);
          out.push(v & 255);
        } else if (n === 13) {
          if (b[this.pos] === 10) this.pos++;
        } else if (n !== 10) out.push(n);
        continue;
      }
      if (c === 40) depth++;
      if (c === 41 && --depth === 0) break;
      out.push(c);
    }
    return str(Uint8Array.from(out), false);
  }

  hexString(): PdfStr {
    const b = this.b;
    this.pos++;
    let hex = '';
    while (this.pos < b.length && b[this.pos] !== 62) {
      const c = b[this.pos++];
      if (!WS.has(c)) hex += String.fromCharCode(c);
    }
    this.pos++;
    if (hex.length % 2) hex += '0';
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16) || 0;
    return str(out, true);
  }

  array(): Operand[] {
    const out: Operand[] = [];
    for (;;) {
      const t = this.next();
      if (t === undefined || (typeof t === 'object' && t !== null && 'close' in t && t.close === ']')) break;
      if (typeof t === 'object' && t !== null && ('kw' in t || 'close' in t)) continue;
      out.push(t as Operand);
    }
    return out;
  }

  dict(): PdfDictVal {
    const v = new Map<string, Operand>();
    for (;;) {
      const k = this.next();
      if (k === undefined || (typeof k === 'object' && k !== null && 'close' in k)) break;
      if (!(typeof k === 'object' && k !== null && 't' in k && k.t === 'name')) continue;
      const val = this.next();
      if (val === undefined || (typeof val === 'object' && val !== null && 'close' in val)) break;
      if (typeof val === 'object' && val !== null && 'kw' in val) continue;
      v.set(k.v, val as Operand);
    }
    return { t: 'dict', v };
  }

  /** After "ID": a single whitespace byte, then data up to whitespace + "EI" + delimiter. */
  inlineData(): Uint8Array {
    const b = this.b;
    if (WS.has(b[this.pos])) this.pos++;
    const start = this.pos;
    for (let i = start; i < b.length - 1; i++) {
      if (b[i] === 69 && b[i + 1] === 73 && (i === start || WS.has(b[i - 1])) && (i + 2 >= b.length || WS.has(b[i + 2]) || DELIM.has(b[i + 2]))) {
        const end = i > start && WS.has(b[i - 1]) ? i - 1 : i;
        this.pos = i + 2;
        return b.slice(start, end);
      }
    }
    this.pos = b.length;
    return b.slice(start);
  }
}

/** Parse a content stream into operators. */
export function parseContent(bytes: Uint8Array): Op[] {
  const lx = new Lexer(bytes);
  const ops: Op[] = [];
  let args: Operand[] = [];
  for (;;) {
    const t = lx.next();
    if (t === undefined) break;
    if (typeof t === 'object' && t !== null && 'close' in t) continue;
    if (typeof t === 'object' && t !== null && 'kw' in t) {
      if (t.kw === 'BI') {
        const dict = new Map<string, Operand>();
        for (;;) {
          const k = lx.next();
          if (k === undefined) break;
          if (typeof k === 'object' && k !== null && 'kw' in k) {
            if (k.kw === 'ID') break;
            continue;
          }
          if (!(typeof k === 'object' && k !== null && 't' in k && k.t === 'name')) continue;
          const v = lx.next();
          if (typeof v === 'object' && v !== null && 'kw' in v) {
            // Abbreviated names are allowed as keyword-like values? No: keep as name.
            dict.set(k.v, name(v.kw));
            continue;
          }
          dict.set(k.v, v as Operand);
        }
        ops.push({ op: 'BI', args: [], inline: { dict, data: lx.inlineData() } });
        args = [];
        continue;
      }
      ops.push({ op: t.kw, args });
      args = [];
      continue;
    }
    args.push(t as Operand);
  }
  return ops;
}

// ---------------------------------------------------------------- writing

const enc = new TextEncoder();

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

function nameStr(v: string): string {
  let s = '/';
  for (const ch of v) {
    const c = ch.charCodeAt(0);
    s += c < 33 || c > 126 || DELIM.has(c) || c === 35 ? `#${c.toString(16).padStart(2, '0')}` : ch;
  }
  return s;
}

function strText(s: PdfStr): string {
  if (s.hex) return '<' + Array.from(s.bytes, (b) => b.toString(16).padStart(2, '0')).join('') + '>';
  let out = '(';
  for (const b of s.bytes) {
    if (b === 40 || b === 41 || b === 92) out += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) out += '\\' + b.toString(8).padStart(3, '0');
    else out += String.fromCharCode(b);
  }
  return out + ')';
}

export function operandText(o: Operand): string {
  if (typeof o === 'number') return fmtNum(o);
  if (typeof o === 'boolean') return o ? 'true' : 'false';
  if (o === null) return 'null';
  if (Array.isArray(o)) return '[' + o.map(operandText).join(' ') + ']';
  if (o.t === 'name') return nameStr(o.v);
  if (o.t === 'str') return strText(o);
  return '<<' + [...o.v].map(([k, v]) => `${nameStr(k)} ${operandText(v)}`).join(' ') + '>>';
}

/** Serialise operators to content stream bytes. */
export function writeContent(ops: Op[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let text = '';
  const flush = () => {
    if (text) parts.push(enc.encode(text));
    text = '';
  };
  for (const o of ops) {
    if (o.op === 'BI' && o.inline) {
      text += 'BI ' + [...o.inline.dict].map(([k, v]) => `${nameStr(k)} ${operandText(v)}`).join(' ') + ' ID ';
      flush();
      parts.push(o.inline.data);
      text += '\nEI\n';
      continue;
    }
    text += (o.args.length ? o.args.map(operandText).join(' ') + ' ' : '') + o.op + '\n';
  }
  flush();
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
