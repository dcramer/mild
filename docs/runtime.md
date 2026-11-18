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
| A pass per mailbox | every mailbox with a label of its own: at the timed tick only when a look finds something for it (`passWanted`, `src/work/run.ts`), and whenever its person asks | `pass:<mailbox's number>` |
| Upkeep per person | `upkeep:<person>:<day>` in `Ephemeral`, claimed when it starts and let go if it fails | `upkeep:<person>` |
| Going through an inbox, or applying a rule to it, its next slice | `inbox_runs` not finished: at the timed tick only while the mailbox's sign-in has not expired, and, going through the inbox, while the person has a model | `inbox:<mailbox's number>:<run>` |
| A test run's next slice | runs marked running: at the timed tick only while the person has a model | `eval:<person>:<run>` |

The look reads the record first: a change to confirm, a decision to carry out, text of waiting mail to keep or let go, an example to store, a Gmail filter check due (one that failed counts as a check, so it is tried again 15 minutes on, not every minute), mail waiting while there is a model to decide it, the day's first sync, and a last pass that failed, ran out of time or is not in `Ephemeral`. Only if none, and only once the mailbox's look gap has passed, it reads Gmail's history from the cursor sync keeps (`syncWants`, `src/work/sync.ts`: `history.list`, 2 quota units a page) and begins the pass for mail new to the inbox or a change the person made to a message. History does not say who made a change, so Sift's own since the last sync, which the `actions` record holds, are taken out of it as sync takes them out (`userChanges`, `src/learn/gmail.ts`): archiving or labelling mail begins no second pass, while the person moving that mail back still does. A change Sift cannot match to its record counts as the person's.

The gap (`lookGap`, `src/work/gap.ts`) is a tenth of how long ago the mailbox's latest recorded mail reached Gmail, between the minute's tick and a ceiling of 10 minutes: mail in the last 10 minutes means a look every tick, and busy mail lands in a batch per pass; after 100 quiet minutes, a look every 10. The first mail after a quiet spell waits up to 10 minutes, and once a pass records it the gap is a minute again. It counts from when the last look or pass began (`at`, `src/work/status.ts`), so a long pass does not stretch it, and a look is made once the next tick would be past it. Mail dated later than now (imported, or inserted through the API) is not taken as recent. Only Gmail waits: the record is read every tick.

A look that cannot tell begins the pass, except when Google says the sign-in has expired: that fails every pass alike, so the look records it for the dashboard's notice and begins nothing until Gmail answers again. One that finds nothing records the mailbox's status as a pass that found nothing would, so "Last checked" stays true. A person's press (Check now, an answer, applying a rule, a model saved, going through the inbox) begins their passes without looking. With no model, a rule added since decides waiting mail only at the next pass begun for something else.

Going through an inbox and a test run do nothing without a model, and an inbox run's slice fails like a pass while the sign-in has expired, so the timed tick begins them only when neither holds; the look above finds when Gmail answers again. Applying a rule needs no model, so its slices are begun with or without one, and what it decides is carried out by the pass the look then begins (`tests/look.test.ts`). A press begins them regardless.

Work left unfinished is due again at the next tick. Ticks may overlap: a run holds its key from when it is begun until it ends (Workflow's `experimental_hook`), and beginning the piece again meanwhile is refused and skipped, on every host and instance alike. Workflow keeps keys and pieces unencrypted on a machine, so a mailbox is named in both by its number (`mailboxes.number`), never its address (`runKey`, `src/app/sift.ts`). A hash of the address would not do: addresses are guessable. A mailbox removed and connected again has a new number, so a run of its old one does not hold back the new. A run whose step fails is retried by Workflow; one that never finishes holds its key, so its piece is never begun again. A tick refused by a run begun more than 30 minutes ago, longer than any run lasts (four tries of a step, each within the host's limit), logs it and reports it to Sentry, every minute until the run ends (`STUCK_MS`, `src/app/sift.ts`); nothing ends it for Sift.

Each run is started with `experimental_retention: 0`: once it ends, Workflow deletes its input (the piece, which names the mailbox) and its step's, keeping only the record that it ran (ids, times, status). The Local World does this in the home's `workflow/` (`tests/flow.workflow.test.ts`); on Vercel it also keeps what is billed for retained data down. Not yet seen on Vercel. A ChatGPT device code is asked about when the page reloads while the person enters it, at most once per OpenAI's interval.

## Hosts

One Next.js app is the whole server on both hosts: the page, `/api/` and `/auth/` (route handlers that call `respond`), `/api/cron` and Workflow's flow route. Each process builds its host inside the app once, the first time anything asks (`src/app/instance.ts`): Vercel's from its environment (`vercelHost`, `src/vercel/host.ts`), or, anywhere else, `sift run`'s from the home directory and its settings, opening PGlite there (`localHost`, `src/cli/host.ts`). Next.js may load that module once for each bundle that imports it, so the host is kept on `globalThis` for the process, and Sift is put together over it again by each copy, so a change `next dev` reloads is in the next request.

| | `sift run` (`src/cli/`) | Vercel (`src/vercel/`, `app/`, `vercel.json`) |
| --- | --- | --- |
| Before serving | The command line migrates the database, brings every secret under the current key and says what is set up, then lets the database go, since PGlite is one process's alone; then builds the page from a checkout (`buildPage`, `src/cli/next.ts`) | the deploy's build migrates and rekeys (`src/vercel/migrate.ts`) |
| The server | `next start` from a checkout, the standalone server in the image, or under `sift dev` `next dev`, which reloads what changes under `src/` and `app/` (`startNext`, `src/cli/next.ts`), on one address | Vercel's functions |
| Each minute | `sift run` calls `/api/cron` as Vercel Cron would, not waiting for the last, with a secret made from the session secret the home keeps (`cronSecret`, `src/cli/session.ts`) | Vercel Cron calls `/api/cron` with `CRON_SECRET` |
| A piece of work | a run in Workflow's Local World, kept in the home's `workflow/` and delivered to this server's flow route; 5-minute limit | a run in Workflow's Vercel World, its step a call of Workflow's flow route; 300 seconds less a minute |
| Started by a person | `tick([person])`, in the request | the same |
| `Ephemeral` | memory, or Redis when `REDIS_URL` is set | Redis |
| Database | PGlite, or Postgres; migrated when opened | Postgres (Neon); migrated by the deploy's build, and checked again when opened |
| Settings, keys | the environment, the home's `.env` and files, and `.env` in the directory Sift started from (where `init` puts `SIFT_KEY`) | the environment |

Memory is right for one `sift run` process only. Two processes, or any host with instances, need Redis.

Next.js also reads the checkout's own `.env` files (`.env`, `.env.local`, `.env.production`) into the server, as it does for any app, and a variable already set wins. `vercel env pull` writes production's values into `.env.local`: in a checkout that runs `sift run`, that file points it at production.

**Listening.** Next.js's server takes one address, so Sift listens on one: `127.0.0.1` unless `SIFT_DASHBOARD_HOST` names another (`listenAddress`, `src/cli/network.ts`), `::` for `all`, or `--host`'s. The launcher hands it to the server as `HOSTNAME` and `PORT`, as the standalone server takes them. Next.js builds a request's URL from `X-Forwarded-Proto`, whoever sent it, so the scheme is believed only while Sift listens on loopback, where every peer is this machine, `tailscale serve` among them (`Host.forwarded`); listening anywhere else, every request is taken as plain HTTP, and Google signs someone in only at `localhost`. Reaching it over Tailscale is `tailscale serve`, with no `SIFT_DASHBOARD_HOST`.

**Runs across a restart.** The Local World keeps its queue in memory, so a run cut off by a stop or a crash would hold its key for good. As the server starts, `instrumentation.ts` opens the host, which says where the World keeps its runs and where to deliver them (`WORKFLOW_LOCAL_DATA_DIR`, `WORKFLOW_LOCAL_BASE_URL`), then starts the World (`takeUpRuns`, `src/app/instance.ts`), which sends every unfinished run again and hands back the step that was under way, so it runs again (`tests/restart.workflow.test.ts`), as Workflow's documentation has it. On Vercel the platform's queue does this. Stopping is Next.js's own: no new requests, the ones under way finished, a run's step among them, then exit, which waits for the store to close (`closeOnStop`, `src/app/instance.ts`), so PGlite is left shut down and a copy of it opens ([deploy.md](deploy.md)) (`tests/stop.test.ts`); what a crash cuts off waits for the next start. `sift reset-db` moves `workflow/` aside with the database, since its runs name the old one's people and mailboxes.

**Tests.** The browser tests and verify-sift run this same app (verify-sift's `serve.ts`, on `startNext`), with stand-ins for Gmail and the model preloaded into the server's process (`stand-ins.ts`, `NODE_OPTIONS=--import`); the local host takes them from `globalThis` (`StandIns`, `src/app/sift.ts`), the one seam a test reaches, and nothing else sets it. Fakes at the network boundary instead, a fake Gmail API and a fake model endpoint, would need base URLs as settings that only tests use, and a fake Gmail that holds what the seed made. A run's step takes its Sift from `globalThis` too where a test offers one (`offerSift`), since `@workflow/vitest` runs the steps from a bundle of its own.

### On Vercel

Setting it up, and every variable it needs: [vercel.md](vercel.md). Next.js bundles the route handlers, except the packages in `serverExternalPackages` (`next.config.js`), loaded from `node_modules` as they are because some read files beside their own modules. It copies `src/store/migrations` into the functions (`outputFileTracingIncludes`), and `src/store/db.ts` finds it from its own path, not with `new URL('./migrations/', import.meta.url)`, which the bundler would take for one file to bundle. Each route handler of Sift's own sets `maxDuration` to the limit the code assumes (`MAX_DURATION_S`, held by `tests/vercel.test.ts`). Workflow writes its routes into `app/.well-known/workflow/` at build, with a flow route that Vercel's queue calls and whose limit is the plan's longest, and a webhook route that `next.config.js` rewrites to a page that is not there, since Sift makes no webhooks; a piece still starts nothing after 300 seconds less a minute, the shortest of those limits (Hobby's).

A run's piece names a person and their mailbox by id; Sift opens that person's database and finds the mailbox among their own. `/api/cron` takes only Vercel Cron's call, with `CRON_SECRET`. Every other `/api/` path, and `/auth/`, goes to `respond`, which keeps the dashboard's own checks: a session for every `/api/` route, the Host one of the deployment's names, writes only from the page.

Sift runs in production on Vercel. Not yet seen there: a Workflow run.

## Many mailboxes on Vercel

Each piece of work is a run of its own, its step a call of its own, so mailboxes do not wait on each other and none shares a function's memory or time with another. Each step starts nothing after its limit less a minute (a model call gives up after 60 seconds), so it never runs into the limit; what it leaves is due at the next tick. More mailboxes cost more runs, at most one for each message they get or change their person makes in Gmail, and no latency.

## What it costs

The rule is in [AGENTS.md](../AGENTS.md#cheap-to-run): cost follows mail, not time. Figures are for one mailbox getting a few hundred messages a day, on Vercel Pro, whose $20 monthly credit covers all of a project's usage before anything is billed.

| | Each month | Follows |
| --- | --- | --- |
| The minute tick (`api/cron`), with a look at each mailbox: queries every tick, and Gmail's history once the gap has passed | 43,200 calls; history read about 4,300 times a mailbox when idle, every tick while mail keeps coming, which Google does not bill | time |
| A pass, begun by a look that found something | idle: 30 (the day's first sync), 2,900 while a rule is a Gmail filter (a check every 15 minutes); 300 messages a day arriving spread out: about 8,100, one a message, few sharing a minute; in 6 bursts of 50: about 330, a burst taken in one or two | mail; the filter check, time |
| Workflow events: 6 a pass or upkeep (3 for its run, 3 for its one step; the start hook that holds its key adds none, since `run_created` stands for its creation and the run's end releases it) | idle: (30 + 30 upkeep) × 6 ≈ 360, or 17,600 with a filter; spread out: (8,100 + 30) × 6 ≈ 49,000 (about $1 at $0.02 per 1,000); in bursts: (330 + 30) × 6 ≈ 2,200. Before Sift's own changes were told apart, each pass that changed mail began a second, up to twice those; before the look, 260,000 whatever came | mail |
| Model calls | one per message no rule or sender answers, with the cost recorded in `model_runs` | mail |
| The page | a dashboard screen is drawn per request: one call each time one is opened or gone to from another, with nothing fetched ahead. Opening one reads the session, Settings' data and usage inside that call, which were three of the browser's `/api/` calls before, and the masthead's count comes with Settings' data, which ended a `/api/suggestions` call on every screen and each half minute while it is open. Opened 20 times a day and gone between 40 times, that is 1,800 calls a month for the screens, 1,800 fewer `/api/` calls, and 86,400 fewer for a tab left open all month on any screen but For review. The legal pages, the design system's and a sender's or domain's page are built once and served as files | visits |

The pass and look counts are a month of minute ticks simulated under the gap, counting arrivals only, with mail arriving at random times (spread out) or 50 within 5 minutes six times a day (bursts). Spread-out mail comes about every 5 minutes, so the gap stays at a minute and each message gets its pass; bursts wait for the first look after a quiet spell (3.8 minutes on average, 7 at most) and arrive in one batch.

What still follows time: the tick itself, and the filter check while a rule is a filter. "Idle" means no mail and no change by the person. Mail read, moved or labelled in Gmail begins a pass too: while mail keeps coming the gap is a minute, so about one for each, which can double the spread-out figures; changes made while the mailbox is quiet wait for the gap and share one. Whether sending a draft, or Gmail's own importance and category marks, show in history as label changes, which would begin passes too, is not yet checked ([TODO.md](../TODO.md)). Not yet measured against a real mailbox.

## Code

- `src/app/`: what every host shares. `createSift(host)` (`sift.ts`), the process's one host and the route handlers' entry points (`instance.ts`), the Workflow run each piece is (`flow.ts`, the only file Workflow transforms), the controls the dashboard is given, the sign-ins.
- `app/`, `next.config.js`, `instrumentation.ts`: the page (its screens drawn per request with what `src/app/page-data.ts` reads through the API), its headers, the route handlers, how Next.js builds them for each host with Workflow's routes, and the World started as the server starts.
- `src/cli/`: the commands, `sift run`'s host (`host.ts`: `localHost`), how it starts Next.js (`next.ts`), and the secrets it and the server share (`session.ts`). The command line never loads the app's own modules, which are Next.js's to bundle.
- `src/vercel/host.ts`, `vercel.json`: the Vercel host. `src/vercel/migrate.ts` runs in its build, after `next build`.
- `tests/runtime.test.ts`: no module state outside the hosts, and flows whose steps reach different instances. `tests/vercel.test.ts`: `vercel.json` and the route handlers against the code, and who may call `/api/cron`. `tests/network.test.ts`: `sift run`'s host, where it listens and when it believes a forwarded scheme. `tests/look.test.ts`: when the timed tick begins a pass (Sift's own changes and the gap between looks among it), an inbox run's slice (applying a rule among them) or a test run's. `tests/flow.workflow.test.ts`: a piece done by a run, one run per key, nothing kept once it ends, in Workflow's own test world (`@workflow/vitest`, `vitest.config.ts`). `tests/restart.workflow.test.ts`: a run cut off mid-step finished by a World started again on its data. `e2e/settings.spec.ts` (Check now): a run begun from the page, delivered to the flow route, its step passing the mailboxes; `e2e/rules.spec.ts` (Apply to your inbox, with what is due begun): applying a rule, begun by its press, going on in a run of its own until it finishes.
