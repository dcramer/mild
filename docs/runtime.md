# Runtime

One core that runs as `sift run` on a machine and as functions on Vercel. Decided 2026-11-16.

## The rule

Every request and every piece of work starts with nothing in memory and keeps nothing after it returns.

| Kind | Where | Lost when |
| --- | --- | --- |
| The record: mail, decisions, actions, rules, credentials, preferences, test runs | Postgres | Never, short of retention |
| Brief: locks, sign-ins in progress, quota, pass status, older mail asked for | `Ephemeral`, every key with a TTL | Expiry or restart; nothing breaks but a retry |

Postgres holds nothing brief; `Ephemeral` holds nothing that cannot be lost. There is no queue: what is due is found in those two places.

## The core

`createSift(host)` (`src/app/sift.ts`) returns:

| | Does |
| --- | --- |
| `respond(Request)` | The page (where Sift serves it), the API, sign-ins |
| `due(people?)` | What is due, as pieces of ids only |
| `work(piece)` | One piece, opening everything it touches from its ids, starting nothing after the host's limit |
| `tick(people?)` | `due`, then `work` on each here, four at a time |

What is due:

| Work | Found from | Held by |
| --- | --- | --- |
| A pass per mailbox | every mailbox with a label of its own | `lock:pass:<mailbox>` |
| Upkeep per person | `upkeep:<person>:<day>`, claimed when it starts and let go if it fails | the claim |
| Older mail | `backfill:<mailbox>`, set when asked for, taken when all is in | `lock:backfill:<mailbox>` |
| A test run's next slice | runs marked running | `lock:eval:<person>:<run>` |

Work left unfinished is due again at the next tick. Ticks may overlap; a lock held means something else has that piece. A lock lasts the piece's limit and a minute more, so one left by a call the host cut off runs out about when the next tick wants it. A ChatGPT device code is asked about when the page reloads while the person enters it, at most once per OpenAI's interval.

## Hosts

Each host builds a `Host` and calls `createSift`. What differs is who calls `respond`, and where each piece of `due` work runs.

| | `sift run` (`src/cli/`) | Vercel (`src/vercel/`, `api/`, `vercel.json`) |
| --- | --- | --- |
| Requests | `node:http` turned into a `Request`; a forwarded scheme believed only from this machine | `api/site.ts`, for `/api/*` and `/auth/*` |
| The page | served by Sift (`site`, `src/app/site.ts`) | Vercel's CDN, with the same headers (`vercel.json`, held equal by `tests/vercel.test.ts`) |
| Each minute | `tick()` in this process, not waiting for the last | `api/cron.ts` (Vercel Cron) posts each piece of `due()` to `api/work.ts` |
| A piece of work | in this process, 5-minute limit | a call of its own: replies at once and works under `waitUntil`, with the function's limit less a minute |
| Started by a person | `tick(person)` in this process | the same fan-out, for that person |
| `Ephemeral` | memory, or Redis when `REDIS_URL` is set | Redis |
| Database | PGlite, or Postgres; migrated when opened | Postgres (Neon); migrated by the deploy's build, and checked again when opened |
| Settings, keys | the environment, the home's `.env` and files, and `.env` in the directory Sift started from (where `init` puts `SIFT_KEY`) | the environment |

Memory is right for one `sift run` process only. Two processes, or any host with instances, need Redis.

### On Vercel

Setting it up, and every variable it needs: [vercel.md](vercel.md). Vercel compiles `api/*.ts` with the project's own TypeScript, extending `tsconfig.json` and rewriting the `.ts` in imports (`@vercel/node` 31), and keeps each file's place, so `src/store/migrations` (in `includeFiles`) is where `src/store/db.ts` looks.

A piece handed to `api/work` names a person and their mailbox by id; Sift opens that person's database and finds the mailbox among their own, so even a forged piece cannot reach across people. `api/site` keeps the dashboard's own checks: a session for every `/api/` route, the Host one of the deployment's names, writes only from the page.

Sift runs in production on Vercel. Not yet seen there: `waitUntil` keeping a long piece going past the reply for the whole of its limit.

## Many mailboxes on Vercel

Each piece of work is a call of its own, so mailboxes do not wait on each other and none shares a function's memory or time with another. Each call starts nothing after its limit less a minute (a model call gives up after 60 seconds), so it never runs into the limit; what it leaves is due at the next tick. More mailboxes cost more calls, about one per mailbox a minute (some 2 million a month for 50), and no latency.

## Code

- `src/app/`: what every host shares. `createSift(host)` (`sift.ts`), the controls the dashboard is given, the sign-ins, and serving the page (`site.ts`).
- `src/cli/`: the commands and the Node host (`host.ts`: `nodeHost`, the listener).
- `src/vercel/host.ts`, `api/` (`site`, `cron`, `work`), `vercel.json`: the Vercel host. `src/vercel/migrate.ts` runs in its build.
- `tests/runtime.test.ts`: no module state outside the hosts, and flows whose steps reach different instances. `tests/vercel.test.ts`: `vercel.json` against the code, and who may call `api/cron` and `api/work`.
