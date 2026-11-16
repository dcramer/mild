#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
/**
 * Verification scaffolding: `sift dashboard` for a seeded home, which asks Gmail for nothing while it runs.
 *
 *   node .claude/skills/verify-sift/scripts/serve.ts <home> <port>
 *
 * Everything else is the real command's parts: the same store, controls, server, sign-in and policy.
 */
import { resolve } from 'node:path';
import { nodeHost, serveDashboard } from '../../../../src/cli/host.ts';
import { WEB_DIST } from '../../../../src/cli/web-build.ts';
import { site } from '../../../../src/app/site.ts';
import { ui } from '../../../../src/cli/ui.ts';
import { loadConfig } from '../../../../src/config.ts';
import { memoryEphemeral } from '../../../../src/ephemeral/ephemeral.ts';
import { createDashboard } from '../../../../src/dashboard/server.ts';
import { buildControls } from '../../../../src/app/controls.ts';
import { buildSignIn } from '../../../../src/app/google-sign-in.ts';
import { people } from '../../../../src/store/people.ts';
import { openStore } from '../../../../src/store/store.ts';

const [home, port] = process.argv.slice(2);
if (!home || !port) throw new Error('usage: serve.ts <home> <port>');
process.env['SIFT_HOME'] = resolve(home);
const config = loadConfig();
const store = await openStore(config);
const ephemeral = memoryEphemeral();
const host = nodeHost(config, store, ephemeral, Number(port), (line) => ui.plain(line));
const built = await buildControls(config, store, { ephemeral, deviceId: 'verify-sift', running: false });
// What createSift puts together for `sift dashboard`.
const sift = {
  respond: site(
    createDashboard(people(store), {
      allowedHosts: host.allowedHosts,
      signInAddresses: host.signInAddresses,
      controls: built,
      signIn: buildSignIn(config, store),
      sessionSecret: host.sessionSecret,
      ephemeral,
    }),
    WEB_DIST,
  ),
};
const stop = await serveDashboard(config, sift, { port: Number(port) });
ui.info('Only the dashboard is running. `sift run` also reads and classifies mail.');
await new Promise<void>((done) => {
  process.once('SIGINT', done);
  process.once('SIGTERM', done);
});
stop();
await store.close();
