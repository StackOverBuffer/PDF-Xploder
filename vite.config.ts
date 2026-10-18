import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Serve pdf.js's character maps (CJK and other CID fonts) and standard font
 * data (non-embedded fonts like Arial) under pdfjs/ in dev and the build.
 */
function pdfjsAssets(): Plugin {
  const root = fileURLToPath(new URL('./node_modules/pdfjs-dist/', import.meta.url));
  const dirs = ['cmaps', 'standard_fonts'];
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/pdfjs\/(cmaps|standard_fonts)\/([\w.-]+)$/.exec((req.url ?? '').split('?')[0]);
        if (!m) return next();
        try {
          res.setHeader('Content-Type', 'application/octet-stream');
          res.end(readFileSync(`${root}${m[1]}/${m[2]}`));
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const dir of dirs) {
        for (const f of readdirSync(root + dir)) {
          if (/\.(bcmap|pfb|ttf|otf)$/.test(f) || f.startsWith('LICENSE')) this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${f}`, source: readFileSync(`${root}${dir}/${f}`) });
        }
      }
    },
  };
}

/** Write the offline service worker (pwa/sw.js) into the build with the list of every built file. */
function pwa(): Plugin {
  let outDir = 'dist';
  const list = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(join(dir, e.name)) : [join(dir, e.name)]));
  return {
    name: 'pwa-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = list(outDir)
        .map((f) => relative(outDir, f).split(sep).join('/'))
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !/(^|\/)(LICENSE|OFL)[^/]*$/.test(f))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const sw = readFileSync(fileURLToPath(new URL('./pwa/sw.js', import.meta.url)), 'utf8')
        .replace('self.__FILES__', JSON.stringify(files.map((f) => (f === 'index.html' ? './' : f)).concat('index.html')))
        .replace('self.__VERSION__', JSON.stringify(hash.digest('hex').slice(0, 12)));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  // Served from a sub-path on GitHub Pages (e.g. /PDF-Xploder/); see .github/workflows/pages.yml.
  base: process.env.BASE_PATH || '/',
  plugins: [react(), pdfjsAssets(), pwa()],
  resolve: {
    alias: {
      // Internal module of @cantoo/pdf-lib (not in its package exports) used to
      // derive a file's encryption key from a password. See src/lib/security.ts.
      'pdf-lib-internal/crypto': fileURLToPath(new URL('./node_modules/@cantoo/pdf-lib/es/core/crypto.js', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          pdfjs: ['pdfjs-dist'],
          'pdf-lib': ['@cantoo/pdf-lib'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  // The PDF worker loads fonts and other parts on demand: it has to be a module.
  worker: { format: 'es' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  // RSA key generation and full-document round trips can take a while on slow disks.
  test: { environment: 'node', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'], testTimeout: 120_000 },
});
