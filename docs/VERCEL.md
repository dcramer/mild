# Vercel

Sift on Vercel instead of a machine of your own. How it runs there is [RUNTIME.md](RUNTIME.md); this is how to set it up. Not yet run on Vercel end to end: see [TODO.md](../TODO.md).

What it needs: the **Pro** plan (Hobby runs crons once a day; Sift ticks each minute), a Postgres database (Neon) and a Redis database, both from the Vercel Marketplace, and a Google OAuth client of your own.

## 1. The project

Import this repository as a Vercel project and deploy it as it is: Vercel adds databases only to a project that exists. Root Directory: `./`, the repository root (Vercel offers `web/` because it finds Vite there, and a build from there knows nothing of `vercel.json` or the functions). Framework Preset: Other. `vercel.json` sets the build, the functions (`api/`), the minute's cron and the page's headers, and Node comes from `package.json` (24.x).

This first deploy builds without a database. Until steps 2 and 3 are done, the site says which variable it needs next.

Then, from the project's Storage tab, add Neon and a Redis database. Each sets variables of its own; Sift reads the ones in step 3.

## 2. The Google client

The project's production domain is your Sift's address: `https://<project>.vercel.app`, or your own domain once added. In Google Cloud:

1. [Create a project](https://console.cloud.google.com/projectcreate) and select it.
2. [Enable the Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
3. [Set up the consent screen](https://console.cloud.google.com/auth/overview): app name `sift`, audience External, your own address for support and contact.
4. [Create a client](https://console.cloud.google.com/auth/clients): type Web application, authorised redirect URI `https://<your domain>/auth/callback`. Keep its id and secret.
5. [Data Access](https://console.cloud.google.com/auth/scopes): add `https://www.googleapis.com/auth/gmail.modify` and `https://www.googleapis.com/auth/gmail.settings.basic`.
6. [Audience](https://console.cloud.google.com/auth/audience): add each Gmail address Sift will read as a test user. While the app is in Testing, Google ends each sign-in after 7 days and you sign in again; publishing it ends that, and may need Google's verification.

## 3. The environment

In the project's Environment Variables, for Production:

| Variable | |
| --- | --- |
| `DATABASE_URL` | Neon's pooled address. |
| `DATABASE_MIGRATION_URL` | Optional, and better: Neon's unpooled address for the owner role, with `DATABASE_URL` then a role that owns nothing (`CREATE ROLE sift LOGIN PASSWORD '…'`), so row-level security holds Sift itself. |
| `REDIS_URL` | The Redis database's `redis://` or `rediss://` address. |
| `SIFT_GOOGLE_CLIENT_ID`, `SIFT_GOOGLE_CLIENT_SECRET` | From step 2. |
| `SIFT_DASHBOARD_ALLOW` | The Google accounts that may sign in, separated by commas. Required: at a public address, without it whoever signed in first would own your Sift. |
| `SIFT_KEY` | Encrypts the credentials Sift stores ([SECRETS.md](SECRETS.md)). `openssl rand -base64 32` |
| `SIFT_SESSION_SECRET` | Signs sessions; changing it signs everyone out. `openssl rand -base64 32` |
| `CRON_SECRET` | Vercel sends it with each cron call and Sift with each piece of work it hands out; nothing without it can start work. `openssl rand -hex 32` |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`, so the build uses the pnpm `package.json` names. |
| `SIFT_DASHBOARD_HOST` | Only with a domain of your own: that domain. |
| `SIFT_CHATGPT_SIGN_IN` | Only to change how people sign in to ChatGPT ([CLI.md](CLI.md#models)). |

Sift refuses to start without the required ones and says which is missing.

## 4. Deploy again

Redeploy production, so the build sees the variables: it migrates the database before the new functions serve anything. Open your address, sign in with Google as an allowed account (the first becomes the owner), choose a model under Settings, and pull in recent mail to teach it with. Nothing in Gmail changes until you turn Sift on, under Settings.

Mail is checked each minute. Logs are the project's function logs.

## Previews

A preview deployment builds and migrates with whatever `DATABASE_URL` it is given, and production refuses a database a newer Sift migrated. Give previews a database of their own (Neon's integration can make a branch per preview), or no Preview variables at all, so they build without one and touch nothing. Crons run only in production.

With Deployment Protection on, a preview reaches its own `api/work` only with Vercel's Protection Bypass for Automation (`VERCEL_AUTOMATION_BYPASS_SECRET`), which Sift sends when it is set.

## Upgrading

Push to the production branch. The build migrates first; there is no way back down, so back the database up with Neon's tools before an upgrade you may want to undo.
