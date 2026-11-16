# sift

Self-hosted inbox triage for Gmail. sift labels, archives, filters and unsubscribes on your behalf, asynchronously, and reaches for a language model only when cheaper methods cannot decide.

**Status: early.** sift can connect a Gmail account, sync new inbox mail, decide what each message is with rules and (optionally) one model call per message, and carry the decision out (archive, label, spam) with a full audit log and undo. A local dashboard shows what it decided and did. It has not yet been run against a real mailbox or a real model. Open work is in [TODO.md](TODO.md); the design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Set up

Requires Node 24 and pnpm.

```bash
pnpm install
```

```bash
pnpm sift init
```

`init` walks you through whatever is not done yet and can be run again at any time:

1. **Where sift runs.** On this machine, or on a server you reach from another one. Google only signs people in at `localhost` or an HTTPS address, so on a server `init` turns on `tailscale serve`, which gives the dashboard an HTTPS address on your tailnet.
2. **Google OAuth client.** sift reads your mail through a client you own, so no third party sits in between. `init` takes you through creating one a page at a time: the link, the values to enter (including the redirect addresses), then it waits. You paste the client's JSON when you create it. At the end you choose between adding yourself as a test user (works straight away; Google signs you out every 7 days) and publishing the app.
3. **Model.** Optional. A ChatGPT Plus or Pro subscription or an API key, then a model. Without one, mail that no rule covers stays in your inbox.

Then start sift and open the dashboard. **Signing in there with Google is what connects your Gmail account**, and it is also what lets you into the dashboard: only someone signed in as a connected account can see or change anything. Connect a second account from Settings.

![sift init](docs/images/cli.png)

Nothing needs an environment variable. Everything sift keeps is in one directory, `~/.config/sift`:

| File | What it is |
| --- | --- |
| `sift.toml` | Settings: the model, whether to act or only observe, how often to check, the dashboard's port and address. |
| `guidelines.md` | Your own words about how to sort your mail. |
| `sift.db` | Labels, rules, the record of every message, decision and change, and the full content of mail you have marked. |
| `google-client.json`, `google/`, `model-auth.json` | Credentials. Owner-only, and encrypted if you set `SIFT_KEY` ([docs/SECRETS.md](docs/SECRETS.md)). |

Back the directory up or move it as a unit. To keep it somewhere else, pass `--home <dir>` or set `SIFT_HOME`.

```bash
pnpm sift status
```

## Run

```bash
pnpm sift run
```

That one process sorts your mail and serves the dashboard; there is nothing else to keep running. sift starts by **observing**: it syncs new mail every 60 seconds, records what it would do, and changes nothing in Gmail. It handles mail that arrives after you connect; it never sweeps what is already in your inbox. Watch the dashboard for a while, then set `act = true` in `sift.toml` (or run `sift run --act` to try it once).

Rules decide mail without any model. A matching `keep` rule always wins.

sift gives every message one **label** (Newsletters, Receipts, Cold outreach, and any you add), and the label says what happens: keep, archive, mark spam, or block the sender. You manage labels in the dashboard.

A **rule** says what mail is without asking a model:

```bash
pnpm sift rules add --is newsletter --from-domain example.com
```

When the model has given a sender's mail the same label three times, sift writes that rule itself and stops asking the model about them.

In Gmail, mail sift acts on gets its label (`sift/newsletters`) and, if sift moved it, a second one for what sift did (`sift/did/archived`, `sift/did/spam`). Mail left for you gets `sift/review`. So everything sift touched can be found in Gmail itself. sift never deletes mail. Every change is in the audit log and can be reversed:

```bash
pnpm sift log
```

```bash
pnpm sift undo <action-id>
```

Using a ChatGPT subscription from a third-party tool is not something OpenAI documents as supported, so keep an API key as a fallback (`sift login openai --api-key`).

## Dashboard

`sift run` serves it and prints its addresses. The page is built automatically the first time and whenever its sources change.

Reach it at `http://localhost:8787` on the machine running sift, or at `https://<machine>.<tailnet>.ts.net` from your other devices once `tailscale serve --bg 8787` is on. A plain `http://hostname:8787` address shows the page but cannot sign you in.

You manage sift from here:

- **Suggestions:** a card per sender for what sift would do. Answer in one press, or open it to read the mail, see what sift knows about the sender, and choose how far your answer reaches (the sender, their domain, only when the subject contains something, or just this mail). Each message you answer for is stored whole, as an example to test and train sift with.
- **Overview:** decisions per day by tier, how much was decided without a model, model cost, the backlog and the most frequent senders.
- **Decisions:** every decision, searchable by subject or sender and filterable by tier and outcome. Choosing a row shows that message's full history: each decision, its reason and cost, and each mailbox change.
- **Rules:** add and remove rules; see how often and how recently each matched.
- **Labels:** what mail can be, and what sift does with each. Add your own.
- **Changes:** everything sift has done in Gmail, each with Undo.
- **Settings:** switch between observing and acting, choose the model and how often to check, pull in older mail to teach with, set what happens to each kind of mail, and edit your guidelines. Changes apply to the running sift straight away.

![Suggestions](docs/images/suggestions.png)

The page is a small React app in `web/` (Tailwind and its own design system, [docs/DESIGN.md](docs/DESIGN.md)). `pnpm dev` runs sift from source and reloads the page as you change either the server or the page.

## Develop

```bash
pnpm check
```

`pnpm sift <command>` runs the CLI from source. Use `--home ./tmp-home` to keep a development copy apart from your real one.

## Run in Docker

The image keeps its home directory in the `sift-data` volume.

```bash
docker compose -f docker/compose.yaml build
```

Run the same setup inside the container; for the model step choose the device-code login.

```bash
docker compose -f docker/compose.yaml run --rm -it sift init
```

```bash
docker compose -f docker/compose.yaml up
```

This starts sift, with the dashboard at http://localhost:8787. The compose file says how to reach it from other devices. Upgrading and backing up the volume: [docs/DEPLOY.md](docs/DEPLOY.md).
