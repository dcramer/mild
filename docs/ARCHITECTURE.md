# Architecture

sift polls Gmail for new inbox mail and decides, per message, a **disposition** (`keep`, `archive`, `spam`, or `review`) and independently a **subscription action** (`preserve` or `unsubscribe`). It is designed so that most mail never reaches a language model.

## Decision cascade

Tiers run cheapest first. A tier either decides or abstains; the first decision wins.

| Tier | Where | Cost | Status |
| --- | --- | --- | --- |
| 1. Gmail filters | Gmail itself; runs even when sift is down | none | not built |
| 2. Local rules | `src/triage/stages/rules.ts` | none | built and wired (`sift rules`) |
| 3. Sender memory | `src/triage/stages/sender.ts` | one cached search per new sender | wired, but nothing populates it yet |
| 4. Decision model (Jev / Clef via pi-ai `classify`) | `src/triage/stages/classifier.ts` | ~$0.0001 per message | stage built, provider not wired |
| 5. Model | `src/triage/stages/model.ts`, `src/model/` | one model call | built; not yet run against a real model |
| Fallback | `src/triage/pipeline.ts` | none | built |

The fallback is `review`: the message stays where it is, gets a review label, and a question is queued for the user.

Rules that matter across tiers:

- A matching `keep` rule is a protection and beats any other rule.
- Sender memory never hides a sender the user has written to; it abstains.
- Spam has a higher confidence bar than archive.
- Errors abstain. Nothing fails toward a mutation.

## Learning loop

Decisions flow back down so the same mail is cheaper next time.

1. An agent decision may propose a local rule or sender record.
2. A local rule that Gmail can express, and that has matched repeatedly, is promoted to a Gmail filter.
3. Corrections are detected from Gmail history: the user moving a message back to the inbox, or out of spam, becomes an exception on the rule or sender that caused it.

## Layout

```
src/
  cli/        entry point: sift status | auth | run | review | undo | rules
  config.ts   data directory and paths
  store/      SQLite (node:sqlite) and numbered SQL migrations
  triage/     pure pipeline: types, header features, stages
  actions/    the only mutation path: executor, undo, decision-to-action planning, Mailbox port, filter validation
  gmail/      the only module that holds the Google token: OAuth, API adapter, history sync
  dashboard/  read-only JSON API over the database, and the server for the built web app (`sift dashboard`)
  daemon/     orchestration: sync pass, triage pass, and the `sift run` loop
  model/      the only module that talks to model providers (pi-ai): login, credentials, the classifier call
web/          the dashboard page: React, shadcn/ui, Tailwind, Recharts; builds to web/dist
tests/        synthetic fixtures only
docker/       Dockerfile and compose file
```

Planned, not yet created: `src/learn/` (correction detection, rule promotion), `evals/` (a labelled set for measuring each tier).

Boundaries are enforced by lint; see [AGENTS.md](../AGENTS.md).

## Gmail

- **Scopes:** `gmail.modify` and `gmail.settings.basic` (`src/gmail/scopes.ts`). Both are restricted scopes, so each user brings their own Google Cloud project with a Desktop OAuth client, using a loopback redirect with PKCE. The project must be published "In production"; in "Testing", refresh tokens expire after 7 days.
- **Tokens:** the refresh token is stored per account in `google/` in the home directory, owner-only, outside the database.
- **First connect:** sift records the current history id and handles mail from then on. It never sweeps the existing inbox unasked.
- **Sync is separate from triage:** a sync pass records message metadata and advances the cursor in one transaction; triage will work from recorded messages that have no decision yet. A failed fetch leaves the cursor in place.
- **Change detection:** poll `users.history.list` from the stored `historyId` (2 quota units per call, against 6,000 per user per minute). A 404 means the cursor expired: read the new cursor, then search the last 7 days of the inbox. Pub/Sub push is a possible opt-in; it still needs the polling fallback.
- **Reads:** `format=metadata` with named headers for triage. The body is fetched only for the agent tier.
- **Archive** is per message. Gmail shows a thread in the inbox while any message in it has `INBOX`, so a thread stays visible until each message sift was given has been handled; sift does not act on sibling messages it did not triage.
- **Filters:** at most 1,000 per account, one user label each, no update (delete then create), and they act on new mail only. `validateFilter` rejects forwarding, trash, spam and mark-read actions and criteria with no positive match.
- **Unsubscribe:** RFC 8058 one-click only (an https `List-Unsubscribe` target plus `List-Unsubscribe-Post`), and only when DKIM passes. Never a GET, never a link from the body, never `mailto:`. It is the one request sift makes to an arbitrary host, so it runs in a deterministic executor; the agent can request it but never sees the URL.

## The run loop

`sift run` repeats one pass per account: settle unconfirmed actions, sync, then triage every recorded message that has no decision.

- **Observe is the default.** Decisions are recorded with `mode = observe` and the mailbox is not touched. `--act` carries them out. Observed decisions are never acted on later.
- **Decide, record, then act.** The decision row is written before any mailbox change. Its `outcome` then records what happened: `none` (nothing needed doing), `done`, `skipped` with the reason (left the inbox, spam refused), `failed` or `unknown`.
- **Nothing is dropped.** If the change cannot even be attempted (a provider error), the decision stays unsettled and the next pass retries it. Each message is decided once.
- **One account failing does not stop the others.**

## Actions

`src/actions/executor.ts` is the only code that changes a message. Each change follows the same steps:

1. Settle any earlier action on the message whose outcome was never confirmed.
2. Read the message's labels fresh. If it is gone or no longer in the inbox, do nothing.
3. Write the intended change and the original labels to the audit log as `pending`.
4. Send one atomic label change containing only what differs, so unread state and unrelated labels are untouched.
5. Read the labels back and record `done` or `failed`. If the call itself errored, record `unknown`.

`unknown` and `pending` actions are settled by `reconcile`, which reads the mailbox and never replays the change. Archive and spam always add an audit label (`sift/archived` or a reason label, `sift/spam`). Spam is refused unless the sender is known and a search shows the user has never written to them; a failed search also refuses.

Undo reverses exactly what the action changed, keeps anything the user changed afterwards, refuses trashed mail, and is itself an audited action.

## Preferences

Preferences live in two places, by kind.

- **Broad guidance is a Markdown file**, `guidelines.md` in the home directory, in the user's own words ("recruiters count as cold outreach", "anything from my accountant is personal"). It is read on every pass and given to the model.
- **Everything structured or learned is in the database:**
  - `categories`: the kinds of mail and what to do with each (keep, archive, review, spam, and a label). Seeded with cautious defaults; changed with `sift categories set`.
  - `rules`: explicit matches the user adds.
  - `senders`: what sift has learned to do with a sender.
  - `correspondents`: whether the user has ever written to an address, cached.

## Model tier

When no rule or sender record decides a message, one model call does. It is deliberately not an agent.

- **The model has no tools and takes no action.** Deterministic code gathers the evidence first: the stored headers, the body (fetched on demand, truncated, never stored), how much mail this sender has sent, what was done with it, and whether the user has ever written to them.
- **Its only output is a category** from the user's list, or `unsure`, with a one-line reason. The reply is validated; anything else abstains.
- **The category's setting decides the outcome**, so the user's choice, not the model, determines what happens to the message.
- **Two protections apply whatever the model says:** mail from someone the user has written to is never archived or marked spam on the model's word (and "could not check" counts as yes), and `unsure` or an unknown category leaves the message for review.
- **The prompt marks the email as untrusted** and keeps it apart from the guidelines and the header facts. The worst an injected email can do is get itself put in the wrong category, which the audit log can undo.
- **Learning:** after three consecutive model decisions for a sender agree on category and outcome, the sender is written to `senders` and later mail from them is decided without inference. Senders who send mixed mail never settle and are never learned. Changing a category forgets the senders learned under it.

Models are reached through pi-ai (`src/model/`, the only module that imports it). `sift login <provider>` signs in, including with a ChatGPT subscription, and stores the credential in `model-auth.json`. The `model` setting in `sift.toml` turns the tier on; without it, mail no rule covers is left for review. pi-durable is not used: a triage run is one call, and the message queue in SQLite already gives retry and decide-once.

There is no shell and no filesystem here. A sandboxed agent with those is planned only for a possible operator-facing assistant that does open-ended analysis.

## Home directory

Everything sift keeps is in one directory, the home: `~/.config/sift` by default (`$XDG_CONFIG_HOME/sift`), or wherever `--home` or `SIFT_HOME` points (the Docker image uses `/data`). Keeping settings, guidance, the database and credentials together means it can be backed up or moved as a unit. No setting requires an environment variable.

- `sift.toml`: settings (`model`, `act`, `interval`, `dashboard.port`). Parsed strictly: an unknown key or wrong type is an error. Command-line flags override it for one run.
- `guidelines.md`: the user's broad guidance, read on every pass.
- `sift.db`: everything structured or learned.
- `google-client.json`, `google/`, `model-auth.json`, `device-id`: credentials, owner-only, kept out of the database.

`sift init` (`src/cli/init.ts`) sets all of this up. Each step checks the real state first, so running it again only asks about what is missing, and every step can be skipped.

## State

One SQLite database, `sift.db` in the home directory (schema in `src/store/migrations/`). It is the complete record of what sift saw and did, and everything else (the dashboard, undo, future analytics) reads from it.

- **messages:** one row per message sift has seen: sender, recipients, subject, the triage headers and the labels at sync time. Never the body or a snippet. This is enough to triage a message again without refetching it.
- **decisions:** an append-only log, each with its mode (observe or act) and outcome. Every triage outcome is recorded, including "keep" and "could not decide", with the tier that made it, the reason, the confidence, and what it cost (model, tokens, dollars, duration). A message can have several decisions; the latest is current.
- **actions:** the audit log of every mailbox change, with labels before and after, linked to the decision it carried out.
- **senders, rules, questions, accounts:** learned sender memory, local rules, questions waiting on the user, and each account's history cursor and last sync time.

OAuth tokens are kept in files beside the database, not in it. pi-durable keeps its own database alongside.

### Dashboard

`sift dashboard` serves a JSON API (`src/dashboard/`) and the static web app built from `web/`.

- **Read-only.** The server only reads the database; lint forbids it importing Gmail or action code. It accepts only GET.
- **Local only.** There is no login, so it answers only requests addressed to a loopback name, which also blocks DNS rebinding.
- **Untrusted content.** Subjects and sender names come from email. React renders them as text, and the page is served with a content security policy that allows no inline script, no inline style and nothing from another origin.
- **Stack.** shadcn/ui components (on Base UI) with Tailwind, and Recharts for the chart. The components live in `web/src/components/ui` as generated source. Two of them needed a change for the content security policy: `chart.tsx` no longer renders an inline `<style>`, and Base UI's style injection is turned off in `main.tsx` with its one rule moved into `index.css`. Re-check both when updating components.
- **Look.** Monochrome with hairline borders and Geist type. The only colour is a yellow highlighter, used for the headline figure, anything waiting on the user, undecided mail and search matches. Tiers are drawn as one ink that thins as cost rises, because they are an ordered cascade.
- **Shared types.** `src/dashboard/types.ts` defines the API's JSON and has no imports, so the web app imports it directly.
- **Vercel's UI SDK** (`@ui-sdk/react`, announced 2026-11-12) was evaluated and not adopted: it is a 0.1 beta of unstyled primitives with no chart or table, no shadcn integration, and it injects a runtime `<style>` by default. Revisit if shadcn ships a base built on it.

## Open questions

- Using a ChatGPT subscription from a third-party harness is unofficial; whether OpenAI permits it is unconfirmed. An API key works as a fallback.
- The model tier has only run against a scripted test provider.
- Docker egress is not yet restricted to Google and the model providers.
- How questions reach the user beyond `sift review` (a digest would need a send path, which sift does not have).
