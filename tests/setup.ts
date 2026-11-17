// Run before each test file. What the shell running the tests has set is not the tests' to read: a deploy's
// variables, a provider's key or a home of sift's would change what the code under test does. A test that
// needs one sets it with `vi.stubEnv`, which is undone after the test.
const OURS = /^(SIFT_|VERCEL_)|^(DATABASE_URL|DATABASE_MIGRATION_URL|REDIS_URL|SENTRY_DSN|CRON_SECRET|XDG_CONFIG_HOME)$|_API_KEY$/;
/** Opt-ins the suite itself reads: a disposable Redis to run the Ephemeral tests against too. */
const KEPT = new Set(['SIFT_TEST_REDIS_URL']);
for (const name of Object.keys(process.env)) if (OURS.test(name) && !KEPT.has(name)) delete process.env[name];
