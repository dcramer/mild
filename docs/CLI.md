# Command line

The CLI sets sift up and starts it. Rules, labels, the record of changes, undo and the choice of model are in the [dashboard](DASHBOARD.md) and have no command.

From a checkout, `pnpm sift <command>` runs it from source.

| Command | What it does |
| --- | --- |
| `sift init` | Set sift up. A first run walks through every step; one stopped part-way carries on from where it stopped. Once setup is finished it lists the steps with what each is set to and redoes the one you pick. |
| `sift run` | Read and classify mail, and serve the dashboard. The one process to keep running. |
| `sift status` | What is set up, and how much sift has recorded. |
| `sift dev` | `run` for working on sift: restarts when server code changes, rebuilds and reloads the page when page code changes. Takes `run`'s options. |
| `sift dashboard` | Serve the dashboard without reading mail. Takes `--port` and `--host`. |

`--home <dir>` works with every command and says where sift keeps its files. When working on sift, give it a scratch directory so your real mail is left alone.

![sift init](images/cli.png)

## `sift run`

| Option | Effect |
| --- | --- |
| `--once` | One pass over every account, then exit, without serving the dashboard. Exits 1 if an account failed. |
| `--port <port>` | The dashboard's port for this run. |
| `--host <address>` | Listen on this address instead of what `sift.toml` says. A container uses `0.0.0.0` and lets its port mapping decide who can reach it. |
| `--no-dashboard` | Read and classify mail without serving the dashboard. |

A pass runs every minute, each person's mailboxes changed in Gmail only if that person turned sift on under Settings in the dashboard. A change there applies from the next pass, without a restart; a change to `sift.toml` needs one.

## Models

Each person signs in to a model and chooses one under Settings in the dashboard: ChatGPT, or an OpenAI, Anthropic, OpenRouter or Vercel AI Gateway API key. The newest small model is offered first.

ChatGPT is signed in to one way per install, set by `[chatgpt] sign_in` in `sift.toml` or `SIFT_CHATGPT_SIGN_IN`:

- `device-code`, the default: a code entered at OpenAI. It reaches ChatGPT through Codex's backend, which OpenAI does not document for other tools.
- `redirect`: OpenAI's Sign in with ChatGPT, on its documented API. OpenAI sends the browser back only to `127.0.0.1` on the person's own machine, so they land on a page that will not load and paste its address into the dashboard.

Changing it signs everyone out of ChatGPT.

## Files

Nothing needs an environment variable. Everything sift keeps is in one directory, `~/.config/sift` (`$XDG_CONFIG_HOME/sift`) unless `--home` or `SIFT_HOME` says otherwise. Back it up or move it as a unit.

| File | What it is |
| --- | --- |
| `sift.toml` | Settings: the dashboard's port and address, who can sign in, and a Postgres server's address. Unknown keys are errors. Whether sift is on is each person's, under Settings in the dashboard. |
| `database/` | The database (PGlite), unless `DATABASE_URL` or `database.url` names a Postgres server: who has which mailbox, and for each person their sign-ins (encrypted), model, labels, rules, the record of every message, decision and change, and the full content of mail they answered for. |
| `database.lock` | Which process has the database open. |
| `google-client.json`, `dashboard-key` | The Google client and the session secret. Owner-only. |
| `setup.json` | How far `init` has got. |
