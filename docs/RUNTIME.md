# Runtime

Decided 2026-11-16, being built: the table at the end says what has changed so far. sift as stateless functions, so one core runs as `sift run` on a machine and as functions on Vercel (Cloudflare later) and behaves the same.

## The rule

Every entry point starts with nothing in memory and keeps nothing after it returns. Whatever must outlive a call is in one of three places:

| Kind | Where | Lost when |
| --- | --- | --- |
| The record: mail, decisions, actions, rules, credentials, preferences | Postgres (`Store`) | Never, short of retention |
| Ephemeral: locks, sign-in handshakes, quota, pass status | `Ephemeral` (Redis, or memory in one process), every key with a TTL | Expiry or restart; nothing breaks but a retry |
| Work longer than a request | `Jobs` (a queue) | Done, or given up after retries |

Postgres holds nothing ephemeral. Ephemeral holds nothing that cannot be lost.

## The core

`createSift(host)` returns three entry points:

| Entry point | Called by | Does |
| --- | --- | --- |
| `handle(Request): Response` | each HTTP request | Dashboard API, Google sign-in, model sign-in. Not static files: the adapter serves those. |
| `runJob(job, until)` | each queued job | One job, stopping by `until` and sending a follow-up if work is left |
| `tick()` | every minute | Sends a pass for each mailbox, and upkeep once a day |

`host` is what the adapter provides: `store`, `ephemeral`, `jobs`, `settings` (environment, plus `sift.toml` locally), `now`.

## Jobs

Ids only, never mail. A queue may deliver one twice or out of order, so each is safe to repeat.

| Job | Replaces | Repeat-safe because |
| --- | --- | --- |
| `pass {person, mailbox}` | the pass loop | Claims `lock:pass:<mailbox>` first; work comes from database queues |
| `upkeep {person}` | daily pruning | Deleting what is old twice deletes nothing more |
| `backfill {person, mailbox, days, page?}` | `Controls.backfill` inside a request | One page per job, then sends the next; insert ignores known mail |
| `eval {person, run, from}` | `startEval`'s background promise | A slice of examples per job; results keyed by example |
| `chatgpt-sign-in {person}` | pi-ai's login loop held in memory | Asks OpenAI once, sends itself again after the interval until done or expired |

## Ephemeral keys

| Key | Holds | TTL |
| --- | --- | --- |
| `lock:pass:<mailbox>` | token of the pass that holds it | 15 min |
| `signin:google:<state>` | PKCE verifier, redirect, mailbox being added; taken once | 10 min |
| `signin:chatgpt:<person>` | code, link, expiry or error shown on the page | 15 min |
| `signin:chatgpt-redirect:<person>` | verifier for Sign in with ChatGPT | 10 min |
| `quota:<mailbox>` | Gmail units spent this window | 1 min |
| `status:<mailbox>` | last pass at, its error, sign-in expired | 7 days |
| `upkeep:<person>:<day>` | that upkeep was sent | 2 days |

`Ephemeral` is a few operations, each one call in Redis: `get`, `set` with TTL, `take` (get and delete), `claim`/`release` (set-if-absent with a token), `spend` (add within a window, refused past a limit).

## Adapters

| | `sift run` | Vercel | Cloudflare (later) |
| --- | --- | --- | --- |
| Requests | `node:http` turned into `Request` | catch-all function | Worker `fetch` |
| Static files | from `web/dist` | built at deploy, served by Vercel | Workers assets |
| Jobs | in-process, four at a time | Vercel Queues (`until` from the function's time limit) | Cloudflare Queues |
| Tick | a timer | Vercel Cron | Cron Trigger |
| Ephemeral | memory, or Redis when `SIFT_REDIS_URL` is set | Redis (marketplace) | Upstash over HTTP |
| Database | PGlite, or Postgres | Neon | Neon via Hyperdrive |
| Settings, keys | `sift.toml` and files in the home | environment | environment |

Memory is correct for `sift run` only because it is one process. Two processes need Redis.

## Running the Vercel shape locally

The enforcement is tests, since `vercel dev` runs neither cron nor queues:

- Every multi-step flow (Google sign-in, adding a mailbox, ChatGPT sign-in both ways, a test run, pulling in older mail, a pass that stops at `until`) runs each step on a new core, sharing only the store, ephemeral and jobs.
- No module-level mutable state outside the adapters and declared caches; a test reads `src/` for it.
- The Redis adapter runs the same tests against a real Redis when `SIFT_REDIS_URL` is set (CI).

## What changes from today

| Today | Becomes |
| --- | --- |
| `mailboxes.pass_until` | `lock:pass:<mailbox>`; the column is dropped |
| Gmail quota buckets in memory (`src/gmail/quota.ts`) | `spend` on `quota:<mailbox>` |
| Google sign-in `pending` map (`src/dashboard/server.ts`) | `signin:google:<state>` |
| ChatGPT `pending`/`redirects` maps, and the device-code login loop (`src/cli/controls.ts`, `src/model/models.ts`) | ephemeral keys, and sift's own device-code flow, one poll per job, storing the credential in pi-ai's shape as the redirect sign-in already does |
| `Activity` in memory | `status:<mailbox>` |
| `Wake` / `checkNow` | sends the person's pass jobs |
| `startEval` in the background, `interruptEvals` at start | `eval` jobs |
| `Controls.backfill` in the request | `backfill` jobs |
| `device-id`, `dashboard-key` files | settings (`SIFT_DEVICE_ID`, `SIFT_SESSION_KEY`), files only locally |
| `node:http` handler | `handle(Request)` behind the adapter |
| `src/cli/` wiring `Controls` and the loop | `createSift(host)`; `src/cli/` is the `sift run` adapter |

## Open

- Redis client: `redis` (TCP) for local and Vercel; Upstash's HTTP client only when Cloudflare comes.
- How a pass's `until` is chosen on Vercel: the function's `maxDuration` less a margin for the last model call (60 s).
- Whether a person's "check now" should skip the queue and run their passes inside the request when they are quick.
