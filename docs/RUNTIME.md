# Runtime

One core that runs as `sift run` on a machine and as two functions on Vercel. Decided 2026-11-16.

## The rule

Every request and every tick starts with nothing in memory and keeps nothing after it returns.

| Kind | Where | Lost when |
| --- | --- | --- |
| The record: mail, decisions, actions, rules, credentials, preferences, test runs | Postgres | Never, short of retention |
| Brief: locks, sign-ins in progress, quota, pass status, older mail asked for | `Ephemeral`, every key with a TTL | Expiry or restart; nothing breaks but a retry |

Postgres holds nothing brief; `Ephemeral` holds nothing that cannot be lost. There is no queue: what is due is found in those two places.

## The core

| Entry point | Called by | Does |
| --- | --- | --- |
| `handle(Request): Response` | each HTTP request | Dashboard, API, sign-ins. Static files are the host's. |
| `tick(until, people?)` | every minute; or at once, for what a person just started | Finds what is due and does it, four at a time, starting nothing after `until` |

What is due, each tick:

| Work | Found from | Held by |
| --- | --- | --- |
| A pass per mailbox | every mailbox | `lock:pass:<mailbox>` |
| Upkeep per person | `upkeep:<person>:<day>`, claimed by the first tick of a day | the claim |
| Older mail | `backfill:<mailbox>`, set when asked for, taken when all is in | `lock:backfill:<mailbox>` |
| A test run's next slice | runs marked running | `lock:eval:<person>:<run>` |

Work a tick leaves unfinished is due again at the next. Ticks may overlap; a lock held means another tick has it. A ChatGPT device code is asked about when the page reloads while the person enters it, at most once per OpenAI's interval.

## Hosts

Each host builds a `Host` and calls `createSift`, which returns `respond(Request)` and `tick()`.

| | `sift run` (`src/cli/`) | Vercel (`src/vercel/`, `api/`, `vercel.json`) |
| --- | --- | --- |
| Requests | `node:http` turned into a `Request`; a forwarded scheme believed only from this machine | `api/site.ts`, for `/api/*` and `/auth/*` |
| The page | served by sift (`site`, `src/host/site.ts`) | Vercel's CDN, with the same headers (`vercel.json`, held equal by `tests/vercel.test.ts`) |
| Ticks | every minute, each with a 5-minute limit, not waiting for the last | `api/cron.ts`, Vercel Cron each minute, with the function's limit less a minute |
| Started by a person | runs on in this process | runs on under `waitUntil` |
| `Ephemeral` | memory, or Redis when `REDIS_URL` is set | Redis |
| Database | PGlite, or Postgres; migrated when opened | Postgres (Neon); migrated by the deploy's build |
| Settings, keys | `sift.toml` and the home directory | the environment |

Memory is right for one `sift run` process only. Two processes, or any host with instances, need Redis.

### On Vercel

What the project needs: the Pro plan (Hobby crons run once a day), Neon and Redis from the marketplace, and in the environment:

| Variable | |
| --- | --- |
| `DATABASE_URL` | Neon's pooled address. `DATABASE_MIGRATION_URL`: the owner's unpooled one, so sift runs as a role that owns nothing. |
| `REDIS_URL` | |
| `SIFT_KEY` | Encrypts the credentials in the database ([SECRETS.md](SECRETS.md)). |
| `SIFT_SESSION_SECRET` | Signs sessions. Changing it signs everyone out. |
| `CRON_SECRET` | Vercel sends it with each cron call; nothing else may start a tick. |
| `SIFT_GOOGLE_CLIENT_ID`, `SIFT_GOOGLE_CLIENT_SECRET` | A Web application client listing `https://<domain>/auth/callback`. |
| `SIFT_DASHBOARD_HOST` | The project's own domain, when it has one besides `*.vercel.app`. |

A preview deployment must have a database of its own: its build migrates whatever `DATABASE_URL` it is given, and production refuses a database a newer sift migrated.

Not yet tried on Vercel itself: that its builder takes imports that name `.ts` files, that a rewrite keeps the address the browser asked for in `request.url`, and `waitUntil` running a tick past the reply.

## Many mailboxes on Vercel

A tick never runs into the function's time limit: it starts nothing after `until`, a pass checks it between messages, and a model call gives up after 60 seconds, so `until` is the limit less a minute. What it does not finish is due at the next tick, which starts a minute later whether or not the last has ended; locks keep two off the same work. So more mailboxes cost latency, never a timeout.

How much a minute holds: a quiet pass is a history read and a few dozen queries, a second or two, so four at a time get through roughly a hundred quiet mailboxes a minute. Mail that needs the model costs a few seconds a message, and older mail being pulled in waits on Gmail's quota (about 240 messages a minute per mailbox). Overlapping ticks add to the four. If a minute stops being enough, raise `AT_ONCE` (the work is mostly waiting on the network), and past that have the cron route send each mailbox its own request, so each gets a function and a time limit of its own. Neither is needed for dozens.

## Code

- `src/host/`: what every host shares. `createSift(host)` (`sift.ts`), the controls the dashboard is given, the sign-ins, and serving the page (`site.ts`).
- `src/cli/`: the commands and the Node host (`serve.ts`: `nodeHost`, the listener).
- `src/vercel/host.ts`, `api/`, `vercel.json`: the Vercel host. `src/vercel/migrate.ts` runs in its build.
- `tests/runtime.test.ts`: no module state outside `src/cli/`, and flows whose steps reach different instances.
