# Architecture

sift polls Gmail for new inbox mail and decides, per message, a **disposition** (`keep`, `archive`, `spam`, or `review`) and independently a **subscription action** (`preserve` or `unsubscribe`). It is designed so that most mail never reaches a language model.

## Labels, rules and the cascade

Two things are decided about every message, and they are kept apart.

- **What it is: a label.** Each account has one list of labels (`labels`), seeded with cautious defaults and added to by the user. A label has a name, a description the model reads, a Gmail label, and an action.
- **What happens: the label's action**, one of keep, archive, mark spam, or block. No tier picks an action. Beside the outcome a label can carry extras: mark read (with keep and archive) and unsubscribe. A rule can add either for the mail it matches. "Leave it for me" is not an action: sift suggesting instead of acting is a matter of trust, and the only time mail is held for the user is when no tier could place it or a protection stopped sift.
- **Block** is sift's own, since Gmail's block list is not in its API ([GMAIL.md](GMAIL.md)): the message is marked spam, and once that has happened a rule is written so the sender's later mail is that label without a model. Only when the message passed DMARC, so an impersonated sender is not the one blocked, and never for someone the user has written to. A rule may carry the user's own exception to its label's action ("this one is a newsletter, but keep it").

A label's id and Gmail label never change after it is made, so renaming one orphans nothing.

Tiers run cheapest first. A tier either names a label or abstains; the first answer wins.

| Tier | Where | Cost | Status |
| --- | --- | --- | --- |
| 1. Gmail filters | Gmail itself; runs even when sift is down | none | built: a rule is copied there when the user asks ([Rules as Gmail filters](#rules-as-gmail-filters)) |
| 2. Rules | `src/triage/stages/rules.ts` | none | built and wired |
| 3. Decision model (Jev / Clef via pi-ai `classify`) | `src/triage/stages/classifier.ts` | ~$0.0001 per message | stage built, provider not wired |
| 4. Model | `src/triage/stages/model.ts`, `src/model/` | one model call | built; not yet run against a real model |
| Fallback | `src/triage/pipeline.ts` | none | built |

The fallback is `review`: the message stays where it is, gets the review label, and is shown to the user.

**A rule** says that mail matching some conditions is a label. It is the only deterministic thing sift knows, and there is one kind: what used to be a separate memory of senders is a rule with a single "from" condition. Rules come from the user (`user`), from the user correcting a suggestion (`correction`), or from sift itself (`agent`) once a model has given a sender's last three messages the same label.

Rules that matter across tiers:

- A rule whose outcome is `keep` is a protection and beats any other rule. Otherwise the most specific rule wins (more conditions, then an exact sender over a domain), so "this sender when the subject contains X" beats "this sender" whichever was written first.
- A rule sift learned never hides mail from someone the user has written to; the user's own rules do what they say.
- A rule whose label has been removed does nothing.
- Spam has a higher confidence bar than archive.
- Errors abstain. Nothing fails toward a mutation.

## Learning loop

Decisions flow back down so the same mail is cheaper next time.

1. An agent decision may propose a local rule or sender record.
2. A rule that Gmail can express is copied to a Gmail filter when the user asks for it. sift does not promote one by itself.
3. Corrections are detected from Gmail history: the user moving a message back to the inbox or out of spam, archiving or marking as spam what sift kept, or changing its `sift/…` label, is their answer for that one message ([Teaching](#teaching)). It never makes or changes a rule by itself.

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
  learn/      what the user teaches: suggestions and answers, and answers read from what they did in Gmail
  model/      the only module that talks to model providers (pi-ai): login, credentials, the classifier call
web/          the dashboard page: React, Tailwind, its own design system on Base UI; builds to web/dist
tests/        synthetic fixtures only
docker/       Dockerfile and compose file
```

Planned, not yet created: `evals/` (a labelled set for measuring each tier).

Boundaries are enforced by lint; see [AGENTS.md](../AGENTS.md).

## Gmail

- **Scopes:** `gmail.modify` and `gmail.settings.basic` (`src/gmail/scopes.ts`). Both are restricted scopes, so each user brings their own Google Cloud project with a Web application OAuth client; sign-in is the authorisation-code flow with PKCE, started from the dashboard. Left in "Testing", Google limits sign-in to listed test users and ends it every 7 days.
- **Tokens:** the refresh token is stored per account in `google/` in the home directory, owner-only, outside the database.
- **First connect:** sift records the current history id and handles mail from then on. It never sweeps the existing inbox unasked.
- **Sync is separate from triage:** a sync pass records message metadata and advances the cursor in one transaction; triage will work from recorded messages that have no decision yet. A failed fetch leaves the cursor in place.
- **Change detection:** poll `users.history.list` from the stored `historyId` (2 quota units per call, against 6,000 per user per minute). A 404 means the cursor expired: read the new cursor, then search the last 7 days of the inbox. History also carries every label change, sift's own included and with no word on who made it, so `userChanges` (`src/learn/gmail.ts`) cancels each change in sift's `actions` log since the previous sync began against one matching entry; what is left is the user's. Label changes made while the cursor was expired are lost. Pub/Sub push is a possible opt-in; it still needs the polling fallback.
- **Reads:** `format=metadata` with named headers for triage. The body is fetched only for the agent tier.
- **Archive** is per message. Gmail shows a thread in the inbox while any message in it has `INBOX`, so a thread stays visible until each message sift was given has been handled; sift does not act on sibling messages it did not triage.
- **Filters:** at most 1,000 per account, one user label each, no update (delete then create), and they act on new mail only. `validateFilter` rejects forwarding, trash, spam and mark-read actions and criteria with no positive match. See [Rules as Gmail filters](#rules-as-gmail-filters).
- **Unsubscribe:** RFC 8058 one-click only (an https `List-Unsubscribe` target plus `List-Unsubscribe-Post`), and only when DKIM passes. Never a GET, never a link from the body, never `mailto:`. It is the one request sift makes to an arbitrary host, so it runs in a deterministic executor; the agent can request it but never sees the URL.

## The run loop

`sift run` is the one long-running process: it serves the dashboard and repeats one pass per account: settle unconfirmed actions, sync, then triage every recorded message that has no decision.

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

`unknown` and `pending` actions are settled by `reconcile`, which reads the mailbox and never replays the change. **In Gmail a message sift acts on gets two labels:** the one for what it is (`sift/newsletters`) and, when sift moved it, one for what sift did (`sift/did/archived`, `sift/did/spam`). The executor adds the second itself, so anything sift moved can be found in Gmail whatever the caller passed. Mail left for the user gets `sift/review`. Spam is refused unless the sender is known and a search shows the user has never written to them; a failed search also refuses.

Undo reverses exactly what the action changed, keeps anything the user changed afterwards, refuses trashed mail, and is itself an audited action.

## Rules as Gmail filters

A rule can also be written to Gmail as a filter, so it applies when sift is not running. Only when the user asks, per rule, and only while sift is acting.

- **Which rules.** `filterFor` (`src/triage/filter.ts`, pure) says whether a rule can be one, and why not. A filter runs before sift sees the message and knows none of sift's other rules or protections, so a rule qualifies only if the filter could never do what sift itself would not have done. Refused: a rule that is judged (`usually`, or with a `when`); one whose outcome is spam (not documented for filters) or that marks read (`validateFilter` does not allow it); one matching a list id or carrying exceptions; one sift learned that archives, since a filter cannot spare people the user has written to; one whose values could change the meaning of a Gmail search; and one that another rule could overrule for the same mail (a keep rule, a judged rule, or a narrower one).
- **Where Gmail differs.** A recipient condition also matches Cc and Bcc; subject words match whole words, not substrings; a domain is written `@domain`. The verdict lists these (`differs`) so they can be shown before the user asks.
- **Archived by a filter means unseen by sift.** Sync records mail that arrives in the inbox. Mail a filter archives is not recorded, counted against the rule, or unsubscribed from.
- **Writing and removing** go through `src/actions/rule-filters.ts`: validated, written to `actions` first (`filter`, `unfilter`, with no message), then read back from Gmail's list. A filter the account already has that does exactly the same is taken over, since Gmail refuses a duplicate. Removing a rule removes its filter first.
- **Keeping track.** At most every 15 minutes a pass lists the account's filters and records on each rule (`filter_state`) what it found: `active`; `changed` (edited in Gmail: left alone); `gone` (deleted in Gmail: not put back); `outdated` (the rule, its label or another rule changed, so the filter no longer does what sift would). An outdated filter is replaced, or removed if the rule can no longer be one, while sift is acting; while observing it is only marked, and keeps running in Gmail.

## Preferences

Preferences live in two places, by kind.

- **Broad guidance is a Markdown file**, `guidelines.md` in the home directory, in the user's own words ("recruiters count as cold outreach", "anything from my accountant is personal"). It is read on every pass and given to the model.
- **Everything structured or learned is in the database:**
  - `labels`: what mail can be and what to do with each. Seeded with cautious defaults (nothing is marked spam); changed and added to in the dashboard, under Labels.
  - `rules`: what sift knows without a model, the user's and the ones it learned.
  - `correspondents`: whether the user has ever written to an address, cached.

## Model tier

When no rule or sender record decides a message, one model call does. It is deliberately not an agent.

- **The model has no tools and takes no action.** Deterministic code gathers the evidence first: the stored headers, the body (fetched on demand, truncated, never stored), how much mail this sender has sent, what was done with it, and whether the user has ever written to them.
- **Its only output is a label** from the user's list, or `unsure`, with a one-line reason. The reply is validated; anything else abstains.
- **The label's action decides the outcome**, so the user's choice, not the model, determines what happens to the message.
- **Two protections apply whatever the model says:** mail from someone the user has written to is never archived or marked spam on the model's word (and "could not check" counts as yes), and `unsure` or an unknown category leaves the message for review.
- **The prompt marks the email as untrusted** and keeps it apart from the guidelines and the header facts. The worst an injected email can do is get itself given the wrong label, which the audit log can undo.
- **Learning:** after three consecutive model decisions give a sender the same label, and each ended the way that label says, sift writes a rule for the sender and later mail from them is decided without inference. A rule the user made for that sender is left alone. (Next: propose the rule to the user instead of saving it; see TODO.md.)

Models are reached through pi-ai (`src/model/`, the only module that imports it). `sift login <provider>` signs in, including with a ChatGPT subscription, and stores the credential in `model-auth.json`. The `model` setting in `sift.toml` turns the tier on; without it, mail no rule covers is left for review. pi-durable is not used: a triage run is one call, and the message queue in SQLite already gives retry and decide-once.

There is no shell and no filesystem here. A sandboxed agent with those is planned only for a possible operator-facing assistant that does open-ended analysis.

## Home directory

Everything sift keeps is in one directory, the home: `~/.config/sift` by default (`$XDG_CONFIG_HOME/sift`), or wherever `--home` or `SIFT_HOME` points (the Docker image uses `/data`). Keeping settings, guidance, the database and credentials together means it can be backed up or moved as a unit. No setting requires an environment variable.

- `sift.toml`: settings (`model`, `act`, `interval`, `dashboard.port`, `dashboard.host`). Parsed strictly: an unknown key or wrong type is an error. Command-line flags override it for one run.
- `guidelines.md`: the user's broad guidance, read on every pass.
- `sift.db`: everything structured or learned.
- `google-client.json`, `google/`, `model-auth.json`, `device-id`, `dashboard-key`: credentials and the session secret, owner-only, kept out of the database.
- `setup.json`: how far `sift init` has got, so it resumes.

`sift init` (`src/cli/init.ts`) sets all of this up. Each step checks the real state first, so running it again only asks about what is missing, and every step can be skipped.

## Teaching

sift suggests first and acts second. While it only observes, every decision is a suggestion, and the dashboard's Suggestions view is where the user teaches it.

- **A suggestion** is the current decision for a message, made while observing, that the user has not answered. Decisions that only repeat what the user already said (a rule they wrote, or made by correcting sift) are not suggestions; ones from a rule sift learned are.
- **Suggestions are grouped by sender**, label and what sift would do, so one answer settles a sender: "Right", or "No, it is…" with another label. The answer becomes a rule for that sender; what then happens is the label's action.
- **An answer is durable.** It writes a sender record (`source` `user` or `correction`), so that sender's later mail is decided by the sender tier, with no model and no further suggestion. It overrides anything sift learned by itself.
- **Every answer is scored.** `feedback` records right, wrong, or "answered" (sift had no suggestion, which is not a mistake), per decision, so accuracy can be reported per tier.
- **An answer says how far it reaches:** everything from the sender, anyone at the sender's domain, the sender when the subject contains some words, or only the mail waiting now. All but the last make a rule with those conditions.
- **Any decision can be answered, not only a suggestion.** Every list opens a message in the same panel: its text where held, what sift decided and why, what it knows about the sender, and the answer. Answering a message sift had already decided records the user's answer as a new decision for it, makes the rule, and, if sift had changed the message in Gmail, takes that change back so the new decision is carried out from where the message started.
- **Every marked message becomes an example.** The answer creates an `examples` row; the next pass of `sift run` fetches the whole message (raw RFC 822, all headers, readable text) into it. These are the evaluation and training set. A message that has since been deleted keeps its answer and is marked gone.
- **Gmail teaches too.** Each sync reads what the user did to messages sift has decided (`learnFromGmail`, `src/learn/gmail.ts`), and records it as the "only this one" answer is recorded, marked `via = gmail` in `feedback`:
  - Where the message is now, read fresh, is the outcome the user wants. A move does not say what the mail is, so the label sift gave stands (and counts as right) and the outcome is recorded as the exception; a different `sift/…` label put on it is a correction of the label.
  - The new decision is recorded in observe mode whatever sift is doing, so sift does not then move a message the user has just placed.
  - While observing, the user doing in Gmail what sift suggested counts as agreeing.
  - Skipped: mail sift could not place and the user did not label (there is no label to record), trashed or deleted mail, and mail sift never recorded.
  - The same history read twice records nothing new: an answer is only recorded when the message's place and label differ from its current decision and from the answer already on it.
  - Not seen: anything done while the history cursor was expired.

Code: `src/learn/feedback.ts` (suggestions, answers, accuracy), `src/learn/gmail.ts` (telling the user's changes from sift's, answers from Gmail), `src/daemon/examples.ts` (capture).

## State

One SQLite database, `sift.db` in the home directory (schema in `src/store/migrations/`). It is the complete record of what sift saw and did, and everything else (the dashboard, undo, future analytics) reads from it.

- **messages:** one row per message sift has seen: sender, recipients, subject, the triage headers and the labels at sync time. No body. This is enough to triage a message again without refetching it. `read_at` is set the first time history shows the user taking `UNREAD` off (sift marking it read does not count); history has no times, so it is the time of the sync that noticed.
- **feedback, examples:** the user's answers to suggestions, and the full content of each message they answered for, kept as evaluation and training data.
- **suggestion_bodies:** the readable text of mail still waiting on the user, so a suggestion can be judged by reading it. Held only for mail sift would move or could not place, and deleted when the message is answered or stops being a suggestion, and after 30 days regardless (`src/daemon/bodies.ts`). These two tables are the only places message content is stored.
- **decisions:** an append-only log, each with its mode (observe or act) and outcome. Every triage outcome is recorded, including "keep" and "could not decide", with the tier that made it, the reason, the confidence, and what it cost (model, tokens, dollars, duration). A message can have several decisions; the latest is current.
- **actions:** the audit log of every mailbox change, with labels before and after, linked to the decision it carried out. Creating and removing a Gmail filter is logged here too, with no message.
- **labels, rules, questions, accounts:** what mail can be, what sift knows without a model, questions waiting on the user, and each account's history cursor and last sync time.

OAuth tokens are kept in files beside the database, not in it. pi-durable keeps its own database alongside.

### Dashboard

The dashboard is where the user watches sift, teaches it and manages it. `sift run` serves it (a JSON API in `src/dashboard/` and the static web app built from `web/`) from the same process that sorts mail; `sift dashboard` serves it alone.

**Who may use it**

- **Someone signed in with Google as a connected account.** One sign-in does both jobs: it gives sift its access to the account (the Gmail scopes and a refresh token) and it proves the viewer owns that account. There is no separate login and no terminal step. The page's static files are public; every `/api/` route needs the session.
- **The first sign-in connects the first account.** After that, a sign-in must be for a connected account. Someone already signed in can connect another (Settings).
- **Sessions** are a signed cookie (HMAC with a per-install secret in `dashboard-key`), HttpOnly, SameSite=Lax, 30 days, and stop working if the account is removed.
- **Google's constraint.** It returns a browser only to `localhost` or an HTTPS address on a real domain. So the dashboard is used at `http://localhost:8787`, or over Tailscale at `https://<machine>.<tailnet>.ts.net` (`tailscale serve` proxies to localhost and passes the original scheme in a header, which is believed only from this machine). At a plain hostname or address the page says where to go. The Google client must be a "Web application" one listing `<origin>/auth/callback` for each address. A Desktop client left from an older setup is refused, and `sift init` replaces it.
- **Host and origin checks.** It answers only to names and addresses that are this machine (blocking DNS rebinding), and every write must come from the dashboard's own page: its Origin, a JSON content type and a custom header.
- **Not tenants.** Everyone signed in sees every connected account. That suits one person with several addresses, not several people.

**What it may do**

Everything that manages sift: answer suggestions, switch between observing and acting, choose the model and interval, edit the guidelines, add and edit labels and what happens to each, add and remove rules, write a rule to Gmail as a filter or take it out, undo a mailbox change, pull in older mail, and trigger a check.

- It changes the database and `sift.toml` directly. A running sift re-reads its settings before every pass, and a change wakes it, so nothing needs restarting.
- It never imports Gmail, the executor or the daemon (lint enforces this). The few things that need them (signing in, undo, Gmail filters, pulling in older mail, check now) are passed in by the process as `SignIn` and `Controls` (`src/dashboard/controls.ts`), so every mailbox change still goes through the executor and the audit log.
- Signing in to a model provider is still done with `sift init`.

**Older mail.** Pulling in the last N days records those messages as suggest-only. They are decided on the next pass and are never acted on, even when sift is acting on new mail.

**The page**

- **Untrusted content.** Subjects and sender names come from email. React renders them as text, and the page is served with a content security policy that allows no inline script, no inline style and nothing from another origin.
- **Stack.** React and Tailwind, with sift's own design system (`web/src/system`, [DESIGN.md](DESIGN.md)). Behaviour that is hard to get right (the select's list, the drawer's focus trap) comes from Base UI's unstyled primitives, wrapped inside the system's parts so no screen imports them; the look is all sift's. Base UI's style injection is turned off in `main.tsx` for the content security policy, with its one rule moved into `index.css`. The chart is drawn by the system itself, so there is no chart library.
- **Look.** See [DESIGN.md](DESIGN.md). Tiers are one ink that thins as cost rises, because they are an ordered cascade.
- **Developing.** `sift dev` runs `sift run` under Node's watch mode beside a watching build of the page. In that mode the server reads the page's files afresh on each request and adds one script of its own, which reloads the page when the build changes or the server restarts. It is not hot module replacement: that would need inline script, and keeping the real content security policy while developing is worth more than keeping component state.
- **Shared types.** `src/dashboard/types.ts` defines the API's JSON and has no imports, so the web app imports it directly.
- **Vercel's UI SDK** (`@ui-sdk/react`, announced 2026-11-12) was evaluated and not adopted yet: it is a 0.1 beta, and it injects a runtime `<style>` by default. It would do the job Base UI does now, supplying behaviour under the system's parts. Because only `web/src/system` imports the primitives, moving to it later changes those few files and no screen.

## Unsubscribing

Gmail has no API for it, so sift makes the request a mail client would: the sender's one-click address (RFC 8058), a single POST. Unsubscribing is an extra a label or a rule carries, like marking read; the default labels for bulk mail have it on. It is never a button. The daemon makes the request after the decision's mailbox change has gone through, only while acting, and never for a sender the user has written to. It is recorded as an action before the request, never repeated for a sender it worked for, and not retried for a week for one it failed for. The address comes from the email, so it is used only if the message passed DMARC, the address is plain HTTPS on the standard port, and it resolves to the public internet; the connection is made to the address that was checked, and a redirect is not followed. Lists that can only be left by sending an email are refused, since sift cannot send. Code: `src/actions/unsubscribe.ts`.

## Open questions

- Using a ChatGPT subscription from a third-party harness is unofficial; whether OpenAI permits it is unconfirmed. An API key works as a fallback.
- The model tier has only run against a scripted test provider.
- Docker egress is not yet restricted to Google and the model providers.
- How questions reach the user beyond `sift review` (a digest would need a send path, which sift does not have).
