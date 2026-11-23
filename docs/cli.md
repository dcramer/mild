# Command line

The CLI sets Mild up and starts it. Rules, labels, the record of changes, undo and the choice of model are in the [dashboard](dashboard.md) and have no command.

From a checkout, `pnpm mild <command>` runs it from source.

| Command | What it does |
| --- | --- |
| `mild init` | Set Mild up. A first run walks through every step; one stopped part-way carries on from where it stopped. Once setup is finished it lists the steps with what each is set to and redoes the one you pick. |
| `mild run` | Read and classify mail, and serve the dashboard. The one process to keep running. |
| `mild status` | What is set up, and how much Mild has recorded. |
| `mild dev` | `run` for working on Mild, with `next dev`, which reloads the page and the server's code as they change. Takes `run`'s options. |
| `mild reset-db` | Renames the local database folder to `database.<time>`, so Mild starts a new, empty one, and Workflow's runs (`workflow/`) to `workflow.<time>`, since they name the old database's people and mailboxes. For a database an earlier Mild made with migrations since replaced. Refused while Mild has it open; not for a Postgres server. `pnpm db:reset` runs it. |

`--home <dir>` works with every command and says where Mild keeps its files. When working on Mild, give it a scratch directory so your real mail is left alone.

![mild init](images/cli.png)

## `mild run`

| Option | Effect |
| --- | --- |
| `--port <port>` | The dashboard's port for this run. |
| `--host <address>` | Listen on this address instead of `localhost`. A container uses `0.0.0.0` and lets its port mapping decide who can reach it. |

`run` migrates the database and brings every stored secret under the current key, then builds the page from a checkout (seconds, with Next.js's cache) and starts Next.js on `localhost`. From another machine it is reached through `tailscale serve`, the only way off this machine that Google signs someone in at, with `MILD_URL` set to the Tailscale address (`mild init` does both). Next.js also reads the checkout's own `.env` files, as it does for any app.

Each minute Mild reads its record for every mailbox, and Gmail once the mailbox's gap has passed (a minute while mail keeps coming, up to 10 when it is quiet), and passes over the ones with something to do, each person's mailboxes changed in Gmail only if that person turned Mild on under Settings in the dashboard. A change there applies from the next pass, without a restart; a change to a setting needs one.

## Models

Each person signs in to a model and chooses one under Settings in the dashboard: ChatGPT, or an OpenAI, Anthropic, OpenRouter or Vercel AI Gateway API key. The newest small model is offered first.

ChatGPT is signed in to one way per install, set by `MILD_CHATGPT_SIGN_IN`:

- `device-code`, the default: a code entered at OpenAI. It reaches ChatGPT through Codex's backend, which OpenAI does not document for other tools.
- `redirect`: OpenAI's Sign in with ChatGPT, on its documented API. OpenAI sends the browser back only to `127.0.0.1` on the person's own machine, so they land on a page that will not load and paste its address into the dashboard.

Changing it signs everyone out of ChatGPT.

## Files

Nothing needs an environment variable. Everything Mild keeps is in one directory, `~/.config/mild` (`$XDG_CONFIG_HOME/mild`) unless `--home` or `MILD_HOME` says otherwise. Back it up or move it as a unit.

| File | What it is |
| --- | --- |
| `.env` | Settings, as variables: the dashboard's port and where people open it (`MILD_DASHBOARD_PORT`, `MILD_URL`, which digests link to), a Postgres server and the role that migrates it (`DATABASE_URL`, `DATABASE_MIGRATION_URL`), a Redis server (`REDIS_URL`), `MILD_CHATGPT_SIGN_IN`, `SENTRY_DSN` (set from `mild init` once setup is finished), and `MILD_CLOUD`, `true` on a Mild run for other people, which gives it terms, a privacy policy and a security page. The environment wins over it. Whether Mild is on is each person's, under Settings in the dashboard. |
| `database/` | The database (PGlite), unless `DATABASE_URL` names a Postgres server: who has which mailbox, and for each person their sign-ins (encrypted), model, labels, rules, the record of every message, decision and change, and the full content of mail they answered for. |
| `database.lock` | Which process has the database open. |
| `workflow/` | Workflow's runs: each piece of work Mild has begun, and the key that lets only this install deliver them. |
| `google-client.json`, `dashboard-key` | The Google client and the session secret. Owner-only. |
| `setup.json` | How far `init` has got. |
