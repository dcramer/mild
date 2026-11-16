import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // picocolors colours even piped output when CI is set; the CLI's tests read it as plain text.
  test: {
    exclude: [...configDefaults.exclude, '.claude/**'],
    env: { NO_COLOR: '1' },
    globalSetup: ['tests/global-setup.ts'],
    // Each test file that uses the database starts its own PGlite, and with every file starting at once that can take a while.
    testTimeout: 30_000,
  },
});
