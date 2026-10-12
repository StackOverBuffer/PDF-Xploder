import { rgb, type RGB } from 'pdf-lib';

export function hexToRgbTuple(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function hexToRgb(hex: string): RGB {
  const [r, g, b] = hexToRgbTuple(hex);
  return rgb(r, g, b);
}
