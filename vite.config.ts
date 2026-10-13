import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
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
