/**
 * Recently drawn page canvases, kept when a page leaves the screen (scrolled away,
 * another tab shown, another zoom level), so coming back shows it at once instead
 * of rendering it again. Bounded by pixel count; the oldest are freed first.
 */
const BUDGET_PIXELS = 40_000_000;

const entries = new Map<string, HTMLCanvasElement>();
let pixels = 0;

/** A stable id per loaded document (the key must not keep the document alive). */
const ids = new WeakMap<object, number>();
let nextId = 1;
export function docKey(pdf: object): number {
  let id = ids.get(pdf);
  if (!id) ids.set(pdf, (id = nextId++));
  return id;
}

const size = (c: HTMLCanvasElement) => c.width * c.height;

function free(key: string) {
  const c = entries.get(key);
  if (!c) return;
  entries.delete(key);
  pixels -= size(c);
  c.width = c.height = 0;
}

/** Keep a drawn canvas under `key` (or free it right away if it is too big to keep). */
export function keepCanvas(key: string, canvas: HTMLCanvasElement): void {
  free(key);
  if (size(canvas) > BUDGET_PIXELS / 4) {
    canvas.width = canvas.height = 0;
    return;
  }
  entries.set(key, canvas);
  pixels += size(canvas);
  for (const k of entries.keys()) {
    if (pixels <= BUDGET_PIXELS) break;
    free(k);
  }
}

/** Take the canvas kept under `key` out of the cache (it is then the caller's). */
export function takeCanvas(key: string): HTMLCanvasElement | null {
  const c = entries.get(key);
  if (!c) return null;
  entries.delete(key);
  pixels -= size(c);
  return c;
}
