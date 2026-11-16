import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';

const DIST = resolve(import.meta.dirname, './dist');

/**
 * Writes `/sw.js` from `src/sw.js` once the page is built, telling it which files to keep: the page,
 * its script and style, and the Latin fonts. Other fonts are kept the first time a page uses them.
 * Its version is a hash of those files, so a new build replaces what an installed app kept.
 */
function serviceWorker(): Plugin {
  return {
    name: 'sift-service-worker',
    apply: 'build',
    closeBundle() {
      const shell = [
        '/index.html',
        ...readdirSync(join(DIST, 'assets'))
          .filter((name) => /\.(js|css)$/.test(name) || /-latin-[^/]*\.woff2$/.test(name))
          .toSorted()
          .map((name) => `/assets/${name}`),
      ];
      const hash = createHash('sha256');
      for (const path of shell) hash.update(path).update(readFileSync(join(DIST, path)));
      const source = readFileSync(resolve(import.meta.dirname, './src/sw.js'), 'utf8');
      writeFileSync(join(DIST, 'sw.js'), `const SHELL = ${JSON.stringify(shell)};\nconst VERSION = '${hash.digest('hex').slice(0, 16)}';\n${source}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  resolve: { alias: { '@': resolve(import.meta.dirname, './src') } },
  build: {
    // The dashboard is served under a content security policy with no inline script or style.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
});
