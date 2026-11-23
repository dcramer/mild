# Deploying

Mild is one container and one volume. The volume is the home directory (`/data`): settings, the database and the credentials. Everything below uses the compose file; `C` stands for `docker compose -f docker/compose.yaml`.

No image is published yet, so an upgrade is a rebuild from the checkout.

## Upgrade

```sh
git pull
C build
C up -d
```

- **Back up first.** The database is migrated when Mild starts, all pending migrations in one transaction, and there is no way back down: an older Mild refuses a database a newer one migrated.
- The few seconds Mild is down cost nothing. It picks up from its Gmail history cursor.
- Without Docker: `git pull`, `pnpm install`, restart `mild run`.

## Back up

The database is PGlite, in `database/`, and only the process that has it open can read it: **copying it while Mild runs can give one that does not open.** Stop Mild first; a clean stop leaves the folder consistent.

```sh
C stop
C run --rm --no-deps -v "$PWD:/backup" --entrypoint tar sift czf /backup/sift-home.tgz -C /data .
C start
```

This writes the archive as the container's user (uid 1000), so the current directory must be writable by it.

With a Postgres server (`DATABASE_URL`), back the database up with the server's own tools (`pg_dump`, or the host's backups), and the home directory as above for the rest.

On a Postgres server, give Mild two roles: one that owns the database, as `DATABASE_MIGRATION_URL`, and a login that owns nothing (`CREATE ROLE sift LOGIN PASSWORD '…'`), as `DATABASE_URL`. Mild migrates as the first and runs as the second, which cannot alter the tables or switch their row-level security off. With only `DATABASE_URL`, that role must own the database, and so could.

What the archive is:

- **Mail.** With `MILD_KEY` set, the text of mail and everything that names a sender are encrypted; labels and what was decided and done are not. Without the key, all of it is plain. Encrypt the archive or keep it somewhere you would keep mail.
- **Credentials**, encrypted only if `MILD_KEY` is set ([secrets.md](secrets.md)), and then useless without that key. Keep the key somewhere other than the archive. A `.env` in the home directory is in the archive.

## Restore

```sh
C stop
C run --rm --no-deps -v "$PWD:/backup" --entrypoint sh sift -c 'rm -rf /data/* /data/.env && tar xzf /backup/sift-home.tgz -C /data'
C start
```

What an old backup does not know:

- **Mail since.** Mild resumes from the history cursor in the backup. Gmail keeps history for about a week; past that Mild searches the last 7 days of the inbox and anything older that arrived in between is not seen. Pull it in from the dashboard.
- **Changes since.** Anything Mild did to the mailbox after the backup is not in its log, so it cannot be undone from Mild. Gmail shows only the label Mild gave each message, not that Mild moved it.
- **A model subscription sign-in.** Its refresh token changes every time it is used, so the one in the backup has usually been replaced: sign in to it again under Settings in the dashboard. API keys and the Gmail sign-in are unaffected.

## Restricting egress

Not done. The compose file drops capabilities and mounts the filesystem read-only, but the container can reach any host. This is what limiting it to Google and the model provider would take.

**What Mild calls**

| Host | For |
| --- | --- |
| `gmail.googleapis.com`, `oauth2.googleapis.com` | Gmail, and refreshing its token |
| `api.openai.com`, and `auth.openai.com` for a ChatGPT subscription (`chatgpt.com` too by device code) | The model |
| `api.anthropic.com` | The model |
| `openrouter.ai`, `ai-gateway.vercel.sh` | The model, through OpenRouter or Vercel AI Gateway |
| The ingest host of `SENTRY_DSN`, when it is set | Errors and traces; the dashboard's page sends its own there too, from the reader's browser |
| Whatever host a sender's `List-Unsubscribe` names, port 443 | One-click unsubscribe |

The browser, not Mild, talks to `accounts.google.com` during sign-in. Confirm the list against a real run's connections before enforcing it; it is read from the code, not measured.

**The allowlist.** Docker cannot filter by hostname, and these hosts have no stable addresses, so firewall rules by IP will not hold. The workable shape is a network with no route out (`internal: true`) and, on it, a forward proxy that allows `CONNECT` only to the hosts above. That needs:

- A proxy container (Squid, Envoy or similar) on both the internal network and an outside one, with the allowlist as its configuration.
- Mild's three HTTP clients to use it, each checked: the Google libraries read `HTTPS_PROXY`; the model library reads it for the ChatGPT subscription path and otherwise uses Node's `fetch`, which needs `NODE_USE_ENV_PROXY=1`. These would be set on the container.
- The dashboard port still published; the proxy is for outbound only.

**Unsubscribing is the exception**, and cannot go through that proxy:

- Its host comes from an email, so no allowlist can name it. Letting the proxy pass any host on 443 would undo the restriction for everything else in the container.
- Mild resolves the host itself, refuses private addresses, and connects to the address it checked (`src/actions/unsubscribe.ts`). On an internal network it cannot resolve anything, and a proxy would resolve the name a second time, which is the gap that check closes.

So it needs its own path: a second, tiny container that has outside access and nothing else. No volume, no credentials, no Gmail. The core keeps deciding whether to unsubscribe (the label, DMARC, never twice) and records the action; it hands the relay one URL; the relay does the resolving, the public-address check and the single fixed POST, follows nothing, and returns only the status code. The relay's request body and headers are constant, so what a compromised core could push out through it is limited to the URL itself. That is small but not nothing, and it is the price of unsubscribing at all; an install that wants none of it turns unsubscribe off on its labels and runs without the relay.

Until that exists, restricting egress means giving up unsubscribing.
