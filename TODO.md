# TODO

The working list for sift. Remove an item when it lands; add what you find. Design and current state are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), the dashboard's parts in [docs/DESIGN.md](docs/DESIGN.md), and what Gmail's API can and cannot do in [docs/GMAIL.md](docs/GMAIL.md).

## Direction

sift is a better Gmail filter and spam filter: models work out what mail is, and what they learn is turned into rules so a model is needed less and less. It suggests first and acts second. By default it only observes: every decision is a suggestion, shown in the dashboard. The user teaches it there until it stops making mistakes, and only then lets it act.

## Next up

In this order.

1. **Settings designed with intent** (under Dashboard).
2. **Figures and a chart above Suggestions** (under Dashboard).
3. **Keyboard shortcuts in the design system** (under Dashboard).

## Labels and rules

The model: every message gets a label (what it is); the label carries the outcome (what happens); a rule says what mail is without a model.

Built: labels with defaults and the user's own; outcomes keep, archive, mark spam and block, with "also mark it read"; rules that name a label, with an optional exception to its outcome; answers that choose their scope (sender, domain, sender plus words in the subject, or only the waiting mail); the most specific rule wins; a rule is `always` (decides by itself) or `usually` (the model reads each message and may say it is something else), and an answer that would hide everything from a sender defaults to `usually`; sift proposes a rule after five consistent model answers, and proposes `always` after ten agreements with a `usually` rule, and writes one itself only for a sender it blocks; both Gmail labels on mail sift acts on.

- [ ] **Standing, the rest.** Built: every sender and every domain (except ones anyone can get an address at) has a standing. Trusted, unwanted and blocked come only from the user's own rule for exactly them; known and new from how much mail there is. Having written to someone makes them known, not trusted. It is given to the model, shown wherever a sender is named, and set in one press on the sender's or domain's page. Still to do: how much of a sender's mail the user opens or leaves unread; standing that is earned (answers that keep agreeing) as well as given; the pages on a phone, where the mail table scrolls sideways; and a list of all senders and domains to browse by standing.
- [ ] **Unsubscribe, the rest.** Built: unsubscribe is an extra, like mark read, that a label or a rule carries; the default labels for bulk mail (Newsletters, Marketing, Cold outreach, Junk) have it on; sift makes the sender's one-click request after the mailbox change succeeds, only while acting, never for someone the user has written to, and leaves a sender alone for a week after a failure. Not yet run against a real list. Still to do: lists that need an email sent or a page opened are skipped, so show their link for the user to open; show on the Labels and Rules screens how many senders each has unsubscribed from; and say plainly, before acting is switched on, that these labels will start unsubscribing.
- [ ] **More extras.** A label or rule now reads as an outcome plus extras (mark read, unsubscribe). Next: flag a message (star or mark important), and digest. Forwarding would need permission to send or a verified forwarding address, which sift does not have.
- [ ] **Per-label trust.** Let sift act on some labels while the rest stay suggestions, with the global switch kept as a kill switch. Each label already shows how often sift has been right about it. This is where "leave it for me" went.
- [ ] **Blocking is the costliest mistake.** A real security notice labelled Phishing gets its sender blocked. Show blocked senders plainly (they are rules sift made) and make unblocking one press.
- [ ] **Batch into a daily digest.** An outcome for a label: take the mail out of the inbox as it arrives, then once a day put one message in the inbox covering what came in, written by a separate agent with its own prompt whose job is to pull out what might matter (a failed build among forty passed ones, a review request among notifications). Service notifications such as GitHub's are the obvious first use. To design: the digest agent and what it may read; when it runs and what an empty day does; how a digest item links back to its message. Inserting the digest works with the access sift already has (`users.messages.insert`), so it needs no permission to send.
- [ ] **Rethink the default labels.** They should be kinds of mail someone would treat differently, and "Newsletters" is too broad a home for bulk mail: automated notifications from a service you use (GitHub, CI, alerts) are not newsletters and want different handling, probably a digest. Go through the defaults against real mail, sharpen each description so the model can tell them apart, and say what each does by default.
- [ ] **Hard rules as Gmail filters.** Where a rule can be written as a Gmail filter (it can match sender, recipient, subject or a search query, and archive, mark read or label; marking spam is not documented), offer to write it there too so it runs when sift is off. Track which rules really exist in Gmail: created by sift, changed or deleted there by the user, or not expressible as a filter at all.
- [ ] **Soft rules, the rest.** Built: a rule can carry a condition in the user's words, which the model applies. Still to decide: what it costs to show, and proposing a hard rule when a soft one always goes the same way.
- [ ] **Teach from Gmail.** Notice in Gmail's history when the user moves labelled mail back to the inbox or out of spam, or changes its sift label, and treat that as a correction.
- [ ] **Audit rules.** Flag a rule the user contradicts, one that never fires, and one a spot-check by the model disagrees with.
- [ ] More scopes for an answer: this mailing list, this recipient address.
- [ ] Rules with more than one condition and with exceptions, from the dashboard; reorder rules.
- [ ] Remove a label, and say what becomes of its rules and of mail already labelled; reorder labels.
- [ ] Choose which account a rule or label is for when there is more than one (the Rules screen uses the first).

## Beyond triage

- [ ] **Manage the inbox from sift.** With message text, sender facts and actions already here, sift is most of the way to being where mail is dealt with, not only where it is sorted: read, archive, reply-later, search, bulk actions by sender or label. Decide whether that is the direction, and what the first step would be (probably an inbox view of what sift kept, with the same row and panel as Suggestions). Replying would need permission to send.

## Teaching loop

Built: Suggestions as one row per sender with a one-press answer; opening a row shows the mail, what sift knows about the sender, and an answer with a scope; accuracy from answers; answered messages stored whole as examples. In use on real mail in observe mode.

- [ ] Use examples to test sift: replay the model over `examples` and report accuracy per label, how often it answers "unsure", and cost per message (`evals/`), so a change to the prompt, model or labels can be checked before it ships.
- [ ] Use examples to teach the model: pick relevant ones as few-shot examples in the prompt.
- [ ] **Learn from mistakes, by proposing.** A regular review pass (once a day, away from triage) over what the user corrected: where the model keeps getting the same kind of mail wrong, it proposes a change (a rule for the sender, a condition on an existing rule, a line for the guidelines, a sharper label description) and the user accepts or dismisses it. Nothing changes by itself. Proposals already exist for "this sender is always X"; this widens what can be proposed and adds a model that reads the corrections to write them.
- [ ] Re-decide waiting suggestions when a label's outcome, a rule or the guidelines change.
- [ ] Accuracy per tier on the Overview.
- [ ] Let a Chrome extension call the API: it cannot use the page's cookie or Origin, so it needs its own token, issued to a signed-in user.
- [ ] Decide how long examples are kept and add a way to delete them; they hold full message content.

## Dashboard

The dashboard manages sift, behind Google sign-in. That sign-in also connects the Gmail account.

- [ ] **Page headers with intent.** The top of each page reads as filler: on Suggestions the title repeats the nav item beside it, the count appears twice (in the nav and in a badge), and two lines of explanation sit under it every visit. Decide what the top of a page is for (what needs the reader now, and the one thing they can do about it), make it one part in the design system, and move explanation to where it is needed (the empty state, the first visit). Do it together with the figures below.
- [ ] **Figures above Suggestions.** Suggestions is the home page. Between the header and the list, show a few quick data points (how much was decided without a model, how often sift was right, what is waiting, cost) and a small chart of decisions over time, so the page says how sift is doing before it asks for anything.
- [ ] **The message panel, the rest.** Built: one side panel opened from every list, with the message, what sift decided, the sender, and an answer that confirms or changes the decision for this message or for the future; a correction also takes back what sift did to that message in Gmail; answering moves to the next row. Still to do: the text of mail sift already acted on or kept is not held, so those open without it; correcting one message does not go back and fix the sender's other mail sift already moved; the panel has no address of its own to link to.
- [ ] **Settings needs designing with intent.** What is there is a list of whatever was built, in the order it was built. Decide what a person comes to Settings to do and order it by that: whether sift is working and acting, which accounts, the model and what it costs, then the rarely touched. Each page should say what changing it will do before it is changed.
- [ ] **A working PWA.** Installable on a phone and a desktop: a manifest, icons, a service worker that serves the shell, and sensible behaviour offline (this goes with knowing when the API is unreachable). Check each against the content security policy. Later, push notifications for mail waiting on the user.
- [ ] **Server-handled routes, then a server-rendered app.** The page is a client-rendered app whose sections are fragments (`#rules`), which the server never sees. First step, in progress: plain paths (`/rules`, `/settings/accounts`, a sender or a message at its own address) that the server answers and the page reads. Then decide how far to take rendering on the server: what it would buy here (a first paint with data in it, pages that work before the script loads, links that can be checked for access on the server), what it costs under the strict content security policy and with mail sealed to a key only the browser holds (the server cannot render what it cannot read), and whether that means a framework or the current server growing a renderer.
- [ ] **A user menu in the header.** The right of the header is three loose things today: when sift last synced, the signed-in address, and Sign out. Replace the address and Sign out with an avatar that opens a menu (who is signed in, Sign out, later switching account). "Synced just now" can stay beside it. It needs a menu part in the design system, and an answer for the phone, where these already live in the full-screen menu.
- [ ] **Know when the API is unreachable.** On a bad connection the page should say it is offline, keep showing what it last loaded, retry by itself, hold or refuse writes clearly, and never look broken. The page is a plain React app with a small `useLoaded` hook; replace that with a data layer built for this (TanStack Query: caching, retry with backoff, refetch on reconnect, optimistic writes) and add an offline indicator to the masthead.
- [ ] **Sign in to ChatGPT (and other model providers) from the dashboard**, as Gmail already is, so setup in the terminal ends at the Google client. The device-code flow suits a page: show the code and the link, wait, then offer the models.
- [ ] Show an expired Google sign-in where it will be seen: it is in Settings and the `run` log today, not in the masthead or `sift status`. Test users are signed out every 7 days.
- [ ] Labels are cards and everything else is rows. Decide whether labels should be rows too.
- [ ] Narrow screens: Suggestions has a phone layout; Rules, Decisions, Changes and the Overview tables still scroll sideways.
- [ ] **Keyboard shortcuts as part of the design system.** Obvious things get the keys people already know (J and K or the arrows for next and previous in the panel and down a list, Enter to open, Escape to close, / to search, the number keys for a label), and each shortcut is shown on the page where it applies, so it is learned by looking. To design before building: one part that both binds a key and draws its hint, so the two cannot drift apart; how the hint looks beside a button, in a row and in a menu without adding clutter; what happens to hints on a touch screen; and a switch in Settings that turns shortcuts and their hints off. The panel has previous and next buttons and the answer has number keys and Enter today, each done by hand.
- [ ] Design system parts still missing: a confirmation for a press that cannot be taken back (removing a rule acts at once), somewhere for "done" that survives the list reloading, a text link, a form layout, and a select for a long list (the model select has no search).
- [ ] Message text is plain and cut at 4,000 characters, as the model sees it. Decide whether reading needs more (longer text, quoted replies folded, links listed).
- [ ] Suggestion bodies are fetched once per waiting message; reuse the text the model tier already fetched instead of asking Gmail twice. `getContent` now returns the text from the model's one read, which makes this straightforward.
- [ ] Per-rule detail: the messages matched, hits over time.
- [ ] Merge Decisions and Changes into one activity view.
- [ ] Keep filters and the open message in the URL so a view can be bookmarked (the section and settings page already are).
- [ ] Keep people apart: today everyone signed in sees every connected account. Scope each session to its own account before more than one person uses an install. Filter every view by account once there is more than one.
- [ ] Remove an account, and its token and data, from the dashboard.
- [ ] Try a second account end to end.
- [ ] The specimen page (`/#system`) is reachable without signing in. It holds no data; decide whether to keep it in the production build.
- [ ] Use Tailscale's identity headers to skip the Google round trip for viewers on the tailnet.
- [ ] Revisit Vercel's UI SDK as the behaviour layer under `web/src/system` once it is past beta and works under the content security policy (evaluated 2026-11-15; see docs/ARCHITECTURE.md).

## Inference tier

Built: one model call per message that names a label; the label's outcome decides what happens. In use with a ChatGPT subscription model in observe mode.

- [ ] **Message facts, the rest.** Built: one named set of facts per message (unsubscribe header and whether one-click, list id, bulk or auto-generated, DMARC, SPF and DKIM, bulk mail service, reply-to differs, addressed to the owner or not, a reply, Gmail's category; and, once a model reads the message, attachments, tracking pixel, tracked links, links off the sender's domain, and whether the owner took part in the thread), recorded with the message, given to the model, and returned with a message's detail. A header-checks tier that uses them sits before the model, off by default (`heuristics` in `sift.toml`), and a reply in a thread the owner wrote in is never hidden on a model's word. Still to do:
  - Show the facts when a message is opened, and filter lists by them (old rows are derived on read, so filtering in SQL needs a backfill).
  - Let rules match on facts: `matchesFacts` exists and is not wired into rules or the rule editor.
  - A control for the header-checks tier in Settings, and measure it against examples before turning it on. It knows only two newsletter platforms.
  - Check the bulk-service list and tracker patterns against real mail; senders with their own DKIM and Return-Path are recognised only by their links.
  - "Reads as AI-generated" and language were left out as judgements, not facts. Mail to a dot-variant or alias of the owner's address is not counted as addressed to them.
- [ ] **Several labels with a confidence each.** Have the model (and the decision model in front of it) score every plausible label instead of naming one, then take the highest if it clears a threshold and ask the user if none does. It gives a real "how sure", shows the runner-up when sift was wrong ("it was nearly Receipts"), lets thresholds differ by what the label does (higher for spam and block), and makes "these two labels are hard to tell apart" measurable. To settle: whether a message still gets exactly one label; what the threshold is and whether it is per label; and how the scores are recorded so they can be tested against examples.
- [ ] Decision model tier (Jev or Clef through pi-ai `classify`) in front of the reasoning model, once there are enough examples to set thresholds. The stage exists and is not wired.
- [ ] Confirm a ChatGPT subscription token refreshes by itself over weeks and survives a restart; try the device-code login inside Docker.
- [ ] Decide whether pi-durable is needed. Triage is one call per message and the SQLite queue already retries and decides once, so it is not used today.

## Setup

- [ ] Remove `sift dashboard` (and `Activity.sorting`, which exists only for it), or add it to the commands AGENTS.md allows.
- [ ] `sift status` does not show the sign-in limit (`dashboard.allow`). An account left off the list is still connected and sorted, with no way to disconnect it short of removing the account.
- [ ] `init` asks about the model and the sign-in list again on every partial re-run while they are unset: it cannot tell "chose none" from "never asked".
- [ ] Find out what publishing the Google app requires (branding fields, verification for these scopes) and make that path of `init` exact. Check its Console links and field names against the live console; they were written from memory.
- [ ] Run `sift init` inside Docker, where the dashboard address is the host's, not the container's.

## Verify against real Gmail

Observe mode has run for real on the owner's inbox: sync, the model, suggestions and answers. Nothing that changes the mailbox has.

- [ ] Let sift act for a day with a handful of rules. Confirm both Gmail labels appear, unread state and other labels are untouched, and undo puts things back.
- [ ] Mark read, mark spam and block on real messages; confirm the spam refusal for people the user has written to.
- [ ] History paging on a busy day, and recovery from an expired cursor.
- [ ] The unsubscribe request against a real list.

## Deployment and isolation

- [ ] **Security policies for hosting it for other people.** Write down, then enforce in code, what makes sift safe to run as a service someone else trusts. This is what the hashing in telemetry, the sealed mail and the encrypted credentials below are parts of. To decide and record in one document (`docs/SECURITY.md`), then hold every change to:
  - **Hold as little as possible.** For each thing stored or sent anywhere (database columns, logs, telemetry, the model provider), say why it is needed, for how long, and in what form (plain, hashed, sealed to the user). Anything without a reason goes.
  - **Tenants cannot see each other.** Every query and every write is scoped to the signed-in account by construction, not by remembering a `WHERE`: one data-access layer that takes the tenant and cannot be called without it, a test that fails when a query is not scoped, and the same for background work. Today every signed-in person sees every connected account.
  - **What the operator can see.** With sealed mail and hashed telemetry, say plainly what someone running the service can and cannot read, and make the claim checkable.
  - Goes with: keeping people apart (Dashboard), sealing stored mail, Sentry, and the one-click deploy.
- [ ] **Seal stored mail to a key only the user holds.** Decided 2026-11-15: message content sift keeps (`suggestion_bodies`, `examples`) is encrypted so the server cannot read it back. The cost is accepted: sift cannot re-analyse stored mail by itself.
  - **How.** The browser makes a key pair when the user sets a passphrase in the dashboard. The server keeps the public key and seals each body to it as it arrives (it has the text at that moment, from Gmail, and never again). The private key stays in the browser, and a copy wrapped with the passphrase is kept on the server so a second device can unlock with the passphrase. Reading a message decrypts in the page.
  - **What it changes.** Search over message text is not possible. Replaying examples through a model (the evals) and using them as few-shot examples need the page to be open and unlocked to hand the text over for that run, or use only what is not sealed (sender, subject, headers, label).
  - **Not covered.** Metadata (sender, subject, headers, reasons) stays readable, because rules and every list need it; whether to seal subjects too is open. A lost passphrase loses the stored text and nothing else.
  - Per-account keys go with keeping people apart.
- [ ] **One-click deploy to Vercel and to Cloudflare**, for people who do not want to run a machine. After model sign-in has moved to the dashboard, so the whole setup can happen in a browser. sift today is one long-running process with a SQLite file and credentials on disk, and neither platform offers that, so this needs:
  - **Storage behind an interface.** The database on a hosted SQLite or Postgres (Cloudflare D1, Turso, Neon) instead of `node:sqlite` on a local file, and tokens and secrets in the platform's secret store instead of files in the home directory.
  - **Passes on a schedule.** A cron trigger per pass instead of a loop, each pass fitting inside the platform's time limit, or Gmail push through Pub/Sub. One pass at a time per account must still hold.
  - **Setup in the browser.** No `sift init`: the Google client, the model sign-in and settings all entered in the dashboard, with the first visitor claiming the install safely.
  - **A public address.** It would no longer sit behind a tailnet, so sign-in is the only gate; review the session and write protections with that in mind, and decide on encryption at rest first.
  - **Runtime differences.** Cloudflare Workers are not Node: check what sift uses (`node:sqlite`, `node:https`, the model library) against each platform.
- [ ] **Sentry, with tracing.** Errors and OpenTelemetry spans for a pass, each message's triage (one span per tier, the model call with tokens and cost), each mailbox change and each dashboard request. Nothing that identifies mail leaves the machine: no message content, subjects, sender names or sender addresses; only the connected account's own address identifies a span. Everything else is referred to by a keyed hash (sender, domain, message id), the same hash everywhere so traces can be joined to each other and looked up locally; decide whether to store the hashes in the database to make that lookup cheap. A scrubber on the way out as a second line of defence, the DSN in `sift.toml`, and off unless set.
- [ ] Restrict the core container's egress to Google and the model providers. The unsubscribe request is the one call to an arbitrary host and needs a relay container of its own first; the plan is in [docs/DEPLOY.md](docs/DEPLOY.md).
- [ ] `migrate` runs an older sift against a newer database without complaint after a downgrade; refuse when the database's version is higher than the newest migration known.
- [ ] Retention (`[retention] days`) is only in `sift.toml`; give it a control in Settings. `pruneOld` in `src/daemon/retention.ts` lists the tables it deletes from, so a new table that references `messages` or `decisions` must be added there or the prune fails.
- [ ] `.env` cannot set `SIFT_HOME`: the home is resolved before `.env` is read. `sift status` says nothing about plain credential files when a key is set.
- [ ] Publish the image (registry, tags, multi-arch). It is 337 MB, most of it Node itself.
- [ ] Optional Pub/Sub push for lower latency, keeping polling as the fallback. It needs a Google Cloud topic, so it is a lot of setup for a self-hosted tool.

Decided 2026-11-15: no shell or filesystem for triage. The model runs in-process in the core container and has no tools at all, so there is no model-written code to sandbox. A sandbox container is deferred until an operator-facing agent exists (one you talk to: "why did you archive that", "clean up my rules"). If one is built:

- [ ] Run it in its own sandbox container with shell and files, no credentials, a read-only snapshot of the database, and no network except a tool channel to the core.
- [ ] Decide how it reaches its model without holding the key: a credential-injecting proxy in the core, or the core making the model calls for it.
