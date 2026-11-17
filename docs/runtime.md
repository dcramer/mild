# Runtime

One core that runs as `sift run` on a machine and as functions on Vercel. Decided 2026-11-16.

## The rule

Every request and every piece of work starts with nothing in memory and keeps nothing after it returns.

| Kind | Where | Lost when |
| --- | --- | --- |
| The record: mail, decisions, actions, rules, credentials, preferences, test runs | Postgres | Never, short of retention |
| Brief: locks, sign-ins in progress, quota, pass status | `Ephemeral`, every key with a TTL | Expiry or restart; nothing breaks but a retry |

Postgres holds nothing brief; `Ephemeral` holds nothing that cannot be lost. Nothing is queued but Workflow runs: what is due is found in those two places, and each tick begins a run for each piece of it.

## The core

`createSift(host)` (`src/app/sift.ts`) returns:

| | Does |
| --- | --- |
| `respond(Request)` | The API and sign-ins; the page is Next.js's (`app/`) |
| `work(piece)` | One piece, opening everything it touches from its ids, starting nothing after the host's limit. A run's step calls it |
| `tick(people?)` | What is due (`dueWork`, `src/work/run.ts`), as pieces of ids only, then a Workflow run begun for each (`begin`, `src/app/flow.ts`) |

What is due:

| Work | Found from | Its run's key |
| --- | --- | --- |
| A pass per mailbox | every mailbox with a label of its own: at the timed tick only when a look finds something for it (`passWanted`, `src/work/run.ts`), and whenever its person asks | `pass:<mailbox's keyed hash>` |
| Upkeep per person | `upkeep:<person>:<day>` in `Ephemeral`, claimed when it starts and let go if it fails | `upkeep:<person>` |
| Going through an inbox, or applying a rule to it, its next slice | `inbox_runs` not finished | `inbox:<mailbox's keyed hash>:<run>` |
| A test run's next slice | runs marked running | `eval:<person>:<run>` |

The look reads the record first: a change to confirm, a decision to carry out, text of waiting mail to keep or let go, an example to store, a Gmail filter check due, mail waiting while there is a model to decide it, the day's first sync, and a last pass that failed, ran out of time or is not in `Ephemeral`. Only if none, it asks Gmail for the mailbox's history id (`getProfile`, 1 quota unit) and compares it with the cursor sync keeps; any change to the mailbox moves it, Sift's own included. A look that cannot tell begins the pass, except when Google says the sign-in has expired: that fails every pass alike, so the look records it for the dashboard's notice and begins nothing until Gmail answers again. One that finds nothing records the mailbox's status as a pass that found nothing would, so "Last checked" stays true. A person's press (Check now, an answer, applying a rule, a model saved, going through the inbox) begins their passes without looking. With no model, a rule added since decides waiting mail only at the next pass begun for something else.

Work left unfinished is due again at the next tick. Ticks may overlap: a run holds its key from when it is begun until it ends (Workflow's `experimental_hook`), and beginning the piece again meanwhile is refused and skipped, on every host and instance alike. Workflow keeps keys unencrypted, so a mailbox is named in one by an HMAC of its address under the session secret (`runKey`, `src/app/sift.ts`). A run whose step fails is retried by Workflow; one that never finishes holds its key, so its piece waits for it. A ChatGPT device code is asked about when the page reloads while the person enters it, at most once per OpenAI's interval.

## Hosts

Each host builds a `Host` and calls `createSift`. What differs is who calls `respond`, and which Workflow world keeps the runs. Both serve the page with Next.js, from the same `app/` and the same policy (`proxy.ts`), and Workflow's flow route with it (`withWorkflow`, `next.config.js`).

| | `sift run` (`src/cli/`) | Vercel (`src/vercel/`, `app/`, `vercel.json`) |
| --- | --- | --- |
| Requests | `node:http`, one listener per address; `/api/` and `/auth/` turned into a `Request` for `respond`, a forwarded scheme believed only from this machine | route handlers for `/api/*` and `/auth/*` (`app/api/`, `app/auth/`) call `respond` |
| The page | Next.js in this process: the build, made first when the page's sources are newer than it (`ensurePageBuilt`, `src/cli/page-build.ts`), or under `sift dev` the development server | Next.js, built by the deploy |
| Each minute | `tick()` in this process, not waiting for the last | `tick()` from `/api/cron` (Vercel Cron) |
| A piece of work | a run in Workflow's Local World, kept in the home (`workflow/`) and delivered over the dashboard's listener to Next.js in this process; 5-minute limit | a run in Workflow's Vercel World, its step a call of Workflow's flow route; 300 seconds less a minute |
| Started by a person | `tick([person])`, in the request | the same |
| `Ephemeral` | memory, or Redis when `REDIS_URL` is set | Redis |
| Database | PGlite, or Postgres; migrated when opened | Postgres (Neon); migrated by the deploy's build, and checked again when opened |
| Settings, keys | the environment, the home's `.env` and files, and `.env` in the directory Sift started from (where `init` puts `SIFT_KEY`) | the environment |

Memory is right for one `sift run` process only. Two processes, or any host with instances, need Redis.

`sift run` holds two copies of `src/`: its own, imported as it is, and the one Next.js bundled with Workflow's transform, the only one that can begin a run or run a step. They meet on `globalThis` (`src/app/process.ts`): the host offers its Sift before Next.js starts, for steps to call `work` on, and `instrumentation.ts` offers Workflow's `begin` as Next.js starts. On Vercel there is one copy, and `instrumentation.ts` offers each instance's own Sift (`forSteps`, `src/vercel/host.ts`). Without a dashboard listener nothing is delivered, so `sift run` always serves the dashboard. Stopping closes the listener, Next.js and the Local World, then waits for the pieces under way; a run cut off there is taken up again when Sift next starts.

### On Vercel

Setting it up, and every variable it needs: [vercel.md](vercel.md). Next.js bundles the route handlers, except the packages in `serverExternalPackages` (`next.config.js`), loaded from `node_modules` as they are because some read files beside their own modules. It copies `src/store/migrations` into the functions (`outputFileTracingIncludes`), and `src/store/db.ts` finds it from its own path, not with `new URL('./migrations/', import.meta.url)`, which the bundler would take for one file to bundle. Each route handler of Sift's own sets `maxDuration` to the limit the code assumes (`MAX_DURATION_S`, held by `tests/vercel.test.ts`). Workflow writes its routes into `app/.well-known/workflow/` at build, with a flow route that Vercel's queue calls and whose limit is the plan's longest; a piece still starts nothing after 300 seconds less a minute, the shortest of those limits (Hobby's).

A run's piece names a person and their mailbox by id; Sift opens that person's database and finds the mailbox among their own. `/api/cron` takes only Vercel Cron's call, with `CRON_SECRET`. Every other `/api/` path, and `/auth/`, goes to `respond`, which keeps the dashboard's own checks: a session for every `/api/` route, the Host one of the deployment's names, writes only from the page.

Sift runs in production on Vercel. Not yet seen there: a Workflow run.

## Many mailboxes on Vercel

Each piece of work is a run of its own, its step a call of its own, so mailboxes do not wait on each other and none shares a function's memory or time with another. Each step starts nothing after its limit less a minute (a model call gives up after 60 seconds), so it never runs into the limit; what it leaves is due at the next tick. More mailboxes cost more runs, about one or two per message they get, and no latency.

## What it costs

The rule is in [AGENTS.md](../AGENTS.md#cheap-to-run): cost follows mail, not time. Figures are for one mailbox getting a few hundred messages a day, on Vercel Pro, whose $20 monthly credit covers all of a project's usage before anything is billed.

| | Each month | Follows |
| --- | --- | --- |
| The minute tick (`api/cron`), with a look at each mailbox: queries, and one `getProfile` when the record has nothing | 43,200 calls, and as many `getProfile` reads a mailbox, which Google does not bill | time |
| A pass, begun by a look that found something | idle: 30 (the day's first sync), 2,900 while a rule is a Gmail filter (a check every 15 minutes); a few hundred messages a day: at most two per message (new mail, then Sift's own changes to it), about 18,000 | mail; the filter check, time |
| Workflow events: about 6 a pass or upkeep (3 for its run, 3 for its one step) | idle: (30 + 30 upkeep) × 6 ≈ 360, or 17,600 with a filter; a few hundred a day: up to (18,000 + 30) × 6 ≈ 110,000 (about $2.20 at $0.02 per 1,000). Before the look, 260,000 whatever came | mail |
| Model calls | one per message no rule or sender answers, with the cost recorded in `model_runs` | mail |

What still follows time: the tick itself, and the filter check while a rule is a filter. Gmail's history id moves with anything in the mailbox (mail sent, read on a phone), so a busy mailbox's figure is an upper bound on mail it got, not a count; not yet measured against a real mailbox.

## Code

- `src/app/`: what every host shares. `createSift(host)` (`sift.ts`), the Workflow run each piece is (`flow.ts`, the only file Workflow transforms) and what the two copies of `src/` offer each other (`process.ts`), the controls the dashboard is given, the sign-ins.
- `app/`, `proxy.ts`, `next.config.js`, `instrumentation.ts`: the page, its policy, how Next.js builds both for each host with Workflow's routes, and what each server offers as it starts.
- `src/cli/`: the commands and the Node host (`host.ts`: `nodeHost`, the listener, Next.js in the same process; `page-build.ts`).
- `src/vercel/host.ts`, the route handlers under `app/api/` and `app/auth/`, `vercel.json`: the Vercel host. `src/vercel/migrate.ts` runs in its build, after `next build`.
- `tests/runtime.test.ts`: no module state outside the hosts, and flows whose steps reach different instances. `tests/vercel.test.ts`: `vercel.json` and the route handlers against the code, and who may call `/api/cron`. `tests/look.test.ts`: when the timed tick begins a pass. `tests/flow.workflow.test.ts`: a piece done by a run, one run per key, in Workflow's own test world (`@workflow/vitest`, `vitest.config.ts`). `e2e/settings.spec.ts` (Check now): a run begun from the page, delivered through Next.js to the process that began it, its step passing the mailboxes.
