#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
/**
 * Verification scaffolding: `sift dashboard` for a seeded home, with the one thing it asks Gmail for while
 * it runs (a message's HTML) answered from here instead.
 *
 *   node .claude/skills/verify-sift/scripts/serve.ts <home> <port>
 *
 * Everything else is the real command's parts: the same store, controls, server, sign-in and policy.
 */
import { resolve } from 'node:path';
import { dashboardAddresses, serveDashboard, sessionSecret } from '../../../../src/cli/host.ts';
import { ui } from '../../../../src/cli/ui.ts';
import { loadConfig } from '../../../../src/config.ts';
import { memoryEphemeral } from '../../../../src/ephemeral/ephemeral.ts';
import { createDashboard } from '../../../../src/dashboard/server.ts';
import { buildControls } from '../../../../src/app/controls.ts';
import { buildSignIn } from '../../../../src/app/google-sign-in.ts';
import { people } from '../../../../src/store/people.ts';
import { openStore } from '../../../../src/store/store.ts';

/**
 * The seed's Deals mail (m4) as its HTML part: a remote image, a background from elsewhere, inline styles,
 * a link, and the things the frame must never run or follow. The hosts are on example.com, which resolves,
 * so a request that got out would be seen.
 */
const HTML: Record<string, string> = {
  m4: `<!DOCTYPE html><html><head><title>Deals</title><meta http-equiv="refresh" content="5;url=https://track.example.com/refresh"></head>
<body style="margin:0;background:#f4efe6;font-family:Georgia,serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="600" style="max-width:100%;background:#ffffff;border:1px solid #ddd">
<tr><td style="padding:0"><img src="https://images.example.com/hero.png" width="600" height="200" alt="48 hours only" style="display:block;width:100%;height:auto"></td></tr>
<tr><td style="padding:24px;color:#222;background-image:url(https://images.example.com/paper.png)">
<h1 style="margin:0 0 12px;font-size:28px;color:#b3261e">30% off everything</h1>
<p style="font-size:16px;line-height:1.5">Everything must go. The sale ends in 48 hours.</p>
<p><a href="https://shop.example.com/sale" style="display:inline-block;padding:12px 20px;background:#222;color:#fff;text-decoration:none">Shop the sale</a></p>
<p style="font-size:12px;color:#777"><a href="javascript:alert('clicked')" onclick="alert('clicked')">Preferences</a> · <a href="https://promo.example.com/unsubscribe">Unsubscribe</a></p>
</td></tr></table>
<img src="https://track.example.com/open.gif?u=me" width="1" height="1" alt="">
</td></tr></table>
<script>document.body.dataset.ran = 'yes'</script>
</body></html>`,
};

const [home, port] = process.argv.slice(2);
if (!home || !port) throw new Error('usage: serve.ts <home> <port>');
process.env['SIFT_HOME'] = resolve(home);
const config = loadConfig();
const store = await openStore(config);
const ephemeral = memoryEphemeral();
const secret = sessionSecret(config);
const built = await buildControls(config, store, { ephemeral, deviceId: 'verify-sift', running: false });
// What createSift puts together for `sift dashboard`, with the one thing it asks Gmail for while it runs answered here.
const sift = createDashboard(people(store), {
  ...dashboardAddresses(config, Number(port)),
  controls: { ...built, messageHtml: async (_db, _account, id) => HTML[id] ?? null },
  signIn: buildSignIn(config, store),
  sessionSecret: secret,
  ephemeral,
});
const stop = await serveDashboard(config, sift, { port: Number(port) });
ui.info('Only the dashboard is running. `sift run` also reads and classifies mail.');
await new Promise<void>((done) => {
  process.once('SIGINT', done);
  process.once('SIGTERM', done);
});
stop();
await store.close();
