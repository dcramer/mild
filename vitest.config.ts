import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // picocolors colours even piped output when CI is set; the CLI's tests read it as plain text.
  test: { exclude: [...configDefaults.exclude, '.claude/**'], env: { NO_COLOR: '1' } },
});
