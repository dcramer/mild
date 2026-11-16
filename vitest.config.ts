import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // picocolors colours even piped output when CI is set; the CLI's tests read it as plain text.
  test: {
    exclude: [...configDefaults.exclude, '.claude/**'],
    env: { NO_COLOR: '1' },
    // Each test file starts PGlite and migrates it once, and with every file starting at the same time that can take a while.
    testTimeout: 30_000,
  },
});
