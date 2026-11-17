import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // picocolors colours even piped output when CI is set; the CLI's tests read it as plain text.
  test: {
    exclude: [...configDefaults.exclude, '.claude/**', 'e2e/**'],
    // Days, times and numbers come out the same on every machine: a test's day boundary is UTC's, and 1234 is "1,234".
    env: { NO_COLOR: '1', TZ: 'UTC', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    // What one test stubs or records is gone before the next: `vi.stubEnv`, `vi.stubGlobal`, and a mock's calls.
    unstubEnvs: true,
    unstubGlobals: true,
    clearMocks: true,
    // Each test file that uses the database starts its own PGlite, and with every file starting at once that can take a while.
    testTimeout: 30_000,
  },
});
