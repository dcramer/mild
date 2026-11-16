# Architecture

sift polls Gmail for new inbox mail and decides, per message, a **disposition** (`keep`, `archive`, `spam`, or `review`) and independently a **subscription action** (`preserve` or `unsubscribe`). It is designed so that most mail never reaches a language model.

## Labels, rules and the cascade

Two things are decided about every message, and they are kept apart.

- **What it is: a label.** Each account has one list of labels (`labels`), seeded with cautious defaults and added to by the user. A label has a name, a description the model reads, a Gmail label, and an action.
- **What happens** is the user's to say, never a model's. Usually it is the label's action, one of keep, archive, mark spam, or block; a rule can name an action itself. Beside the outcome a label can carry extras: mark read (with keep and archive) and unsubscribe. A rule can add either for the mail it decides. "Leave it for me" is not an action: sift suggesting instead of acting is a matter of trust, and the only time mail is held for the user is when no tier could place it or a protection stopped sift.
- **Block** is sift's own, since Gmail's block list is not in its API ([GMAIL.md](GMAIL.md)): the message is marked spam, and once that has happened a rule is written so the sender's later mail is that label without a model. Only when the message passed DMARC, so an impersonated sender is not the one blocked, and never for someone the user has written to. A rule may carry the user's own exception to its label's action ("this one is a newsletter, but keep it").

A label's id and Gmail label never change after it is made, so renaming one orphans nothing. An account has at most twelve labels (`MAX_LABELS`): each is a choice the model weighs on every message and the user answers with, so a long list makes both worse.

Tiers run cheapest first. A tier either names a label or abstains; the first answer wins.

| Tier | Where | Cost | Status |
| --- | --- | --- | --- |
| 1. Gmail filters | Gmail itself; runs even when sift is down | none | built: a rule is copied there when the user asks ([Rules as Gmail filters](#rules-as-gmail-filters)) |
| 2. Rules | `src/triage/stages/rules.ts` | none | built and wired |
| 3. Header heuristics | `src/triage/stages/heuristics.ts` | none (one search of sent mail per new sender) | built and wired; off unless `heuristics = true` |
| 4. Decision model (Jev / Clef via pi-ai `classify`) | `src/triage/stages/classifier.ts` | ~$0.0001 per message | stage built, provider not wired |
| 5. Model | `src/triage/stages/model.ts`, `src/model/` | one model call | built; in use while observing, with a ChatGPT subscription model |
| Fallback | `src/triage/pipeline.ts` | none | built |

Every message is meant to be one of the labels. When the model cannot tell which (its "unsure"), or its call fails, the answer is `review`: the message stays where it is, gets the review label, and the user is asked which label it is, or adds one. With no model connected, mail no rule covers is not decided at all: it stays in the triage queue (newest first, so it never holds up new mail) and is neither a suggestion nor changed, until a model is connected or a rule comes to cover it.

**A rule** is conditions, then a label, an action, or both. There are three kinds, and a sender or domain can have one of the first two and any number of the third:

- **Conditions → action** ("from this notifications address: archive"). No model. sift does not say what the mail is unless that costs nothing: another rule that matches names a label. A sender's standing (trusted, unwanted, blocked) is this kind of rule.
- **Conditions → label**, optionally with its own action in place of the label's. No model.
- **Conditions, when it is label L → action.** It cannot apply until a tier has said what the mail is, so when it is the best match the rules tier steps aside for the tiers that name labels, and `settle` applies it to their decision: the tier's label stands, the rule says what happens. Mail from there that turns out to be something else falls to the sender's rule for all their mail if there is one, and otherwise is as the tier said. With no action of its own it confirms the label's as the user's wish, which is what answering "right" for a sender makes when the label would hide their mail.

A rule can also carry a condition in the user's own words, which only a model can apply; it needs a label for the model to answer with. Rules come from the user (`user`), from the user correcting a suggestion (`correction`), or from sift itself (`agent`), only when it blocks a sender. Otherwise sift proposes: a rule for a sender whose last five messages a model gave the same label, and dropping the "when it is L" from a rule once ten messages in a row were L.

**The heuristics tier** labels mail that is plainly bulk from its facts alone. Every sign has to agree: a mailing list id, a one-click unsubscribe, a recognised bulk mail service, a DMARC pass, not a reply, not marked auto-generated, and the owner known never to have written to the sender ("could not check" abstains). It names only two labels, and only when it can tell them apart: Marketing when Gmail filed the message under Promotions, Newsletters when it came through a newsletter platform and Gmail did not file it under Promotions or Primary. Everything else, notifications included, goes on to the model. Its decisions are suggestions like any other, and three of them do not make a learned rule.

Rules that matter across tiers:

- A rule that keeps all the mail it matches is a protection and beats any other rule. Otherwise the most specific rule wins (more conditions, then an exact sender over a domain, then a rule that waits for a label over one that does not), so "this sender when the subject contains X" beats "this sender" whichever was written first.
- A rule sift made itself (it does so only when it blocks a sender) never hides mail from someone the user has written to; the user's own rules do what they say.
- A rule whose label has been removed does nothing.
- Mail an action rule decides may carry no label at all: decisions, lists and Gmail (which then gets only the mark of what sift did) all allow for that.
- Spam has a higher confidence bar than archive.
- Errors abstain. Nothing fails toward a mutation.

## Message facts

Every tier, the prompt and the dashboard read one named set of facts about a message (`Facts`, `src/triage/facts.ts`) instead of each re-reading headers.

- **From headers and labels, at sync:** unsubscribe header and whether it is one-click, mailing list id, marked bulk, marked auto-generated, the DMARC, SPF and DKIM results, the bulk mail service it went through (from who signed it, its envelope sender and the services' own headers), whether replies go elsewhere, whether the owner is in To, in Cc or in neither, whether it is a reply, and Gmail's category tab.
- **From the whole message, when a model is about to judge it:** whether it has attachments and, from the HTML part (`src/triage/html.ts`), whether it carries a tracking pixel (a remote image drawn 1×1 or hidden), how many sites it links to, whether most links pass through a click-tracking redirect, and whether any link goes to the sender's own domain. These mark campaign mail even when the headers do not. The HTML is read and dropped, never stored, and nothing in it is fetched. Mail decided by a rule is never read whole, so it has none of these.
- **From the thread, for a reply a model is about to judge:** how many messages came before it and whether the owner sent one of them (`users.threads.get`, labels only: a message the owner sent carries `SENT`). No other message's content is read or stored.
- **Recorded** as JSON in `messages.facts_json`, rewritten when the whole message or its thread adds to them, and returned with a message's detail.
- **Rules can match on them** once wired: `matchesFacts` takes conditions on facts ("has an unsubscribe header and is not a reply"). `RuleMatch` does not carry them yet.
- **Only what can be checked.** Whether mail reads as AI-generated, and its language, are judgements for a model, not facts.

## Learning loop

Decisions flow back down so the same mail is cheaper next time.

1. sift proposes a rule when the same thing keeps happening for a sender (a model's decisions agreeing, or the user's answers), and the user accepts or dismisses it. It writes one by itself only when it blocks a sender.
2. A rule that Gmail can express is copied to a Gmail filter when the user asks for it. sift does not promote one by itself.
3. Corrections are detected from Gmail history: the user moving a message back to the inbox or out of spam, archiving or marking as spam what sift kept, or changing its `sift/…` label, is their answer for that one message ([Teaching](#teaching)). It never makes or changes a rule by itself.

## Layout

```
src/
  cli/        main.ts parses and dispatches; commands/ has one module per command (init, run, status, dev, dashboard)
  config.ts   data directory and paths
  secrets.ts  encrypts the credential files with a key from the environment
  store/      the only module that opens a database: Postgres or PGlite (db.ts), the per-person handle (sql.ts) and its hold on each query (own.ts), what queries are written with (query.ts), the Drizzle schema and its migrations, queries
  triage/     pure pipeline: types, header features, stages
  actions/    the only mutation path: executor, undo, decision-to-action planning, Mailbox port, filter validation
  gmail/      the only module that holds the Google token: OAuth, API adapter, history sync
  dashboard/  the server for the built web app and its JSON API: api/ (one module per resource), queries/ (what they read), scope.ts (whose data a request may see)
  daemon/     orchestration: sync pass, triage pass, and the `sift run` loop
  learn/      what the user teaches: suggestions and answers, and answers read from what they did in Gmail
  model/      the only module that talks to model providers (pi-ai): login, credentials, the classifier call
web/          the dashboard page: React, Tailwind, its own design system on Base UI; builds to web/dist
tests/        synthetic fixtures only
docker/       Dockerfile and compose file; upgrade, backup and restore are in docs/DEPLOY.md
```


Boundaries are enforced by lint; see [AGENTS.md](../AGENTS.md).

## Gmail

- **Scopes:** `gmail.modify` and `gmail.settings.basic` (`src/gmail/scopes.ts`). Both are restricted scopes, so each user brings their own Google Cloud project with a Web application OAuth client; sign-in is the authorisation-code flow with PKCE, started from the dashboard. Left in "Testing", Google limits sign-in to listed test users and ends it every 7 days.
- **Tokens:** each mailbox's refresh token is kept in its person's own database (`credentials`), encrypted when a key is set and bound to that person and mailbox ([SECRETS.md](SECRETS.md)). Only `src/gmail/` uses it; the process that starts sift reads it and hands it over.
- **First connect:** sift records the current history id and handles mail from then on. It never sweeps the existing inbox unasked.
- **Sync is separate from triage:** a sync pass records message metadata and advances the cursor in one transaction; triage will work from recorded messages that have no decision yet. A failed fetch leaves the cursor in place.
- **Change detection:** poll `users.history.list` from the stored `historyId` (2 quota units per call, against 6,000 per user per minute). A 404 means the cursor expired: read the new cursor, then search the last 7 days of the inbox. History also carries every label change, sift's own included and with no word on who made it, so `userChanges` (`src/learn/gmail.ts`) cancels each change in sift's `actions` log since the previous sync began against one matching entry; what is left is the user's. Label changes made while the cursor was expired are lost. Pub/Sub push is a possible opt-in; it still needs the polling fallback.
- **Reads:** `format=metadata` with named headers for triage. The body is fetched only for the agent tier.
- **Archive** is per message. Gmail shows a thread in the inbox while any message in it has `INBOX`, so a thread stays visible until each message sift was given has been handled; sift does not act on sibling messages it did not triage.
- **Filters:** at most 1,000 per account, one user label each, no update (delete then create), and they act on new mail only. `validateFilter` rejects forwarding, trash, spam and mark-read actions and criteria with no positive match. See [Rules as Gmail filters](#rules-as-gmail-filters).
- **Unsubscribe:** RFC 8058 one-click only (an https `List-Unsubscribe` target plus `List-Unsubscribe-Post`), and only when DKIM passes. Never a GET, never a link from the body, never `mailto:`. It is the one request sift makes to an arbitrary host, so it runs in a deterministic executor; the agent can request it but never sees the URL.

## The run loop

`sift run` is the one long-running process: it serves the dashboard and repeats one pass per account: settle unconfirmed actions, sync, then triage every recorded message that has no decision.

- **Observe is the default.** Decisions are recorded with `mode = observe` and the mailbox is not touched. `--act` carries them out. Observed decisions are never acted on later. The one exception is the user's own answer from the dashboard: it is recorded as an `act` decision marked `by_user` and carried out on the next pass whether or not sift is acting, since the user pressed it. Nothing else is carried out while observing, not even a decision left over from when sift was acting.
- **Decide, record, then act.** The decision row is written before any mailbox change. Its `outcome` then records what happened: `none` (nothing needed doing), `done`, `skipped` with the reason (left the inbox, spam refused), `failed` or `unknown`.
- **Nothing is dropped.** If the change cannot even be attempted (a provider error), the decision stays unsettled and the next pass retries it. A pass decides each message once; a waiting suggestion gets a further decision only when a rule, a label or (on request) the guidelines change (see Teaching).
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

Everything a person prefers is in their own database.

- **Their model and guidelines** (`preferences`, `src/store/preferences.ts`): which model judges their mail, and their broad guidance in their own words ("recruiters count as cold outreach", "anything from my accountant is personal"), read on every pass and given to the model. Guidelines start as a few instructions that fit the default labels and lean towards keeping mail in the inbox (`DEFAULT_GUIDELINES`). Both are set under Settings.
- **What is structured or learned:**
  - `labels`: what mail can be and what to do with each. Seeded with cautious defaults (nothing is marked spam); changed and added to in the dashboard, under Labels.
  - `rules`: what the user has said happens to mail, or what it is; and a rule for each sender sift blocked.
  - `correspondents`: whether the user has ever written to an address, cached.

## Model tier

When no rule decides a message, one model call does. It is deliberately not an agent.

- **The model has no tools and takes no action.** Deterministic code gathers the evidence first: the message's facts, the body (fetched on demand, truncated, never stored), how much mail this sender has sent, what was done with it, and whether the user has ever written to them.
- **Its only output is a label** from the user's list, or `unsure`, with a one-line reason. The reply is validated; anything else abstains.
- **The label's action decides the outcome**, so the user's choice, not the model, determines what happens to the message.
- **Three protections apply whatever the model says:** mail from someone the user has written to is never archived or marked spam on the model's word (and "could not check" counts as yes), nor is a reply in a thread the user has written in, and `unsure` or an unknown category leaves the message for review.
- **It is shown a few of the user's own answers.** Beside each message go up to six stored examples, chosen for it: from the same sender first, then the same domain, then the newest of each label, within a budget of about 1,200 tokens (`src/triage/fewshot.ts`). Each is only sender, subject, the first 300 characters and the owner's label, fenced as untrusted like the email itself, with every field JSON on one line so an example's text cannot close its fence or forge a label. `examples.few_shot = false` in `sift.toml` turns it off.
- **The prompt marks the email as untrusted** and keeps it apart from the guidelines and the header facts. The worst an injected email can do is get itself given the wrong label, which the audit log can undo.
- **Learning:** after five model decisions in a row give a sender the same label, and each ended the way that label says, sift proposes a rule for the sender (`src/store/proposals.ts`); nothing changes until the user accepts it. A sender who already has a rule is left alone.

Models are reached through pi-ai (`src/model/`, the only module that imports it). **Each person signs in and chooses their own,** under Settings, so their mail is judged on their account and at their cost; a pass builds each person's tier from their database (`openModelTier`, `src/cli/controls.ts`). Without a model, mail no rule covers waits, undecided, for one. The ways in (`MODEL_CHOICES`) are ChatGPT, signed in by device code (the page shows a code to enter at OpenAI, and nothing has to come back to this server, so it works wherever sift runs), and an API key for OpenAI, Anthropic, OpenRouter or Vercel AI Gateway. The two resellers list hundreds of models; only the major labs' small ones are offered (`offerModel`). One provider is in use at a time. Changing it signs in to the new one beside the old, chooses its model, and only then signs out of the old, so something sorts throughout. Until a model is in use and signed in, every screen of the dashboard is those steps, on the sheet sign-in uses (`ModelWall`, `web/src/components/model-wall.tsx`): the first time, followed for the owner by pulling in recent mail to answer; when the model in use is lost (its sign-in removed or expired), under "No model connected". Without one there is nothing to suggest, and the screens would only show it. Sign-ins are kept in the person's database, through a port (`SignIns`, `src/model/credentials.ts`) so `src/model/` never touches the store. Keys in the environment are never used: they would speak for everyone. Adding a provider means adding it in `openModels` and to `MODEL_CHOICES`. pi-ai depends on every provider's SDK; the ones sift cannot call (AWS, Google) are removed from the install by `overrides` in `pnpm-workspace.yaml`, so a new provider may also need its SDK put back there. pi-durable is not used: a triage run is one call, and the message queue in SQLite already gives retry and decide-once.

There is no shell and no filesystem here. A sandboxed agent with those is planned only for a possible operator-facing assistant that does open-ended analysis.

## The command line

Four commands: `init` sets sift up, `run` sorts mail and serves the dashboard, `status` says what is set up, and `dev` is `run` for working on sift. `dashboard` serves the dashboard without sorting. Everything else (rules, labels, the log of changes, undo, choosing a model) is in the dashboard and has no command; `sync`, `apply`, `undo`, `log`, `rules`, `labels`, `login` and `models` were removed on 2026-11-15. Options are in [CLI.md](CLI.md).

## Home directory

Everything sift keeps is in one directory, the home: `~/.config/sift` by default (`$XDG_CONFIG_HOME/sift`), or wherever `--home` or `SIFT_HOME` points (the Docker image uses `/data`). Keeping settings, guidance, the database and credentials together means it can be backed up or moved as a unit. No setting requires an environment variable, with one exception: the key that encrypts the credentials.

- `sift.toml`: settings (`act`, `heuristics`, `interval`, `dashboard.port`, `dashboard.host`, `dashboard.allow`, `retention.days`, `examples.few_shot`, `examples.keep_days`). Parsed strictly: an unknown key or wrong type is an error. Command-line flags override it for one run.
- `database/`, `database.lock`: the database, when it is PGlite (see State).
- `google-client.json`, `dashboard-key`: the install's Google client and the session secret, owner-only. People's sign-ins are in their databases.
- `device-id`: names this installation to a subscription sign-in. Not a secret.
- `.env`: optional. Read at start, before the one in the working directory; neither replaces a variable already set.

**Credentials are encrypted with a key from the environment** (`SIFT_KEY`), because a key stored beside them would protect nothing. See [SECRETS.md](SECRETS.md).

- Every one is encrypted and decrypted through `src/secrets.ts`, which knows ciphertext and nothing about what is inside. Each is bound to what it is for (a file's name; a row's person, kind and key), so it cannot be moved into another's place.
- Each value records the id of the key that encrypted it. `SIFT_OLD_KEYS` are accepted for reading; a value is re-encrypted with the current key whenever it is written, and `sift run` re-encrypts all of them at start, in files and in every person's database, and encrypts any still plain, so an old key can be retired.
- A credential whose key is missing stops `run`, `dashboard` and `status` at start, naming it. The alternative is a sign-in that stops working for no visible reason.
- Without a key sift runs as before, storing them plain, and says so at start.
- The rest of the databases is not encrypted; see TODO.md.
- `setup.json`: how far `sift init` has got, so it resumes.

`sift init` (`src/cli/init.ts`) sets all of this up. A first run walks through every step, and one stopped part-way carries on with what is missing. Once the dashboard has an address and the Google client is finished, it instead lists the steps with what each is set to and redoes the one the user picks. The key and the sign-in list are optional, so leaving them unset does not bring the walk-through back. The model is not here: each person signs in to their own in the dashboard.

## Teaching

sift suggests first and acts second. While it only observes, every decision is a suggestion, and the dashboard's Suggestions view is where the user teaches it.

- **A suggestion** is the current decision for a message, made while observing, that the user has not answered. Decisions that only repeat what the user already said (a rule they wrote, or made by correcting sift) are not suggestions; ones from a rule sift learned are.
- **Suggestions are listed one per message**, newest first. The answer is a dropdown that starts on the label sift gave, with a meter for how sure it is (a rule is sure; a model gives a number), and a check that commits it. The dropdown lists what else it might be first: the labels the sender's other mail has had, most first, then every other label. The model gives one label today, so the sender's history stands in for its runners-up.
- **An answer says what one message is, and that is all it says.** Like a spam button with more outcomes: sift records the label, does what that label does to the message in Gmail (see Observe is the default), and keeps the message as an example the model is shown next time. It makes no rule. When the sender has other mail waiting that sift guessed the same way, the dashboard offers the same answer for those in one press.
- **Every answer is scored.** `feedback` records right, wrong, or "answered" (sift had no suggestion, which is not a mistake), per decision. The summary the home page reads reports it for the window per tier and per label, with which labels sift took for which.
- **Rules come from proposals and the Rules page, not from answers.** After three answers in a row giving a sender's mail the same label, sift proposes a rule for that sender (`proposeFromAnswers`), as it already does after five model decisions that agree. The panel's "Make a rule…" opens the rule dialog on that sender. The answer endpoint still takes the wider scopes (`label`, `sender`, `domain`, `subject`), which make rules; the dashboard sends only `once`.
- **Any decision can be answered, not only a suggestion.** Every list opens a message in the same panel: sift's label as the answer to agree with, what else it might be, its reason, the message, and what sift knows about the sender. Answering a message sift had already decided records the user's answer as a new decision for it and, if sift had changed the message in Gmail, takes that change back so the new decision is carried out from where the message started.
- **A waiting suggestion follows the rules and labels as they are now.** When a rule or a label changes in the dashboard, each waiting suggestion is run through the rules again, with no model (`src/learn/redecide.ts`), and a new decision is recorded where the answer differs: a rule of the user's now decides it, so it stops being a suggestion; its label now does something else, so the same label is recorded with the new outcome (and mail is never newly hidden from a sender who was not checked); or the rule that had decided it is gone, so it goes back to what a tier said before, or to review. Mail the user answered for is never touched, and mail a rule decided when it arrived stays as history.
- **A change to the guidelines does not run the model.** It would cost a call per waiting message. The dashboard is told how many waiting suggestions were judged before the person's guidelines last changed, and judges them again, a hundred at a time in the background, only when the user asks (`src/daemon/rejudge.ts`). Nothing is learned from a second judgement of the same message.
- **Every marked message becomes an example.** The answer creates an `examples` row; the next pass of `sift run` fetches the whole message (raw RFC 822, all headers, readable text) into it. These are the evaluation and training set. A message that has since been deleted keeps its answer and is marked gone.
- **Gmail teaches too.** Each sync reads what the user did to messages sift has decided (`learnFromGmail`, `src/learn/gmail.ts`), and records it as the "only this one" answer is recorded, marked `via = gmail` in `feedback`:
  - Where the message is now, read fresh, is the outcome the user wants. A move does not say what the mail is, so the label sift gave stands (and counts as right) and the outcome is recorded as the exception; a different `sift/…` label put on it is a correction of the label.
  - The new decision is recorded in observe mode whatever sift is doing, so sift does not then move a message the user has just placed.
  - While observing, the user doing in Gmail what sift suggested counts as agreeing.
  - Skipped: mail sift could not place and the user did not label (there is no label to record), trashed or deleted mail, and mail sift never recorded.
  - The same history read twice records nothing new: an answer is only recorded when the message's place and label differ from its current decision and from the answer already on it.
  - Not seen: anything done while the history cursor was expired.

- **Examples are kept until the user deletes them**, one at a time or all of an account's, or for `examples.keep_days` days after the answer if that is set; `sift run` deletes the ones past it when it starts and once a day. Deleting an example removes the stored message only: the answer stays in `feedback`, and any rule it made stays a rule.
- **Examples test the model.** A test run replays the model over an account's stored examples and scores it against the user's answers: right, wrong, "unsure" and failed calls overall and per label, which labels were taken for which, and cost and tokens per message. It is started from the dashboard and never by sift itself, because every example is a paid model call; a run takes at most 200 examples, newest answers first, four calls at a time, in the background. Each example is judged on what is stored (the recorded headers, the example's text, the sender's history as it stood before the message's first decision), so Gmail is not asked and the user's later answer does not leak in. A run records what it ran with (model, a hash each of the prompt layout, the guidelines and the labels, and whether examples were shown) and one row per example, so two runs can be compared example by example. With examples shown, the one under test is left out of its own prompt; answers that still had another example from the same sender are counted apart, since they are easier than new mail.

Code: `src/learn/feedback.ts` (suggestions, answers, accuracy), `src/learn/gmail.ts` (telling the user's changes from sift's, answers from Gmail), `src/daemon/examples.ts` (capture), `src/learn/evals.ts` and `src/triage/score.ts` (test runs).

## State

One Postgres database for everyone (decided 2026-11-15, after a database per person in SQLite): Postgres is the one engine Vercel, Cloudflare and a local install all have. Locally it is PGlite, Postgres compiled to WebAssembly and run inside sift, keeping its data in `database/` in the home directory; given a Postgres server's address (`DATABASE_URL`, or `database.url` in `sift.toml`), sift uses that instead.

- **Schema and migrations.** The schema is `src/store/schema.ts` (Drizzle). `pnpm db:generate` writes each change as a migration in `src/store/migrations/`, which sift applies when it opens the database (Drizzle's migrator); what Drizzle cannot say (grants, `FORCE ROW LEVEL SECURITY`) is a custom migration made the same way (`drizzle-kit generate --custom`). A test fails when the schema has a change no migration covers. A database last opened by a newer sift is refused. Drizzle orders migrations by when they were made, so when two branches each add one, generate again on the merged branch rather than keep both.
- **Who sees what.** `users` and `accounts` say who the people are and which mailboxes are whose. Every other table holds one person's data: it carries `user_id`, filled in from the transaction's `sift.user` setting, and has row-level security, forced even for the tables' owner, that shows and accepts only that person's rows. Foreign keys include `user_id`, so no row can point at another person's. Every query runs in a transaction that first becomes `sift_app`, a role that owns nothing and cannot bypass the policies (`handle`, `src/store/sql.ts`): the central handle sees no one's rows, `store.user(id)` only that person's, `store.nobody` nothing. That is the second line. The first is sift's own code: the handle's query builder (`src/store/own.ts`) adds `user_id = <person>` to every select, join, update and delete of a person's table, puts the person's id on every row inserted, refuses a `user_id` from the caller and a right or full join, and the central handle refuses a person's table outright. Tests check every such table has the policy, that one person cannot read or write another's rows, and that the builder holds them apart with row-level security out of the way (`tests/own.test.ts`). Locally PGlite runs as a superuser, so a statement that resets the role would escape the policies; sift sends only what its builder makes. With a server, connect as a role that is not a superuser. See [SECURITY.md](SECURITY.md).
- **One process.** PGlite is one process's alone and does not check that itself, so sift holds `database.lock` (its process id) and refuses the folder to another process while it is alive; `sift status` then says sift is running. A lock left by a process that has gone is taken over.
- **Queries** are built with Drizzle's builder on the `Sql` handle, from the tables, operators and `sql` in `src/store/query.ts`; nothing outside `src/store/` imports Drizzle, and no SQL text names a table (`sql` refuses one interpolated, and a test reads `src/` for one written). `sql` is for expressions the builder lacks (`count(*) FILTER`, `coalesce`), with columns interpolated. A transaction is one call taking a function that awaits nothing but the database, since it holds the connection; using an outer handle inside it is refused rather than left to wait on itself. A failed statement reports the database's error, never the values bound to it, which can be a message's text.

Defaults (the starting labels, a person's preferences) are written by code when first needed, never by a migration. Together the tables are the complete record of what sift saw and did, and everything else (the dashboard, undo, future analytics) reads from them.

- **messages:** one row per message sift has seen: sender, recipients, subject, the triage headers, the labels at sync time and the facts derived from them. No body. This is enough to triage a message again without refetching it.
- **feedback, examples:** the user's answers to suggestions, and the full content of each message they answered for, kept as evaluation and training data until deleted (see Teaching).
- **suggestion_bodies:** the readable text of mail still waiting on the user, so a suggestion can be judged by reading it: its start is shown under the subject in the Suggestions list, read from here and not stored again. Held only for mail sift would move or could not place, and deleted when the message is answered or stops being a suggestion, and after 30 days regardless (`src/daemon/bodies.ts`). These two tables are the only places message content is stored.
- **decisions:** an append-only log, each with its mode (observe or act) and outcome. Every triage outcome is recorded, including "keep" and "could not decide" (a model unsure, or failing), but not mail no tier looked at for want of a model, which stays queued, with the tier that made it, the reason, the confidence, and what it cost (model, tokens, dollars, duration). A message can have several decisions; the latest is current.
- **actions:** the audit log of every mailbox change, with labels before and after, linked to the decision it carried out. Creating and removing a Gmail filter is logged here too, with no message.
- **eval_runs, eval_results:** each test run of the model over the examples, with its settings, and what the model said for each example. Labels and costs only, no message content.
- **labels, rules, mailboxes:** what mail can be, what sift knows without a model, and each mailbox's history cursor and last sync time.

**Retention.** Everything is kept unless `retention.days` is set in `sift.toml` (30 at least, so sync's 7-day recovery search cannot bring back a message already forgotten). Then `sift run` deletes, on its first pass and once a day, each message that nothing has happened to for that long, with its decisions and actions (`src/daemon/retention.ts`). What it costs: a change older than the window can no longer be undone from sift, and the model is told less about how much a sender has sent. Kept however old:

- a suggestion still waiting on the user, and a message not yet decided;
- anything the user answered for (`feedback`, `examples`), and so the accuracy figures;
- a decision not yet carried out, and a change never confirmed;
- the record of an unsubscribe, which is how sift knows not to ask that sender again;
- rules, labels and correspondents, which are not per message.

Postgres reuses the freed space; the files do not shrink.

OAuth tokens are kept in files beside the database, not in it. pi-durable keeps its own database alongside.

### Dashboard

The dashboard is where the user watches sift, teaches it and manages it. `sift run` serves it (a JSON API in `src/dashboard/` and the static web app built from `web/`) from the same process that sorts mail; `sift dashboard` serves it alone.

**Who may use it**

- **Someone signed in with Google as a connected account.** One sign-in does both jobs: it gives sift its access to the account (the Gmail scopes and a refresh token) and it proves the viewer owns that account. There is no separate login and no terminal step. The page's static files are public; every `/api/` route needs the session. So are `/terms` and `/privacy` (`web/src/views/legal.tsx`), which Google reads before it lets anyone outside the test list sign in; the sign-in screen links to both. They speak for whoever runs the install, and what they say sift reads, keeps and sends must stay true when that changes.
- **Users and their mailboxes.** A user is a person; an account is one of their mailboxes, an identity they signed in with (`users`, `accounts.user_id`). The first sign-in makes the first user, who owns the install. Someone signed in can connect another mailbox (Settings), which becomes theirs. An account never changes hands.
- **Each person sees only their own.** A request is given the database of whoever is signed in, whichever of their mailboxes they signed in as, and no other. The dashboard is handed `People` (`src/store/people.ts`), not the store: it finds a person by the address of their session, and opens a database only through that person's `open(id)`, which refuses any id they may not read (today, any but their own). A view of all of a person's mailboxes, such as their suggestions, is one query, since their mailboxes share their database; one that merged several people's would open each through `ctx.open`; its scope is their mailboxes (`src/dashboard/scope.ts`). Every query also takes the scope and filters by it, and `?mailbox=` on any read narrows it to one of them. Every write says whose data it touches and is refused, as if the thing were not there, when that is someone else's; a row named by id is looked for only in the requester's database, so another person's gets the answer one that never existed would. What applies to the whole install (acting or observing, the interval, pulling in older mail) only the owner may change; a person's model, its sign-in and their guidelines are their own (`touches: 'self'`). With no sign-in set up (tests, tools) the request is the owner's.
- **An allow list is who the install is for.** When `dashboard.allow` in `sift.toml` lists addresses (a step in `sift init`), no other Google account can sign in, the first included, and a session ends when its address is taken off the list. It is read on every request. A listed address sift does not know may sign in by itself, and is then a person of their own. Without a list only the first account, and mailboxes added by someone signed in, can ever sign in. The list limits the dashboard only: an account left off it stays connected and its mail is still sorted.
- **Sessions** are a signed cookie (HMAC with a per-install secret in `dashboard-key`), HttpOnly, SameSite=Lax, 30 days, and stop working if the account is removed.
- **Google's constraint.** It returns a browser only to `localhost` or an HTTPS address on a real domain. So the dashboard is used at `http://localhost:8787`, or over Tailscale at `https://<machine>.<tailnet>.ts.net` (`tailscale serve` proxies to localhost and passes the original scheme in a header, which is believed only from this machine). At a plain hostname or address the page says where to go. The Google client must be a "Web application" one listing `<origin>/auth/callback` for each address. A Desktop client left from an older setup is refused, and `sift init` replaces it.
- **Host and origin checks.** It answers only to names and addresses that are this machine (blocking DNS rebinding), and every write must come from the dashboard's own page: its Origin, a JSON content type and a custom header.

**What it may do**

Everything that manages sift: answer suggestions, switch between observing and acting, choose the model and interval, edit the guidelines, add and edit labels and what happens to each, add and remove rules, write a rule to Gmail as a filter or take it out, undo a mailbox change, try a failed change again (the decision's outcome is cleared and the next pass acts on it, `POST /api/decisions/retry`), pull in older mail, and trigger a check.

- It changes the database and `sift.toml` directly. A running sift re-reads its settings before every pass, and a change wakes it, so nothing needs restarting.
- It never imports Gmail, the executor or the daemon (lint enforces this). The few things that need them (signing in, undo, Gmail filters, pulling in older mail, check now, a test run of the model, judging suggestions again) are passed in by the process as `SignIn` and `Controls` (`src/dashboard/controls.ts`), so every mailbox change still goes through the executor and the audit log.

**Older mail.** Pulling in the last N days records those messages as suggest-only. They are decided on the next pass and are never acted on, even when sift is acting on new mail.

**The page**

- **Untrusted content.** Subjects and sender names come from email. React renders them as text, and the page is served with a content security policy that allows no inline script, no inline style and nothing from another origin.
- **Stack.** React and Tailwind, with sift's own design system (`web/src/system`, [DESIGN.md](DESIGN.md)). Behaviour that is hard to get right (the select's list, the drawer's focus trap) comes from Base UI's unstyled primitives, wrapped inside the system's parts so no screen imports them; the look is all sift's. Base UI's style injection is turned off in `main.tsx` for the content security policy, with its one rule moved into `index.css`. The chart is drawn by the system itself, so there is no chart library.
- **Data.** `web/src/lib/api.ts` is the only file that talks to `/api/`. Reads go through TanStack Query: cached in memory only (mail data is never written to the browser's storage), refreshed on an interval, on returning to the tab and after any change made from the page. A request that gets no answer marks sift unreachable: the masthead says so, every query pauses with what it last loaded, and the page asks again until something answers, then refreshes. While unreachable a change is refused where it was made, never queued, so nothing happens later that the user did not see.
- **Addresses.** Sections are paths (`/rules`, `/settings/accounts`). The server answers any path that names no file with the one page, which reads the path and moves between sections with the History API (`web/src/lib/route.ts`); nothing is rendered on the server. Search text, filters and the open message are in the query, so a view can be bookmarked and Back closes the message panel. Typing and stepping through a list rewrite the current history entry; only opening a message adds one. Links from when sections were fragments (`/#rules`) are rewritten on load.
- **Code.** The page is client-rendered. Libraries are built into files of their own (`react`, `vendor`) so a new build of sift leaves them cached; the home page comes with the app, and every other screen is its own file, fetched when first needed and ahead of need once the page is idle. Server rendering was tried on a branch (React Router 8, 2026-11-15) and declined: see TODO.md.
- **Installed.** The page has a web manifest and a service worker, so it can be installed on a phone or a desktop. The worker (`web/src/sw.js`, written to `/sw.js` by the build with the list of files to keep) keeps only the page's own files: the document, its script and style, and fonts. It never handles `/api/`, `/auth/` or `/dev/`, so no mail data is ever kept in the browser. A navigation goes to the server first and falls back to the kept page, which then finds sift unreachable and says so. The policy allows the manifest and the worker from this server only (`manifest-src`, `worker-src`). Both are served without a session, like the rest of the page's files. The page does not register the worker under `sift dev`, and removes one left by `sift run` at the same address. A service worker needs a secure context: `localhost` or the HTTPS address, not a plain-HTTP LAN name.
- **Look.** See [DESIGN.md](DESIGN.md). Tiers are one ink that thins as cost rises, because they are an ordered cascade.
- **Developing.** `sift dev` runs `sift run` under Node's watch mode beside a watching build of the page. In that mode the server reads the page's files afresh on each request and adds one script of its own, which reloads the page when the build changes or the server restarts. It is not hot module replacement: that would need inline script, and keeping the real content security policy while developing is worth more than keeping component state.
- **Layout.** `server.ts` is what applies to every request: the Host check, the session, the scope, the checks on writes, and the page's files. Each route is in `api/`, one module per resource, as a `Read` or a `Write` that declares its path and, for a write, whose data it touches. What they read from the database is in `queries/`, laid out the same way.
- **Shared types.** `src/dashboard/types.ts` defines the API's JSON and has no imports, so the web app imports it directly.
- **Vercel's UI SDK** (`@ui-sdk/react`, announced 2026-11-12) was evaluated and not adopted yet: it is a 0.1 beta, and it injects a runtime `<style>` by default. It would do the job Base UI does now, supplying behaviour under the system's parts. Because only `web/src/system` imports the primitives, moving to it later changes those few files and no screen.

## Unsubscribing

Gmail has no API for it, so sift makes the request a mail client would: the sender's one-click address (RFC 8058), a single POST. Unsubscribing is an extra a label or a rule carries, like marking read; the default labels for bulk mail have it on. It is never a button. The daemon makes the request after the decision's mailbox change has gone through, only while acting, and never for a sender the user has written to. It is recorded as an action before the request, never repeated for a sender it worked for, and not retried for a week for one it failed for. The address comes from the email, so it is used only if the message passed DMARC, the address is plain HTTPS on the standard port, and it resolves to the public internet; the connection is made to the address that was checked, and a redirect is not followed. Lists that can only be left by sending an email are refused, since sift cannot send. Code: `src/actions/unsubscribe.ts`.

## Open questions

- Using a ChatGPT subscription from a third-party harness is unofficial; whether OpenAI permits it is unconfirmed. An API key works as a fallback.
- The model tier has run on real mail only while observing; nothing it decided has been carried out in Gmail yet.
- Docker egress is not yet restricted to Google and the model providers. [DEPLOY.md](DEPLOY.md) says what it would take; unsubscribing needs a relay of its own first.
- How suggestions reach the user beyond the dashboard (a digest would need a send path, which sift does not have).
