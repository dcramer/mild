# Runtime

One core that runs as `sift run` on a machine and as two functions on Vercel. Decided 2026-11-16; the table at the end says what is left.

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

| | `sift run` | Vercel |
| --- | --- | --- |
| Requests | `node:http` turned into `Request` | a catch-all function |
| Ticks | a timer, each with a 5-minute limit | Vercel Cron each minute (Pro; Hobby crons run daily), limited by the function's time |
| Started by a person | a tick for them, at once | the same, kept running past the reply with `waitUntil` |
| `Ephemeral` | memory, or Redis when `REDIS_URL` is set | Redis |
| Database | PGlite, or Postgres | Neon |
| Static files | from `web/dist` | built at deploy |
| Settings, keys | `sift.toml` and the home directory | environment |

Memory is right for one `sift run` process only. Two processes, or any host with instances, need Redis.

## Left to do

| Today | Becomes |
| --- | --- |
| Google sign-in's `pending` map (`src/dashboard/server.ts`) | `signin:google:<state>`, taken once |
| `device-id`, `dashboard-key` files | settings in the environment; files only for `sift run` |
| `src/cli/` wiring `Controls` and the loop | `createSift(host)` returning `handle` and `tick`; `src/cli/` and a Vercel entry are the hosts |
| No test that a flow survives a new instance per step | each multi-step flow run with a new core per step, sharing only Postgres and `Ephemeral` |
