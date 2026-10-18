/**
 * Font subsetting with HarfBuzz's hb-subset (WebAssembly). pdf-lib's own
 * subsetter (fontkit 1.x) corrupts glyphs of modern fonts such as Noto Sans,
 * so fonts are subset here and then embedded whole.
 */
import wasmUrl from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url';

interface HbExports {
  memory: WebAssembly.Memory;
  malloc(n: number): number;
  free(p: number): void;
  hb_blob_create(data: number, len: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(b: number): void;
  hb_blob_get_data(b: number, lenPtr: number): number;
  hb_blob_get_length(b: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(f: number): void;
  hb_face_reference_blob(f: number): number;
  hb_set_add(set: number, cp: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(i: number): void;
  hb_subset_input_unicode_set(i: number): number;
  hb_subset_input_set_flags(i: number, flags: number): void;
  hb_subset_or_fail(face: number, input: number): number;
}

const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_FLAGS_NO_HINTING = 1;

type WasmLoader = () => Promise<BufferSource>;

let loader: WasmLoader = async () => (await fetch(wasmUrl)).arrayBuffer();
let instance: Promise<HbExports> | null = null;

/** Replace how the wasm binary is loaded (tests read it from disk). */
export function setSubsetWasmLoader(l: WasmLoader) {
  loader = l;
  instance = null;
}

function hb(): Promise<HbExports> {
  if (!instance) {
    const p = loader()
      .then((bin) => WebAssembly.instantiate(bin, {}))
      .then((r) => r.instance.exports as unknown as HbExports);
    instance = p;
    // A failed load (e.g. offline) is retried next time instead of disabling subsetting for the session.
    p.catch(() => instance === p && (instance = null));
  }
  return instance;
}

/** Return a font containing only the glyphs needed for `codepoints` (plus their layout data). */
export async function subsetFont(font: Uint8Array, codepoints: Iterable<number>): Promise<Uint8Array> {
  const ex = await hb();
  const ptr = ex.malloc(font.length);
  new Uint8Array(ex.memory.buffer).set(font, ptr);
  const blob = ex.hb_blob_create(ptr, font.length, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = ex.hb_face_create(blob, 0);
  ex.hb_blob_destroy(blob);
  const input = ex.hb_subset_input_create_or_fail();
  try {
    if (!input) throw new Error('hb_subset_input_create_or_fail failed');
    const set = ex.hb_subset_input_unicode_set(input);
    for (const cp of codepoints) ex.hb_set_add(set, cp);
    ex.hb_subset_input_set_flags(input, HB_SUBSET_FLAGS_NO_HINTING);
    const sub = ex.hb_subset_or_fail(face, input);
    if (!sub) throw new Error('Font subsetting failed');
    const out = ex.hb_face_reference_blob(sub);
    const data = ex.hb_blob_get_data(out, 0);
    const len = ex.hb_blob_get_length(out);
    // Copy out before freeing: the wasm heap may be reused.
    const result = new Uint8Array(ex.memory.buffer, data, len).slice();
    ex.hb_blob_destroy(out);
    ex.hb_face_destroy(sub);
    return result;
  } finally {
    if (input) ex.hb_subset_input_destroy(input);
    ex.hb_face_destroy(face);
    ex.free(ptr);
  }
}
