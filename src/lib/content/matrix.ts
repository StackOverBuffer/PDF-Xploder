/** PDF transformation matrices [a b c d e f]: a point (x, y) maps to (ax + cy + e, bx + dy + f). */
export type M = [number, number, number, number, number, number];

export const IDENTITY: M = [1, 0, 0, 1, 0, 0];

/** m1 then m2 (the PDF product m1 × m2, as `m1 cm` inside a CTM of m2). */
export function mul(m1: M, m2: M): M {
  const [a, b, c, d, e, f] = m1;
  const [A, B, C, D, E, F] = m2;
  return [a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F];
}

export function inv(m: M): M | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function apply(m: M, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export const translate = (x: number, y: number): M => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy: number): M => [sx, 0, 0, sy, 0, 0];
export function rotate(deg: number): M {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
}

/** Transform about a fixed point: move it to the origin, apply m, move back. */
export function about(m: M, x: number, y: number): M {
  return mul(mul(translate(-x, -y), m), translate(x, y));
}

export const isIdentity = (m: M) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);

/** Largest scale factor of the matrix (for line widths). */
export const maxScale = (m: M) => Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
