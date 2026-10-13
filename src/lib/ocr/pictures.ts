/**
 * Picture regions: areas with ink (or colour) that is neither recognised text
 * nor ruling lines, found as connected blobs on a coarse grid.
 */
import { clampBox, lum, type Box, type Raster, type RGB } from './raster';

export function detectPictures(img: Raster, bg: RGB, exclude: Box[], dpi: number): Box[] {
  const { width: w, height: h, data } = img;
  const cell = Math.max(4, Math.round(dpi / 24));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const excluded = new Uint8Array(w * h);
  for (const b of exclude) {
    const c = clampBox(b, w, h);
    for (let y = c.y0; y < c.y1; y++) excluded.fill(1, y * w + c.x0, y * w + c.x1);
  }
  const bgL = lum(...bg);
  const active = new Uint8Array(gw * gh);
  const step = Math.max(1, Math.floor(cell / 4));
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      let n = 0;
      let k = 0;
      for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y += step)
        for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x += step) {
          n++;
          const i = y * w + x;
          if (excluded[i]) continue;
          const o = i * 4;
          const d = Math.abs(lum(data[o], data[o + 1], data[o + 2]) - bgL) + (Math.abs(data[o] - bg[0]) + Math.abs(data[o + 1] - bg[1]) + Math.abs(data[o + 2] - bg[2])) / 3;
          if (d > 60) k++;
        }
      if (n && k / n >= 0.08) active[gy * gw + gx] = 1;
    }
  // Close small gaps, then flood-fill connected cells.
  const closed = new Uint8Array(active.length);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      if (!active[gy * gw + gx]) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = gx + dx;
          const y = gy + dy;
          if (x >= 0 && y >= 0 && x < gw && y < gh) closed[y * gw + x] = 1;
        }
    }
  const seen = new Uint8Array(active.length);
  const min = (dpi * 0.3) / cell;
  const out: Box[] = [];
  for (let i = 0; i < closed.length; i++) {
    if (!closed[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let [x0, y0, x1, y1, count] = [gw, gh, 0, 0, 0];
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % gw;
      const y = (j - x) / gw;
      if (active[j]) count++;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
      for (const k of [j - 1, j + 1, j - gw, j + gw]) {
        if (k < 0 || k >= closed.length || seen[k] || !closed[k]) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === gw - 1)) continue;
        seen[k] = 1;
        stack.push(k);
      }
    }
    // The dilation grew the blob by a cell on each side.
    const bw = x1 - x0 - 2;
    const bh = y1 - y0 - 2;
    if (bw >= min && bh >= min && count >= bw * bh * 0.2)
      out.push(clampBox({ x0: (x0 + 1) * cell, y0: (y0 + 1) * cell, x1: (x1 - 1) * cell, y1: (y1 - 1) * cell }, w, h));
  }
  return out;
}
