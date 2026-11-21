// Builds the PNG icon set from public/icons/icon.svg.
//
//   node scripts/icons/build-icons.mjs      (or: npm run icons)
//
// Outputs (written to public/icons/):
//   icon-512.png            standard rounded-square art at 512 px
//   icon-192.png            same at 192 px
//   maskable-512.png        full-bleed square, art scaled into the maskable
//                           safe zone (matches the 0.692 scale of the
//                           original maskable icon)
//   apple-touch-icon.png    full-bleed square at 180 px. Apple home-screen
//                           icons must not have transparency: iOS composites
//                           transparent pixels onto black, so the full-bleed
//                           maskable art is used instead of the rounded shape.
//
// Every PNG is re-encoded as an 8-bit palette image (the artwork uses only a
// handful of colors), which is ~40-60% smaller than the RGBA original while
// staying visually identical. Encoding is lossless for images with <= 256
// unique colors and near-lossless (edge antialiasing only) otherwise.
//
// No dependencies beyond devDependencies: rasterization uses Playwright's
// browser, PNG encoding uses node:zlib.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ICONS = path.join(ROOT, 'public', 'icons');
const MASKABLE_SCALE = 0.692; // measured from the original maskable-512.png

// ---------- PNG decode (8-bit, color types 2/3/6, non-interlaced) ----------
export function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const bitDepth = buf[24], colorType = buf[25], interlace = buf[28];
  if (bitDepth !== 8 || ![2, 3, 6].includes(colorType) || interlace !== 0)
    throw new Error(`unsupported PNG: depth=${bitDepth} color=${colorType} interlace=${interlace}`);
  let bpp, plte = null, trns = null;
  if (colorType === 3) {
    bpp = 1;
    let off = 8;
    while (off < buf.length) {
      const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
      if (type === 'PLTE') plte = buf.subarray(off + 8, off + 8 + len);
      if (type === 'tRNS') trns = buf.subarray(off + 8, off + 8 + len);
      off += 12 + len;
    }
  } else bpp = colorType === 6 ? 4 : 3;
  let off = 8; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  // pass 1: unfilter raw bytes (palette indices or channel bytes)
  const flat = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? flat[row + x - bpp] : 0;
      const b = y > 0 ? flat[prev + x] : 0;
      const c = x >= bpp && y > 0 ? flat[prev + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      flat[row + x] = v & 255;
    }
  }
  // pass 2: expand to RGBA
  const pxSize = colorType === 3 ? 4 : bpp;
  const out = Buffer.alloc(h * w * pxSize);
  for (let i = 0, o = 0; i < flat.length; i += bpp, o += pxSize) {
    if (colorType === 3) {
      const idx = flat[i];
      out[o] = plte[idx * 3]; out[o + 1] = plte[idx * 3 + 1]; out[o + 2] = plte[idx * 3 + 2];
      out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
    } else flat.copy(out, o, i, i + bpp);
  }
  return { w, h, bpp: pxSize, data: out };
}

// ---------- quantization: greedy merge in premultiplied space ----------
const premul = (r, g, b, a) => [Math.round((r * a) / 255), Math.round((g * a) / 255), Math.round((b * a) / 255), a];
function dist2(p, q) {
  const da = (p[3] - q[3]) * 2; // alpha errors weigh double
  const dr = p[0] - q[0], dg = p[1] - q[1], db = p[2] - q[2];
  return dr * dr + dg * dg + db * db + da * da;
}
function buildPalette(img, maxColors = 256) {
  const { data, bpp } = img;
  const alphaAt = (i) => (bpp === 4 ? data[i + 3] : 255);
  const map = new Map();
  for (let i = 0; i < data.length; i += bpp) {
    const key = data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (alphaAt(i) << 24);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  let colors = [...map.entries()].map(([key, n]) => {
    const r = key & 255, g = (key >>> 8) & 255, b = (key >>> 16) & 255, a = (key >>> 24) & 255;
    return { r, g, b, a, n, prem: premul(r, g, b, a) };
  });
  const stats = { unique: colors.length };
  while (colors.length > maxColors) {
    let best = null;
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const d = dist2(colors[i].prem, colors[j].prem);
        if (d === 0) { best = { i, j, cost: 0 }; break; }
        const cost = d * Math.min(colors[i].n, colors[j].n);
        if (!best || cost < best.cost) best = { i, j, cost };
      }
      if (best && best.cost === 0) break;
    }
    const { i, j } = best;
    const ki = colors[i].n >= colors[j].n ? i : j;
    const dj = ki === i ? j : i;
    colors[ki].n += colors[dj].n;
    colors.splice(dj, 1);
  }
  const pal = colors;
  const index = new Uint8Array(img.w * img.h);
  for (let p = 0, q = 0; p < data.length; p += bpp, q++) {
    const pr = premul(data[p], data[p + 1], data[p + 2], alphaAt(p));
    let bi = 0, bd = Infinity;
    for (let k = 0; k < pal.length; k++) {
      const d = dist2(pr, pal[k].prem);
      if (d < bd) { bd = d; bi = k; }
    }
    index[q] = bi;
    const q2 = premul(pal[bi].r, pal[bi].g, pal[bi].b, pal[bi].a);
    const e = Math.max(...q2.map((v, c) => Math.abs(v - pr[c])));
    if (e > (stats.maxErr ?? 0)) stats.maxErr = e;
  }
  return { pal, index, stats };
}

// ---------- PNG encode (color type 3) ----------
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePalette(w, h, pal, index) {
  const hasAlpha = pal.some((c) => c.a < 255);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 3; // 8-bit palette
  const plte = Buffer.alloc(pal.length * 3);
  pal.forEach((c, k) => { plte[k * 3] = c.r; plte[k * 3 + 1] = c.g; plte[k * 3 + 2] = c.b; });
  const trns = hasAlpha ? Buffer.from(Uint8Array.from(pal, (c) => c.a)) : null;
  const stride = w, rawRows = [];
  for (let y = 0; y < h; y++) {
    const row = index.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? index.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    let bestRow = null, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const fr = Buffer.alloc(stride + 1); fr[0] = f;
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const xv = row[x], xa = x > 0 ? row[x - 1] : 0, xb = prev[x], xc = x > 0 ? prev[x - 1] : 0;
        let v;
        if (f === 0) v = xv;
        else if (f === 1) v = xv - xa;
        else if (f === 2) v = xv - xb;
        else if (f === 3) v = xv - ((xa + xb) >> 1);
        else {
          const p = xa + xb - xc, pa = Math.abs(p - xa), pb = Math.abs(p - xb), pc = Math.abs(p - xc);
          v = xv - (pa <= pb && pa <= pc ? xa : pb <= pc ? xb : xc);
        }
        fr[x + 1] = v & 255;
        score += Math.abs((v << 24) >> 24);
      }
      if (score < bestScore) { bestScore = score; bestRow = fr; }
    }
    rawRows.push(bestRow);
  }
  const filtered = Buffer.concat(rawRows);
  let idat = null;
  for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FILTERED, zlib.constants.Z_RLE, zlib.constants.Z_HUFFMAN_ONLY]) {
    const cand = zlib.deflateSync(filtered, { level: 9, strategy });
    if (!idat || cand.length < idat.length) idat = cand;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('PLTE', plte),
    trns && chunk('tRNS', trns),
    chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ].filter(Boolean));
}

// ---------- SVG rasterization via Playwright ----------
async function launchBrowser() {
  const { chromium } = await import('playwright');
  try {
    return await chromium.launch();
  } catch {
    // bundled browser not downloaded: fall back to a system Edge/Chrome
    return await chromium.launch({ channel: 'msedge' });
  }
}
async function rasterize(svgText, size) {
  const sized = svgText.replace('<svg xmlns="http://www.w3.org/2000/svg"', `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"`);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas id="c"></canvas>');
    return await page.evaluate(async ({ src, size }) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('SVG failed to load')); img.src = src; });
      const c = document.getElementById('c');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, size, size);
      return c.toDataURL('image/png').split(',')[1];
    }, { src: 'data:image/svg+xml;base64,' + Buffer.from(sized).toString('base64'), size });
  } finally {
    await browser.close();
  }
}

// ---------- build ----------
const svg = fs.readFileSync(path.join(ICONS, 'icon.svg'), 'utf8');
const maskableSvg = svg
  .replace('<rect width="512" height="512" rx="104" fill="#1a5fb4"/>', '<rect width="512" height="512" fill="#1a5fb4"/>')
  .replace(/(<rect width="512" height="512" fill="#1a5fb4"\/>)\n([\s\S]*)<\/svg>/, `$1\n<g transform="translate(256 256) scale(${MASKABLE_SCALE}) translate(-256 -256)">\n$2</g>\n</svg>`);

const jobs = [
  { file: 'icon-512.png', svg, size: 512 },
  { file: 'icon-192.png', svg, size: 192 },
  { file: 'maskable-512.png', svg: maskableSvg, size: 512 },
  { file: 'apple-touch-icon.png', svg: maskableSvg, size: 180 },
];

const report = [];
for (const job of jobs) {
  const raster = Buffer.from(await rasterize(job.svg, job.size), 'base64');
  const img = decode(raster);
  const { pal, index, stats } = buildPalette(img, 256);
  const out = encodePalette(img.w, img.h, pal, index);
  const back = decode(out);
  let maxD = 0;
  for (let p = 0, q = 0; p < img.data.length; p += img.bpp, q += back.bpp) {
    const pa = img.bpp === 4 ? img.data[p + 3] : 255, pb = back.bpp === 4 ? back.data[q + 3] : 255;
    const P = premul(img.data[p], img.data[p + 1], img.data[p + 2], pa);
    const Q = premul(back.data[q], back.data[q + 1], back.data[q + 2], pb);
    for (let c = 0; c < 4; c++) maxD = Math.max(maxD, Math.abs(P[c] - Q[c]));
  }
  if (maxD > 12) throw new Error(`${job.file}: unexpected pixel error ${maxD}/255`);
  const before = fs.existsSync(path.join(ICONS, job.file)) ? fs.statSync(path.join(ICONS, job.file)).size : 0;
  fs.writeFileSync(path.join(ICONS, job.file), out);
  report.push({ file: job.file, size: `${job.size}`, colors: stats.unique <= 256 ? `${stats.unique} (lossless)` : `256 of ${stats.unique}`, maxErr: `${maxD}/255`, bytes: `${before ? `${before.toLocaleString('en-US')} -> ` : ''}${out.length.toLocaleString('en-US')}` });
}
console.table(report);
