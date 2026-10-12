import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          pdfjs: ['pdfjs-dist'],
          'pdf-lib': ['pdf-lib'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
