import { defineConfig } from 'vite';

// Builds storefront assets into public/build with a manifest that the
// Nunjucks `asset()` helper reads to resolve hashed filenames.
export default defineConfig({
  // Static files are served by Nest/LiteSpeed from /public — Vite doesn't own it.
  publicDir: false,
  build: {
    manifest: true,
    outDir: 'public/build',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'src/client/main.ts',
        styles: 'src/client/styles.css',
      },
    },
  },
});
