import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as P from './src/lib/content/page';
it('o', async () => { const bytes = new Uint8Array(readFileSync(process.argv.find(a=>a.endsWith('.pdf')) ?? '/tmp/claude-0/-home-user/aee4c73b-d2aa-54d6-ac98-7c6f44a65e71/scratchpad/ares.pdf'));
  console.log(Object.keys(P)); });
