import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
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

export default defineConfig({
  // Served from a sub-path on GitHub Pages (e.g. /PDF-Xploder/); see .github/workflows/pages.yml.
  base: process.env.BASE_PATH || '/',
  plugins: [react(), pdfjsAssets()],
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
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
