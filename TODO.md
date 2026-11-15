# TODO

The working list for sift. Remove an item when it lands; add what you find. Design and current state are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), the dashboard's parts in [docs/DESIGN.md](docs/DESIGN.md), and what Gmail's API can and cannot do in [docs/GMAIL.md](docs/GMAIL.md).

## Direction

sift is a better Gmail filter and spam filter: models work out what mail is, and what they learn is turned into rules so a model is needed less and less. It suggests first and acts second. By default it only observes: every decision is a suggestion, shown in the dashboard. The user teaches it there until it stops making mistakes, and only then lets it act.

## Next up

In this order.

1. **What a rule means, and what sift knows about a sender** (the first two items under Labels and rules). These decide how far automation can be trusted.
2. **Settings designed with intent** (under Dashboard).
3. **Figures and a chart above Suggestions** (under Dashboard).
4. **Keyboard shortcuts in the design system** (under Dashboard).

## Labels and rules

The model: every message gets a label (what it is); the label carries the outcome (what happens); a rule says what mail is without a model.

Built: labels with defaults and the user's own; outcomes keep, archive, mark spam and block, with "also mark it read"; rules that name a label, with an optional exception to its outcome; answers that choose their scope (sender, domain, sender plus words in the subject, or only the waiting mail); the most specific rule wins; sift writes a rule for a sender after three consistent model answers, and for a sender it blocks; both Gmail labels on mail sift acts on.

- [ ] **What a sender rule means: two tiers of rule.** A big open question. Today "mail from this sender is Marketing" is unconditional: everything from them is archived without being looked at, which is what the auction notices ran into. Often what the user means is narrower: "mail from this sender, when it is marketing, is archived", with everything else from them still judged. Work out the tiers, probably:
  - **Always:** everything matching is this label, never judged. For senders that only ever send one kind of mail, and for blocks.
  - **Usually:** the sender's usual label is a strong prior handed to the model, which still looks at each message and can say "not this one". Cheaper than a cold judgement, and it cannot hide the odd important message.
  - Which one an answer makes by default (probably "usually", promoted to "always" once it has held for long enough), how each is shown so it is clear what a rule will do, and how this fits soft rules below, which are the same idea with the condition written out.
- [ ] **Know the sender.** Keep running facts per sender address and per sender domain (not for shared domains such as gmail.com, where the domain says nothing): when first seen, how much they have sent and how often, how much of it the user opened, replied to or left unread, what labels their mail has had and how consistently, how the user has answered about them, whether the user writes to them. Use them three ways: as evidence for the model and for rules; to decide when a sender is settled enough to propose a rule for; and shown wherever a sender appears. A real case: an investor update sift was not sure about, from someone the user had corresponded with, which this would have settled. Today sift only knows whether the user has ever written to an address.
- [ ] **Unsubscribe, the rest.** Built: unsubscribe is an extra, like mark read, that a label or a rule carries; the default labels for bulk mail (Newsletters, Marketing, Cold outreach, Junk) have it on; sift makes the sender's one-click request after the mailbox change succeeds, only while acting, never for someone the user has written to, and leaves a sender alone for a week after a failure. Not yet run against a real list. Still to do: lists that need an email sent or a page opened are skipped, so show their link for the user to open; show on the Labels and Rules screens how many senders each has unsubscribed from; and say plainly, before acting is switched on, that these labels will start unsubscribing.
- [ ] **More extras.** A label or rule now reads as an outcome plus extras (mark read, unsubscribe). Next: flag a message (star or mark important), and digest. Forwarding would need permission to send or a verified forwarding address, which sift does not have.
- [ ] **Per-label trust.** Let sift act on some labels while the rest stay suggestions, with the global switch kept as a kill switch. Each label already shows how often sift has been right about it. This is where "leave it for me" went.
- [ ] **Blocking is the costliest mistake.** A real security notice labelled Phishing gets its sender blocked. Show blocked senders plainly (they are rules sift made) and make unblocking one press.
- [ ] **Batch into a daily digest.** An outcome for a label: take the mail out of the inbox as it arrives, then once a day put one message in the inbox covering what came in, written by a separate agent with its own prompt whose job is to pull out what might matter (a failed build among forty passed ones, a review request among notifications). Service notifications such as GitHub's are the obvious first use. To design: the digest agent and what it may read; when it runs and what an empty day does; how a digest item links back to its message. Inserting the digest works with the access sift already has (`users.messages.insert`), so it needs no permission to send.
- [ ] **Rethink the default labels.** They should be kinds of mail someone would treat differently, and "Newsletters" is too broad a home for bulk mail: automated notifications from a service you use (GitHub, CI, alerts) are not newsletters and want different handling, probably a digest. Go through the defaults against real mail, sharpen each description so the model can tell them apart, and say what each does by default.
- [ ] **Hard rules as Gmail filters.** Where a rule can be written as a Gmail filter (it can match sender, recipient, subject or a search query, and archive, mark read or label; marking spam is not documented), offer to write it there too so it runs when sift is off. Track which rules really exist in Gmail: created by sift, changed or deleted there by the user, or not expressible as a filter at all.
- [ ] **Soft rules: context for the model.** A sender (or domain) plus a condition in plain language, such as "auction notices for lots I did not bid on". It cannot be matched deterministically, so it is handed to the model whenever that sender's mail is judged, narrowing the question to one yes or no. Decide how it is written, how it is shown beside hard rules, what it costs, and when a soft rule that always goes one way becomes a hard one.
- [ ] **Propose rules instead of saving them.** When sift has given a sender (or domain, or list) the same label several times, show "12 of 12 from this sender were Newsletters. Make it a rule?" among the suggestions. Today it saves the rule silently after three.
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
- [ ] Turn repeated corrections into a suggested guideline or rule, shown to the user before it is saved.
- [ ] Re-decide waiting suggestions when a label's outcome, a rule or the guidelines change.
- [ ] Accuracy per tier on the Overview.
- [ ] Let a Chrome extension call the API: it cannot use the page's cookie or Origin, so it needs its own token, issued to a signed-in user.
- [ ] Decide how long examples are kept and add a way to delete them; they hold full message content.

## Dashboard

The dashboard manages sift, behind Google sign-in. That sign-in also connects the Gmail account.

- [ ] **Sender and domain pages.** A page per sender and a similar one per domain, reached from one shared part that draws a sender wherever one appears (with a small popover of the essentials before the click). Each should answer what this project needs: what they send and how consistently, what sift does with it and why (the rules that apply), how often the user agreed, and the controls to change that in one place.
- [ ] **Page headers with intent.** The top of each page reads as filler: on Suggestions the title repeats the nav item beside it, the count appears twice (in the nav and in a badge), and two lines of explanation sit under it every visit. Decide what the top of a page is for (what needs the reader now, and the one thing they can do about it), make it one part in the design system, and move explanation to where it is needed (the empty state, the first visit). Do it together with the figures below.
- [ ] **Figures above Suggestions.** Suggestions is the home page. Between the header and the list, show a few quick data points (how much was decided without a model, how often sift was right, what is waiting, cost) and a small chart of decisions over time, so the page says how sift is doing before it asks for anything.
- [ ] **The message panel, the rest.** Built: one side panel opened from every list, with the message, what sift decided, the sender, and an answer that confirms or changes the decision for this message or for the future; a correction also takes back what sift did to that message in Gmail; answering moves to the next row. Still to do: the text of mail sift already acted on or kept is not held, so those open without it; correcting one message does not go back and fix the sender's other mail sift already moved; the panel has no address of its own to link to.
- [ ] **Settings needs designing with intent.** What is there is a list of whatever was built, in the order it was built. Decide what a person comes to Settings to do and order it by that: whether sift is working and acting, which accounts, the model and what it costs, then the rarely touched. Each page should say what changing it will do before it is changed.
- [ ] **A working PWA.** Installable on a phone and a desktop: a manifest, icons, a service worker that serves the shell, and sensible behaviour offline (this goes with knowing when the API is unreachable). Check each against the content security policy. Later, push notifications for mail waiting on the user.
- [ ] **Real addresses instead of hash links.** The page is a client-rendered app whose sections are fragments (`#rules`). Consider plain paths (`/rules`, `/settings/accounts`, a message at its own address): the server would serve the page for those paths and the page would read the path. Server-rendering the pages is a separate, larger question; decide whether anything needs it.
- [ ] **A user menu in the header.** The right of the header is three loose things today: when sift last synced, the signed-in address, and Sign out. Replace the address and Sign out with an avatar that opens a menu (who is signed in, Sign out, later switching account). "Synced just now" can stay beside it. It needs a menu part in the design system, and an answer for the phone, where these already live in the full-screen menu.
- [ ] **Know when the API is unreachable.** On a bad connection the page should say it is offline, keep showing what it last loaded, retry by itself, hold or refuse writes clearly, and never look broken. The page is a plain React app with a small `useLoaded` hook; replace that with a data layer built for this (TanStack Query: caching, retry with backoff, refetch on reconnect, optimistic writes) and add an offline indicator to the masthead.
- [ ] **Sign in to ChatGPT (and other model providers) from the dashboard**, as Gmail already is, so setup in the terminal ends at the Google client. The device-code flow suits a page: show the code and the link, wait, then offer the models.
- [ ] Show an expired Google sign-in where it will be seen: it is in Settings and the `run` log today, not in the masthead or `sift status`. Test users are signed out every 7 days.
- [ ] Labels are cards and everything else is rows. Decide whether labels should be rows too.
- [ ] Narrow screens: Suggestions has a phone layout; Rules, Decisions, Changes and the Overview tables still scroll sideways.
- [ ] **Keyboard shortcuts as part of the design system.** Obvious things get the keys people already know (J and K or the arrows for next and previous in the panel and down a list, Enter to open, Escape to close, / to search, the number keys for a label), and each shortcut is shown on the page where it applies, so it is learned by looking. To design before building: one part that both binds a key and draws its hint, so the two cannot drift apart; how the hint looks beside a button, in a row and in a menu without adding clutter; what happens to hints on a touch screen; and a switch in Settings that turns shortcuts and their hints off. The panel has previous and next buttons and the answer has number keys and Enter today, each done by hand.
- [ ] Design system parts still missing: a confirmation for a press that cannot be taken back (removing a rule acts at once), somewhere for "done" that survives the list reloading, a text link, a form layout, and a select for a long list (the model select has no search).
- [ ] Message text is plain and cut at 4,000 characters, as the model sees it. Decide whether reading needs more (longer text, quoted replies folded, links listed).
- [ ] Suggestion bodies are fetched once per waiting message; reuse the text the model tier already fetched instead of asking Gmail twice.
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

- [ ] **Structured facts about each message.** The reasoning model, rules and filters should all work from the same named facts instead of each re-reading headers. Today sift derives a few from headers and shows them to the model: has an unsubscribe header (and whether it is one-click), mailing list id, marked bulk or auto-generated, passed DMARC, whether the user has written to the sender. Make that a recorded set per message and grow it: sent through a bulk mail service, reply-to differs from sender, sender's domain differs from the links, has attachments, is a reply in a thread the user took part in, addressed to the user directly or by bcc, language, Gmail's own category tab, and whether the text reads as AI-generated (work out what can be checked honestly: this is a judgement with a confidence, not a fact, and cheap heuristics will be wrong often). Then let rules match on them ("has an unsubscribe header and I have never written to them"), show them when a message is opened, and filter lists by them.
- [ ] **Tracking pixels and tracking links as a signal.** A 1×1 remote image, or links that all pass through a click-tracking redirect, mark mail as sent by a campaign tool even when the headers do not say so. Detect both from the HTML body (sift reads only the text part today), record them among the structured facts, and show them when a message is opened.
- [ ] **Rewrite the default guidelines.** The starting `guidelines.md` is explanatory text, and its examples tell the model to delete things, which sift never does and which is poor steering. Start with a short set of real instructions in the owner's voice that fit the default labels, or start empty and let the Guidelines page explain itself outside the text the model reads.
- [ ] **Several labels with a confidence each.** Have the model (and the decision model in front of it) score every plausible label instead of naming one, then take the highest if it clears a threshold and ask the user if none does. It gives a real "how sure", shows the runner-up when sift was wrong ("it was nearly Receipts"), lets thresholds differ by what the label does (higher for spam and block), and makes "these two labels are hard to tell apart" measurable. To settle: whether a message still gets exactly one label; what the threshold is and whether it is per label; and how the scores are recorded so they can be tested against examples.
- [ ] Thread context for the model: earlier messages in the thread and whether the owner took part.
- [ ] Header heuristics as a tier of its own, before any model, for mail that is obviously bulk.
- [ ] Decision model tier (Jev or Clef through pi-ai `classify`) in front of the reasoning model, once there are enough examples to set thresholds. The stage exists and is not wired.
- [ ] Confirm a ChatGPT subscription token refreshes by itself over weeks and survives a restart; try the device-code login inside Docker.
- [ ] Decide whether pi-durable is needed. Triage is one call per message and the SQLite queue already retries and decides once, so it is not used today.

## Setup

- [ ] **Limit who can sign in.** An optional list of addresses in `sift.toml` that are allowed to sign in, offered as a step in `sift init`. Today the first Google account to sign in connects itself, and after that only connected accounts can; that is fine on a tailnet and matters much more if the dashboard is ever reachable from the internet.
- [ ] **A clean README.** Say plainly what sift is for, then the onboarding, which is install and `sift init`. Move everything else (the CLI reference, Docker detail, how the dashboard is built) out to docs/.
- [ ] **Recommend a default model.** When the provider is OpenAI or ChatGPT, preselect the newest version of the Luna family from the list the provider returns (highest version number whose name matches), if there is one, instead of making the user pick from the whole list. Do the same for other providers' small, cheap families.
- [ ] Let `init` change a step that is already done (switch model) instead of only filling gaps.
- [ ] Find out what publishing the Google app requires (branding fields, verification for these scopes) and make that path of `init` exact. Check its Console links and field names against the live console; they were written from memory.
- [ ] Run `sift init` inside Docker, where the dashboard address is the host's, not the container's.
- [ ] Trim the CLI to what the rule in AGENTS.md says it is for (init, run, status, dev). `sync`, `apply`, `undo`, `log`, `rules`, `labels`, `login` and `models` date from before the dashboard could do those things.

## Verify against real Gmail

Observe mode has run for real on the owner's inbox: sync, the model, suggestions and answers. Nothing that changes the mailbox has.

- [ ] Let sift act for a day with a handful of rules. Confirm both Gmail labels appear, unread state and other labels are untouched, and undo puts things back.
- [ ] Mark read, mark spam and block on real messages; confirm the spam refusal for people the user has written to.
- [ ] History paging on a busy day, and recovery from an expired cursor.
- [ ] The unsubscribe request against a real list.

## Deployment and isolation

- [ ] **Encrypt credentials and tokens with a key from the environment.** The Gmail refresh tokens, model credentials, Google client secret and session secret are plain files today. Encrypt them with a key the operator supplies, which means:
  - **The key comes from the environment**, so sift needs `.env` support (read from the home directory or the working directory). This is a deliberate exception to "no setting may require an environment variable": a key stored beside what it protects protects nothing. Without a key sift should still run, unencrypted, and say so.
  - **Rotation, thought through before building.** Probably: every encrypted value records which key encrypted it; sift accepts a current key and any number of old ones; values are re-encrypted with the current key as they are next written, plus a command to re-encrypt everything so an old key can be retired; and a wrong or missing key fails loudly at start, not as a sign-in that mysteriously stops working.
  - What a lost key costs (signing in to Google and the model provider again) and how that is explained.
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
- [ ] Retention: prune old message rows and decisions on a configurable schedule.
- [ ] Register only the model providers sift supports instead of `pi-ai/providers/all`, which pulls in the AWS and Google SDKs and makes up most of the image's dependencies.
- [ ] Keep the core image light: measure it and trim it (base image, production dependencies only).
- [ ] Restrict the core container's egress to Google and the model providers. The unsubscribe request is the one call to an arbitrary host and needs its own path.
- [ ] Publish the image (registry, tags, multi-arch) and document upgrade and backup of the data volume.
- [ ] Optional Pub/Sub push for lower latency, keeping polling as the fallback. It needs a Google Cloud topic, so it is a lot of setup for a self-hosted tool.
- [ ] The `questions` table predates suggestions and nothing writes to it. Remove it, or use it for things only the user can answer.

Decided 2026-11-15: no shell or filesystem for triage. The model runs in-process in the core container and has no tools at all, so there is no model-written code to sandbox. A sandbox container is deferred until an operator-facing agent exists (one you talk to: "why did you archive that", "clean up my rules"). If one is built:

- [ ] Run it in its own sandbox container with shell and files, no credentials, a read-only snapshot of the database, and no network except a tool channel to the core.
- [ ] Decide how it reaches its model without holding the key: a credential-injecting proxy in the core, or the core making the model calls for it.
