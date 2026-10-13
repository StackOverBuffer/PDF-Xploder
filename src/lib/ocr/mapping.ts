/**
 * Coordinate mapping between the recognised image and PDF user space.
 *
 * The page is rendered by pdf.js with its viewport transform V (user space →
 * pixels, including /Rotate and the crop box). Recognition happens on that
 * image turned by q quarter turns and deskewed, so a recognised pixel maps
 * back through the inverse of each step.
 */
import { about, apply, inv, mul, rotate, type M } from '../content/matrix';

/** Pixels of a w×h image → pixels of the same image turned q quarter turns clockwise. */
export function quarterMatrix(q: number, w: number, h: number): M {
  switch (((q % 4) + 4) % 4) {
    case 1:
      return [0, 1, -1, 0, h, 0];
    case 2:
      return [-1, 0, 0, -1, w, h];
    case 3:
      return [0, -1, 1, 0, 0, w];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}

/** Pixels → pixels after rotating the content `deg` clockwise about the image centre (as rotateRaster). */
export const rotationMatrix = (deg: number, w: number, h: number): M => about(rotate(deg), w / 2, h / 2);

export interface Placement {
  /** Recognised-image pixels → user space. */
  pxToUser: M;
  /** Unit square of an image XObject showing the whole recognised image → user space. */
  imageToUser: M;
}

/**
 * Map a recognised image of size w×h into user space.
 * @param viewport pdf.js viewport transform of the frame the image is placed in
 * @param toFrame recognised pixels → pixels of that frame
 */
export function placement(viewport: M, toFrame: M, w: number, h: number): Placement {
  const frameToUser = inv(viewport);
  if (!frameToUser) throw new Error('Degenerate viewport');
  const pxToUser = mul(toFrame, frameToUser);
  return { pxToUser, imageToUser: mul([w, 0, 0, -h, 0, h], pxToUser) };
}

/** User-space length of one recognised pixel. */
export const pxScale = (m: M) => Math.hypot(m[0], m[1]);

/**
 * Text matrix for text whose baseline starts at pixel (x, y) and runs along
 * the image's x axis, with glyphs upright in the image.
 */
export function textMatrix(pxToUser: M, x: number, y: number, slant = 0): M {
  const s = pxScale(pxToUser);
  const o = apply(pxToUser, x, y);
  // Unit vectors of the image's x axis and of "up" (−y) in user space.
  const ux = pxToUser[0] / s;
  const uy = pxToUser[1] / s;
  const vx = -pxToUser[2] / s;
  const vy = -pxToUser[3] / s;
  return [ux, uy, vx + ux * slant, vy + uy * slant, o.x, o.y];
}

export { apply, inv, mul, type M };
