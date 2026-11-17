import { workflow } from '@workflow/vitest';
import { configDefaults, defineConfig } from 'vitest/config';

const WORKFLOW_TESTS = 'tests/**/*.workflow.test.ts';

/** Every project's. */
const shared = {
  // picocolors colours even piped output when CI is set; the CLI's tests read it as plain text.
  // Days, times and numbers come out the same on every machine: a test's day boundary is UTC's, and 1234 is "1,234".
  env: { NO_COLOR: '1', TZ: 'UTC', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
  setupFiles: ['tests/setup.ts'],
  // What one test stubs or records is gone before the next: `vi.stubEnv`, `vi.stubGlobal`, and a mock's calls.
  unstubEnvs: true,
  unstubGlobals: true,
  clearMocks: true,
  // Each test file that uses the database starts its own PGlite, and with every file starting at once that can take a while.
  testTimeout: 30_000,
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...shared,
          name: 'unit',
          exclude: [...configDefaults.exclude, '.claude/**', 'e2e/**', WORKFLOW_TESTS],
          globalSetup: ['tests/global-setup.ts'],
        },
      },
      {
        // Workflow's build of src/ and its Local World, in the test process, for the tests that start runs.
        plugins: [workflow({ rootDir: 'node_modules/.cache/workflow-vitest' })],
        test: { ...shared, name: 'workflow', include: [WORKFLOW_TESTS] },
      },
    ],
  },
});
