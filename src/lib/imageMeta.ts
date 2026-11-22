/**
 * Camera and editor metadata in images the user adds (EXIF with GPS position, camera
 * serial numbers, XMP, IPTC, comments): removed without re-encoding, so the pixels stay
 * exactly as they are. Colour data (ICC profiles, the Adobe marker) is kept.
 */

/** The EXIF orientation of a JPEG (1 = upright), or 1 when it has none. */
export function jpegOrientation(b: Uint8Array): number {
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xda) break;
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10; // the TIFF header after "Exif\0\0"
      const le = b[t] === 0x49;
      const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o: number) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
      const ifd = t + u32(t + 4);
      const n = ifd + 2 <= b.length ? u16(ifd) : 0;
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 12 > b.length) break;
        if (u16(e) === 0x0112) return u16(e + 8) || 1;
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

/** A JPEG without its APP1 (EXIF, XMP), APP13 (IPTC) and other APPn segments, and comments. */
export function stripJpegMetadata(b: Uint8Array): Uint8Array {
  if (b[0] !== 0xff || b[1] !== 0xd8) return b;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xda) break; // start of scan: the rest is image data
    const len = (b[i + 2] << 8) | b[i + 3];
    const end = i + 2 + len;
    if (end > b.length) return b;
    // Kept: JFIF (APP0), the ICC profile (APP2) and Adobe's colour transform (APP14).
    const drop = marker === 0xfe || (marker >= 0xe1 && marker <= 0xef && marker !== 0xe2 && marker !== 0xee);
    if (!drop) parts.push(b.subarray(i, end));
    i = end;
  }
  parts.push(b.subarray(i));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, (o += p.length) - p.length);
  return out;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Text and metadata chunks: EXIF, text (author, software, comments), XMP (in iTXt) and time. */
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

/** A PNG without its metadata chunks. */
export function stripPngMetadata(b: Uint8Array): Uint8Array {
  if (!PNG_SIG.every((v, k) => b[k] === v)) return b;
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const end = i + 12 + len;
    if (end > b.length) return b;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (!PNG_DROP.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, (o += p.length) - p.length);
  return out;
}

function toBytes(dataUrl: string): Uint8Array {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toDataUrl(mime: string, b: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/**
 * A PNG or JPEG data URL without metadata. `rotated` is true for a JPEG that the camera
 * stored sideways (EXIF orientation): it has to be drawn upright and re-encoded.
 */
export function cleanImageDataUrl(src: string): { src: string; rotated: boolean } {
  const png = /^data:image\/png/.test(src);
  const bytes = toBytes(src);
  if (png) return { src: toDataUrl('image/png', stripPngMetadata(bytes)), rotated: false };
  if (jpegOrientation(bytes) !== 1) return { src, rotated: true };
  return { src: toDataUrl('image/jpeg', stripJpegMetadata(bytes)), rotated: false };
}
