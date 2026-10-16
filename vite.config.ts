import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist/umpire', emptyOutDir: true, chunkSizeWarningLimit: 800 },
});
