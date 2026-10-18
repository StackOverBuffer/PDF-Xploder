/**
 * QR codes and barcodes (Code 128, EAN-13) for inserting into documents.
 * QR encoding comes from qrcode-generator; the 1D symbologies are encoded here.
 */
import qrcode from 'qrcode-generator';

export type BarcodeKind = 'qr' | 'code128' | 'ean13';
export type QrLevel = 'L' | 'M' | 'Q' | 'H';

/** Dark/light modules of a QR code (row by row), for any text (UTF-8). */
export function qrModules(text: string, level: QrLevel = 'M'): boolean[][] {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const qr = qrcode(0, level);
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

// ---------------------------------------------------------------- Code 128

/** Bar/space widths of the 107 Code 128 symbols (106 is the stop pattern, 7 elements). */
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;

/**
 * Module widths (bar, space, bar, …) of a Code 128 barcode. Uses code set C for
 * runs of digits (compact) and B for everything else; characters outside ASCII
 * 32–126 are rejected.
 */
export function code128Widths(text: string): number[] {
  if (!text) throw new Error('Enter the text for the barcode.');
  if (/[^\x20-\x7e]/.test(text)) throw new Error('Code 128 supports letters, digits and common symbols only (no accents).');
  const codes: number[] = [];
  let set: 'B' | 'C' | null = null;
  let i = 0;
  const digitRun = (from: number) => {
    let n = 0;
    while (from + n < text.length && /\d/.test(text[from + n])) n++;
    return n;
  };
  while (i < text.length) {
    const run = digitRun(i);
    // Code set C pays off for 4+ digits (2 digits per symbol); use an even count.
    if (run >= 4 || (run >= 2 && set === 'C')) {
      const even = run - (run % 2);
      if (set !== 'C') codes.push(set === null ? START_C : CODE_C);
      set = 'C';
      for (let k = 0; k < even; k += 2) codes.push(Number(text.slice(i + k, i + k + 2)));
      i += even;
      continue;
    }
    if (set !== 'B') codes.push(set === null ? START_B : CODE_B);
    set = 'B';
    codes.push(text.charCodeAt(i) - 32);
    i++;
  }
  // Checksum: start value plus each symbol's value times its position.
  let sum = codes[0];
  for (let k = 1; k < codes.length; k++) sum += codes[k] * k;
  codes.push(sum % 103, 106);
  return codes.flatMap((c) => [...C128[c]].map(Number));
}

// ---------------------------------------------------------------- EAN-13

const EAN_L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'];
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/** The 13 digits (with check digit) for 12 or 13 entered digits; throws for anything else. */
export function ean13Digits(input: string): string {
  const d = input.replace(/\s/g, '');
  if (!/^\d{12,13}$/.test(d)) throw new Error('An EAN-13 code has 12 digits (the 13th, the check digit, is added).');
  const check = ean13CheckDigit(d.slice(0, 12));
  if (d.length === 13 && Number(d[12]) !== check) throw new Error('The check digit (the last digit) is wrong.');
  return d.slice(0, 12) + check;
}

/** Module widths of an EAN-13 barcode (guard bars included). */
export function ean13Widths(input: string): number[] {
  const d = ean13Digits(input);
  const parity = EAN_PARITY[Number(d[0])];
  const out = [1, 1, 1];
  for (let i = 1; i <= 6; i++) {
    const w = [...EAN_L[Number(d[i])]].map(Number);
    // G codes are the L codes mirrored.
    out.push(...(parity[i - 1] === 'G' ? w.reverse() : w));
  }
  out.push(1, 1, 1, 1, 1);
  for (let i = 7; i <= 12; i++) out.push(...[...EAN_L[Number(d[i])]].map(Number));
  out.push(1, 1, 1);
  return out;
}

// ---------------------------------------------------------------- drawing

export interface BarcodeOptions {
  kind: BarcodeKind;
  text: string;
  level?: QrLevel;
  /** Print the text under a 1D barcode. */
  caption?: boolean;
  color?: string;
}

/**
 * Draw the code onto a canvas at `px` pixels per module (white background, quiet zone
 * included). Returns the canvas and the code's size in modules.
 */
export function drawBarcode(o: BarcodeOptions, px = 8): { canvas: HTMLCanvasElement; modules: { w: number; h: number } } {
  const color = o.color ?? '#000000';
  const canvas = document.createElement('canvas');
  const g = () => canvas.getContext('2d')!;
  if (o.kind === 'qr') {
    if (!o.text) throw new Error('Enter the text or link for the QR code.');
    const m = qrModules(o.text, o.level ?? 'M');
    const quiet = 4;
    const n = m.length + quiet * 2;
    canvas.width = canvas.height = n * px;
    const ctx = g();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    m.forEach((row, r) => row.forEach((dark, c) => dark && ctx.fillRect((c + quiet) * px, (r + quiet) * px, px, px)));
    return { canvas, modules: { w: n, h: n } };
  }
  const widths = o.kind === 'ean13' ? ean13Widths(o.text) : code128Widths(o.text);
  const quiet = 10;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  // A height of about a quarter of the width (at least 30 modules), plus room for the caption.
  const barH = Math.max(30, Math.round(total * 0.25));
  const captionH = o.caption ? 12 : 0;
  canvas.width = total * px;
  canvas.height = (barH + captionH + 4) * px;
  const ctx = g();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  let x = quiet;
  widths.forEach((w, i) => {
    if (i % 2 === 0) ctx.fillRect(x * px, 2 * px, w * px, barH * px);
    x += w;
  });
  if (o.caption) {
    const text = o.kind === 'ean13' ? ean13Digits(o.text) : o.text;
    ctx.font = `${10 * px}px "Noto Sans", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(text, canvas.width / 2, (barH + 3) * px, canvas.width - 2 * quiet * px);
  }
  return { canvas, modules: { w: total, h: barH + captionH + 4 } };
}
