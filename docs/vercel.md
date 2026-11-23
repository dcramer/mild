# Vercel

Mild on Vercel instead of a machine of your own. How it runs there is [runtime.md](runtime.md); this is how to set it up. It runs in production there; the Deploy Button is untried ([TODO.md](../TODO.md)).

What it needs: the **Pro** plan (Hobby runs crons once a day; Mild ticks each minute), a Postgres database (Neon) and a Redis database, both from the Vercel Marketplace, and a Google OAuth client of your own.

## One click

[![Deploy with Vercel](https://vercel.com/button)][deploy]

It copies this repository to your GitHub account, adds Neon and Upstash for Redis to the project, asks for the Google client's id and secret and three secrets (`MILD_KEY`, `MILD_SESSION_SECRET`, `CRON_SECRET`), and lets Neon and Upstash set the database and Redis addresses, so the first deploy migrates the database and comes up whole. Make the Google client (step 2) first: its id and secret are asked for, and its redirect URI can wait until Vercel has given the project its address. Then add that URI, and open the address.

Upstash is expected to set `REDIS_URL`; if the site says it is missing, copy the store's `redis://`/`rediss://` address into it and deploy again.

[deploy]: https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdcramer%2Fsift&project-name=mild&repository-name=mild&env=MILD_GOOGLE_CLIENT_ID%2CMILD_GOOGLE_CLIENT_SECRET%2CMILD_KEY%2CMILD_SESSION_SECRET%2CCRON_SECRET&envDescription=Your%20Google%20OAuth%20client%20and%20three%20secrets.&envLink=https%3A%2F%2Fgithub.com%2Fdcramer%2Fsift%2Fblob%2Fmain%2Fdocs%2Fvercel.md%23one-click&products=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22neon%22%2C%22integrationSlug%22%3A%22neon%22%7D%2C%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22upstash-kv%22%2C%22integrationSlug%22%3A%22upstash%22%7D%5D

## 1. The project

Import this repository as a Vercel project and deploy it as it is: Vercel adds databases only to a project that exists. Root Directory: `./`, the repository root. `vercel.json` sets the Framework Preset (Next.js), the build (`next build`, then the migration) and the minute's cron, and Node comes from `package.json` (26.x).

This first deploy builds without a database. Until steps 2 and 3 are done, the site lists the variables it still needs.

In Settings, Environment Variables, keep **Enable access to System Environment Variables** checked. Workflow knows it is on Vercel only by `VERCEL_DEPLOYMENT_ID`; without it every run fails, and every piece of work with it. Mild knows it by `VERCEL` (`src/sift/instance.ts`); without it, it would open a home directory and PGlite as `mild run` does.

In Settings, Advanced, turn on **Skew Protection**. An installed app stays open for days: with it, a page from an older deploy still gets that deploy's files until it moves to another screen or is put away or left alone, when it loads whole from the new one (`web/src/lib/build.ts`). Without it, a screen the old page has not fetched yet fails, and offers Reload.

Then, from the project's Storage tab, add Neon and a Redis database. Each sets variables of its own; Mild reads the ones in step 3.

## 2. The Google client

The project's production domain is your Mild's address: `https://<project>.vercel.app`, or your own domain once added. In Google Cloud:

1. [Create a project](https://console.cloud.google.com/projectcreate) and select it.
2. [Enable the Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
3. [Set up the consent screen](https://console.cloud.google.com/auth/overview): app name `Mild`, audience External, your own address for support and contact.
4. [Create a client](https://console.cloud.google.com/auth/clients): type Web application, authorised redirect URI `https://<your domain>/auth/callback`. Keep its id and secret.
5. [Data Access](https://console.cloud.google.com/auth/scopes): add `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/gmail.settings.basic` and `https://www.googleapis.com/auth/gmail.send`, which is asked for only when someone lets Mild send from a mailbox.
6. [Audience](https://console.cloud.google.com/auth/audience): add each Gmail address Mild will read as a test user. They are the only accounts that can sign in to your Mild. While the app is in Testing, Google ends each sign-in 7 days after it was given and you sign in again; publishing it ends that, and may need Google's verification ([the modes](gmail.md#signing-in)).

## 3. The environment

In the project's Environment Variables, for Production. A variable still named `SIFT_…` from before the rename is read while its `MILD_…` name is unset:

| Variable | |
| --- | --- |
| `DATABASE_URL` | Neon's pooled address. |
| `DATABASE_MIGRATION_URL` | Optional, and better: Neon's unpooled address for the owner role, with `DATABASE_URL` then a role that owns nothing (`CREATE ROLE sift LOGIN PASSWORD '…'`), so row-level security holds Mild itself. |
| `REDIS_URL` | The Redis database's `redis://` or `rediss://` address. |
| `MILD_GOOGLE_CLIENT_ID`, `MILD_GOOGLE_CLIENT_SECRET` | From step 2. |
| `MILD_KEY` | Encrypts the credentials and mail Mild stores ([secrets.md](secrets.md)). `openssl rand -base64 32` |
| `MILD_SESSION_SECRET` | Signs sessions; changing it signs everyone out. `openssl rand -base64 32` |
| `CRON_SECRET` | Vercel sends it with each cron call; nothing without it can start a tick. `openssl rand -hex 32` |
| `MILD_URL` | Only when the dashboard is opened somewhere other than the project's production domain: that address, `https://sift.example.com`. Digests link to it. |
| `MILD_CHATGPT_SIGN_IN` | Only to change how people sign in to ChatGPT ([cli.md](cli.md#models)). |
| `MILD_CLOUD` | `true` only when this Mild is a service for other people. It gives the site its terms, privacy policy and security page; Google asks for the first two before it publishes the app. They speak for you, so read them first (`web/src/views/legal.tsx`). |
| `SENTRY_DSN` | Optional: a Sentry project's DSN, to send errors and traces there ([architecture.md](architecture.md#errors-and-traces)). Each deployment is tagged with its `VERCEL_ENV`. |

Until every required one is set, the site lists those still missing; `CRON_SECRET` is among them, since without it nothing runs.

## 4. Deploy again

Redeploy production, so the build sees the variables: it migrates the database before the new functions serve anything. Open your address and sign in with Google (the first account becomes the owner); the page walks through connecting a model, saying what you want, choosing your labels and having Mild go through recent mail to teach it with. Until you turn Mild on, under Settings, Gmail changes only for mail you answer in the dashboard.

Each minute Mild reads its record for work to do; Gmail is read only once a mailbox's gap has passed, a minute while mail keeps coming and up to 10 when it is quiet. Logs are the project's function logs.

## Previews

A preview deployment builds and migrates with whatever `DATABASE_URL` it is given, and production refuses a database a newer Mild migrated. Give previews a database of their own (Neon's integration can make a branch per preview), or no Preview variables at all, so they build without one and touch nothing. Crons run only in production.

## Upgrading

Push to the production branch. The build migrates first; there is no way back down, so back the database up with Neon's tools before an upgrade you may want to undo.
