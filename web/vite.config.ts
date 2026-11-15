import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, './src') } },
  build: {
    // The dashboard is served under a content security policy with no inline script or style.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
  // `pnpm dev:web` serves the page with hot reload and takes its data from a running `sift dashboard`.
  server: { proxy: { '/api': 'http://localhost:8787' } },
});
