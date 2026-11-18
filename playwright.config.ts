import { defineConfig, devices } from '@playwright/test';

/** The whole-hour zone where it is now midday. `Etc/GMT-5` is five hours ahead of UTC: the sign is POSIX's. */
const middayZone = () => {
  const ahead = 12 - new Date().getUTCHours();
  return ahead === 0 ? 'Etc/GMT' : `Etc/GMT${ahead > 0 ? '-' : '+'}${Math.abs(ahead)}`;
};
// Midday wherever the run is: a day boundary is twelve hours away, so the seed's mail, decided just now, stays
// "today" for the whole run. Chosen once: the workers load this file again, and inherit the choice. The seed and
// each server read it as TZ; the browser as its `timezoneId`.
const zone = (process.env['SIFT_E2E_TZ'] ??= middayZone());
process.env['TZ'] = zone;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  // Each test has its own seeded home and server, so they run in parallel without meeting.
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  workers: process.env['CI'] ? '100%' : undefined,
  retries: 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    // Dates and times are written in the browser's own locale; tests read them in this one.
    locale: 'en-US',
    timezoneId: zone,
    trace: 'retain-on-failure',
  },
});
