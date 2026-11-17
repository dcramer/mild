# Runtime

One core that runs as `sift run` on a machine and as functions on Vercel. Decided 2026-11-16.

## The rule

Every request and every piece of work starts with nothing in memory and keeps nothing after it returns.

| Kind | Where | Lost when |
| --- | --- | --- |
| The record: mail, decisions, actions, rules, credentials, preferences, test runs | Postgres | Never, short of retention |
| Brief: locks, sign-ins in progress, quota, pass status | `Ephemeral`, every key with a TTL | Expiry or restart; nothing breaks but a retry |

Postgres holds nothing brief; `Ephemeral` holds nothing that cannot be lost. There is no queue: what is due is found in those two places.

## The core

`createSift(host)` (`src/app/sift.ts`) returns:

| | Does |
| --- | --- |
| `respond(Request)` | The API and sign-ins; the page is Next.js's (`app/`) |
| `due(people?)` | What is due, as pieces of ids only |
| `work(piece)` | One piece, opening everything it touches from its ids, starting nothing after the host's limit |
| `tick(people?)` | `due`, then `work` on each here, four at a time |

What is due:

| Work | Found from | Held by |
| --- | --- | --- |
| A pass per mailbox | every mailbox with a label of its own | `lock:pass:<mailbox>` |
| Upkeep per person | `upkeep:<person>:<day>`, claimed when it starts and let go if it fails | the claim |
| Going through an inbox, or applying a rule to it, its next slice | `inbox_runs` not finished | `lock:inbox:<run>` |
| A test run's next slice | runs marked running | `lock:eval:<person>:<run>` |

Work left unfinished is due again at the next tick. Ticks may overlap; a lock held means something else has that piece. A lock lasts the piece's limit and a minute more, so one left by a call the host cut off runs out about when the next tick wants it. A ChatGPT device code is asked about when the page reloads while the person enters it, at most once per OpenAI's interval.

## Hosts

Each host builds a `Host` and calls `createSift`. What differs is who calls `respond`, and where each piece of `due` work runs. Both serve the page with Next.js, from the same `app/` and the same policy (`proxy.ts`).

| | `sift run` (`src/cli/`) | Vercel (`src/vercel/`, `app/`, `vercel.json`) |
| --- | --- | --- |
| Requests | `node:http`, one listener per address; `/api/` and `/auth/` turned into a `Request` for `respond`, a forwarded scheme believed only from this machine | route handlers for `/api/*` and `/auth/*` (`app/api/`, `app/auth/`) call `respond` |
| The page | Next.js in this process: the build, made first when the page's sources are newer than it (`ensurePageBuilt`, `src/cli/page-build.ts`), or under `sift dev` the development server | Next.js, built by the deploy |
| Each minute | `tick()` in this process, not waiting for the last | `/api/cron` (Vercel Cron) posts each piece of `due()` to `/api/work` |
| A piece of work | in this process, 5-minute limit | a call of its own: replies at once and works under `waitUntil`, with the function's limit less a minute |
| Started by a person | `tick(person)` in this process | the same fan-out, for that person |
| `Ephemeral` | memory, or Redis when `REDIS_URL` is set | Redis |
| Database | PGlite, or Postgres; migrated when opened | Postgres (Neon); migrated by the deploy's build, and checked again when opened |
| Settings, keys | the environment, the home's `.env` and files, and `.env` in the directory Sift started from (where `init` puts `SIFT_KEY`) | the environment |

Memory is right for one `sift run` process only. Two processes, or any host with instances, need Redis.

### On Vercel

Setting it up, and every variable it needs: [vercel.md](vercel.md). Next.js bundles the route handlers, except the packages in `serverExternalPackages` (`next.config.js`), loaded from `node_modules` as they are because some read files beside their own modules. It copies `src/store/migrations` into the functions (`outputFileTracingIncludes`), and `src/store/db.ts` finds it from its own path, not with `new URL('./migrations/', import.meta.url)`, which the bundler would take for one file to bundle. Each route handler sets `maxDuration` to the limit the code assumes (`MAX_DURATION_S`, held by `tests/vercel.test.ts`).

A piece handed to `/api/work` names a person and their mailbox by id; Sift opens that person's database and finds the mailbox among their own, so even a forged piece cannot reach across people. Every other `/api/` path, and `/auth/`, goes to `respond`, which keeps the dashboard's own checks: a session for every `/api/` route, the Host one of the deployment's names, writes only from the page.

Sift runs in production on Vercel. Not yet seen there: `waitUntil` keeping a long piece going past the reply for the whole of its limit.

## Many mailboxes on Vercel

Each piece of work is a call of its own, so mailboxes do not wait on each other and none shares a function's memory or time with another. Each call starts nothing after its limit less a minute (a model call gives up after 60 seconds), so it never runs into the limit; what it leaves is due at the next tick. More mailboxes cost more calls, about one per mailbox a minute (some 2 million a month for 50), and no latency.

## What it costs

The rule is in [AGENTS.md](../AGENTS.md#cheap-to-run): cost follows mail, not time. Figures are for one mailbox getting a few hundred messages a day, on Vercel Pro, whose $20 monthly credit covers all of a project's usage before anything is billed.

| | Each month | Follows |
| --- | --- | --- |
| The minute tick (`api/cron`) | 43,200 calls | time |
| A pass per mailbox (`api/work`), run whether or not mail came | 43,200 calls, each syncing and opening the model sign-in | time |
| Model calls | one per message no rule or sender answers, with the cost recorded in `model_runs` | mail |
| Workflow events, if every pass were a run of about four steps | some 650,000 (about $13 at $0.02 per 1,000) | time |

The two rows that follow time are what to remove: the tick should start a pass only for a mailbox with new mail or a change still to make, so an idle mailbox costs one cheap check a minute.

## Code

- `src/app/`: what every host shares. `createSift(host)` (`sift.ts`), the controls the dashboard is given, the sign-ins.
- `app/`, `proxy.ts`, `next.config.js`: the page, its policy, and how Next.js builds both for each host.
- `src/cli/`: the commands and the Node host (`host.ts`: `nodeHost`, the listener, Next.js in the same process; `page-build.ts`).
- `src/vercel/host.ts`, the route handlers under `app/api/` and `app/auth/`, `vercel.json`: the Vercel host. `src/vercel/migrate.ts` runs in its build, after `next build`.
- `tests/runtime.test.ts`: no module state outside the hosts, and flows whose steps reach different instances. `tests/vercel.test.ts`: `vercel.json` and the route handlers against the code, and who may call `/api/cron` and `/api/work`.
