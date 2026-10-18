import { readFile } from 'node:fs/promises';
import { setFontSource } from '../src/lib/fonts';
import { setSubsetWasmLoader } from '../src/lib/subset';
import { loadLanguage } from '../src/lib/i18n';

await loadLanguage('de');

// Read bundled fonts from disk. The on-demand CJK fonts are "offline" in tests
// unless CJK_FONT / KR_FONT point to local copies of Noto Sans SC / KR.
const files: Record<string, string> = {
  sans: 'public/fonts/NotoSans-Regular.ttf',
  sansBold: 'public/fonts/NotoSans-Bold.ttf',
  symbols: 'public/fonts/NotoSansSymbols2-Regular.ttf',
};
setFontSource(async (key) => {
  const path = files[key] ?? (key.startsWith('cjk') ? process.env.CJK_FONT : key.startsWith('kr') ? process.env.KR_FONT : undefined);
  return path ? new Uint8Array(await readFile(path)) : null;
});

setSubsetWasmLoader(() => readFile('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm'));
