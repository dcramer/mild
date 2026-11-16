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

## Many mailboxes on Vercel

A tick never runs into the function's time limit: it starts nothing after `until`, a pass checks it between messages, and a model call gives up after 60 seconds, so `until` is the limit less a minute. What it does not finish is due at the next tick, which starts a minute later whether or not the last has ended; locks keep two off the same work. So more mailboxes cost latency, never a timeout.

How much a minute holds: a quiet pass is a history read and a few dozen queries, a second or two, so four at a time get through roughly a hundred quiet mailboxes a minute. Mail that needs the model costs a few seconds a message, and older mail being pulled in waits on Gmail's quota (about 240 messages a minute per mailbox). Overlapping ticks add to the four. If a minute stops being enough, raise `AT_ONCE` (the work is mostly waiting on the network), and past that have the cron route send each mailbox its own request, so each gets a function and a time limit of its own. Neither is needed for dozens.

## Code

- `src/host/sift.ts`: `createSift(host)`, used by `sift run`, `sift dashboard` and, to come, a Vercel entry. `src/host/` holds the wiring every host shares; `src/cli/` is the commands and the Node listener (`src/cli/serve.ts`).
- `tests/runtime.test.ts`: no module state outside `src/cli/`, and flows whose steps reach different instances.
- What is left for Vercel itself (the Neon driver, the two routes, the session secret and Google client from the environment) is in TODO.md.
