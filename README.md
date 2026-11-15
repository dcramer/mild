# sift

Self-hosted inbox triage for Gmail. sift labels, archives, filters and unsubscribes on your behalf, asynchronously, and reaches for a language model only when cheaper methods cannot decide.

**Status: early.** sift can connect a Gmail account, sync new inbox mail, decide it with local rules, learned senders and (optionally) one model call per message, and carry the decision out (archive, label, spam) with a full audit log and undo. A local dashboard shows what it decided and did. It has not yet been run against a real mailbox or a real model. Open work is in [TODO.md](TODO.md); the design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Connect Gmail

sift uses your own Google Cloud project, so no third party sits between you and your mail.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Gmail API**.
2. Configure the OAuth consent screen as **External**, add the scopes `gmail.modify` and `gmail.settings.basic`, and set the publishing status to **In production**. Left in "Testing", Google expires the token every 7 days. You will see an "unverified app" warning when you approve; that is expected for a personal project.
3. Create an OAuth client of type **Desktop app**, download its JSON and save it as `data/google-client.json`.
4. Connect and fetch:

```bash
pnpm sift auth
```

```bash
pnpm sift sync --verbose
```

`auth` prints a URL to approve in a browser. If the browser is on another machine and ends on a page that will not load, paste that page's URL back into the terminal. sift starts from the moment you connect; it does not sweep mail already in the inbox.

## Run

```bash
pnpm sift run
```

By default sift **observes**: it syncs new mail every 60 seconds, records what it would do, and changes nothing in Gmail. Watch the dashboard for a while, then let it act:

```bash
pnpm sift run --act
```

Rules decide mail without any model. A matching `keep` rule always wins.

```bash
pnpm sift rules add --do archive --from-domain example.com --label sift/newsletters
```

```bash
pnpm sift rules list
```

Mail that no rule covers gets the label `sift/review` and stays in the inbox. Archived mail gets `sift/archived` (or the rule's label) and spam gets `sift/spam`, so everything sift moved can be found in Gmail itself. sift never deletes mail.

Every change is in the audit log and can be reversed:

```bash
pnpm sift log
```

```bash
pnpm sift undo <action-id>
```

`sift apply <archive|label|spam> <message-id>` applies one action by hand; message ids come from `sift sync --verbose`.

## Let a model decide what rules don't cover

Without a model, mail that no rule covers is left for review. To turn the model tier on, sign in to a provider, pick a model and set `SIFT_MODEL`:

```bash
pnpm sift login openai
```

```bash
pnpm sift models
```

```bash
SIFT_MODEL=provider/model-id pnpm sift run
```

`sift login openai` signs in with a ChatGPT subscription; add `--api-key` to use an API key instead. The model only names a category for each message. What happens to that category is your setting:

```bash
pnpm sift categories
```

```bash
pnpm sift categories set newsletter --do keep
```

Write broad guidance in your own words in `data/guidelines.md` ("recruiters are cold outreach", "anything from my accountant is personal"). After a sender's mail has been put in the same category three times, sift remembers the sender and stops asking the model about them.

## Dashboard

```bash
pnpm build:web
```

```bash
pnpm sift dashboard
```

Opens a read-only page at http://localhost:8787. It has no login and answers only on localhost.

- **Overview:** decisions per day by tier, how much was decided without a model, model cost, the backlog and the most frequent senders.
- **Decisions:** every decision, searchable by subject or sender and filterable by tier and outcome. Choosing a row shows that message's full history: each decision, its reason and cost, and each mailbox change.
- **Rules:** each rule, what it does, and how often and how recently it matched.

![The sift dashboard](docs/images/dashboard.png)

The page is a small React app in `web/` (shadcn/ui on Base UI, Tailwind, Recharts). `pnpm dev:web` runs it with hot reload against a running `sift dashboard`.

## Develop

Requires Node 24 and pnpm.

```bash
pnpm install
```

```bash
pnpm check
```

```bash
pnpm sift status
```

State lives in `./data` (override with `SIFT_DATA_DIR`). It holds mail metadata and tokens and is gitignored.

## Run in Docker

```bash
docker compose -f docker/compose.yaml build
```

Copy `google-client.json` into the `sift-data` volume, then connect with a published loopback port:

```bash
docker compose -f docker/compose.yaml run --rm -p 127.0.0.1:8765:8765 sift auth --port 8765 --host 0.0.0.0
```

```bash
docker compose -f docker/compose.yaml up
```

This starts sift in observe mode and the dashboard at http://localhost:8787.
