/**
 * The last-resort glyph donors: the handwriting faces of typed signatures
 * (signatureFonts.css), tried when no font of a fallback chain covers a character.
 * This module loads on demand (fonts.ts imports it only when a character is
 * uncovered), so the woff asset URLs stay out of the start-up bundle.
 */
import type { FontKey } from './fonts';

// The ?url imports only carry the build asset path; the bytes load on demand.
import dancingLatinUrl from '@fontsource/dancing-script/files/dancing-script-latin-400-normal.woff?url';
import dancingLatinExtUrl from '@fontsource/dancing-script/files/dancing-script-latin-ext-400-normal.woff?url';
import greatVibesLatinUrl from '@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff?url';
import greatVibesLatinExtUrl from '@fontsource/great-vibes/files/great-vibes-latin-ext-400-normal.woff?url';
import caveatLatinUrl from '@fontsource/caveat/files/caveat-latin-400-normal.woff?url';
import caveatLatinExtUrl from '@fontsource/caveat/files/caveat-latin-ext-400-normal.woff?url';
import alluraLatinUrl from '@fontsource/allura/files/allura-latin-400-normal.woff?url';
import alluraLatinExtUrl from '@fontsource/allura/files/allura-latin-ext-400-normal.woff?url';

/** The donors in the order the signature feature lists them (Dialogs.tsx). */
export const DONOR_ORDER: FontKey[] = [
  'dancingLatin', 'dancingLatinExt', 'greatVibesLatin', 'greatVibesLatinExt',
  'caveatLatin', 'caveatLatinExt', 'alluraLatin', 'alluraLatinExt',
];

/** Where each donor's bytes come from (same shapes fonts.ts fetches). */
export const DONOR_URLS: Partial<Record<FontKey, string>> = {
  dancingLatin: dancingLatinUrl,
  dancingLatinExt: dancingLatinExtUrl,
  greatVibesLatin: greatVibesLatinUrl,
  greatVibesLatinExt: greatVibesLatinExtUrl,
  caveatLatin: caveatLatinUrl,
  caveatLatinExt: caveatLatinExtUrl,
  alluraLatin: alluraLatinUrl,
  alluraLatinExt: alluraLatinExtUrl,
};
