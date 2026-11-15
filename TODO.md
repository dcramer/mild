# TODO

The working list for sift. Remove an item when it lands; add what you find. Design and current state are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), the dashboard's parts in [docs/DESIGN.md](docs/DESIGN.md), and what Gmail's API can and cannot do in [docs/GMAIL.md](docs/GMAIL.md).

## Direction

sift is a better Gmail filter and spam filter: models work out what mail is, and what they learn is turned into rules so a model is needed less and less. It suggests first and acts second. By default it only observes: every decision is a suggestion, shown in the dashboard. The user teaches it there until it stops making mistakes, and only then lets it act.

## Next up

In this order.

1. **`sift dev`.** One command for working on sift: the server restarts when its code changes and the page reloads when the page's code does. Today it is `sift run` plus a rebuild and a restart by hand.
2. **One side panel for a message or a decision, with the actions to change it** (under Dashboard).
3. **Unsubscribe and other extras on labels and rules** (under Labels and rules).
4. **Settings designed with intent** (under Dashboard).

## Labels and rules

The model: every message gets a label (what it is); the label carries the outcome (what happens); a rule says what mail is without a model.

Built: labels with defaults and the user's own; outcomes keep, archive, mark spam and block, with "also mark it read"; rules that name a label, with an optional exception to its outcome; answers that choose their scope (sender, domain, sender plus words in the subject, or only the waiting mail); the most specific rule wins; sift writes a rule for a sender after three consistent model answers, and for a sender it blocks; both Gmail labels on mail sift acts on.

- [ ] **Unsubscribe, automatically.** Not a button: an extra a label or a rule can carry, "and unsubscribe, if the sender offers a safe way", so that "mail like this" can mean archive and unsubscribe. The request itself is built and tested (`unsubscribe` in `src/actions`: one-click only, message passed DMARC, public HTTPS address, no redirects, once per sender) but nothing calls it. To do:
  - Store it on labels (an extra, like mark read) and on rules (the `subscription` column is already there), and have the daemon make the request after the mailbox change succeeds, only while acting.
  - Defaults: on for labels that archive bulk mail from companies (Marketing, Cold outreach). Off for Junk and Phishing: answering a scammer's unsubscribe link confirms the address is read.
  - Never for a sender the user has written to, and do not retry a sender whose request failed for a week.
  - Show it: in a suggestion ("would archive and unsubscribe"), in a decision, and in Changes. It cannot be undone, so say that where it is switched on.
- [ ] **More than one action per rule and label.** Today a label has one outcome plus "mark read". Settle the shape as extras are added (unsubscribe, flag, digest) so a rule or label reads as a short list of what happens, and a rule can override any of them.
- [ ] **Per-label trust.** Let sift act on some labels while the rest stay suggestions, with the global switch kept as a kill switch. Each label already shows how often sift has been right about it. This is where "leave it for me" went.
- [ ] **Blocking is the costliest mistake.** A real security notice labelled Phishing gets its sender blocked. Show blocked senders plainly (they are rules sift made) and make unblocking one press.
- [ ] **Batch into a daily digest.** An outcome for a label: take the mail out of the inbox as it arrives, then once a day put one message in the inbox covering what came in, written by a separate agent with its own prompt whose job is to pull out what might matter (a failed build among forty passed ones, a review request among notifications). Service notifications such as GitHub's are the obvious first use. To design: the digest agent and what it may read; when it runs and what an empty day does; how a digest item links back to its message. Inserting the digest works with the access sift already has (`users.messages.insert`), so it needs no permission to send.
- [ ] **Rethink the default labels.** They should be kinds of mail someone would treat differently, and "Newsletters" is too broad a home for bulk mail: automated notifications from a service you use (GitHub, CI, alerts) are not newsletters and want different handling, probably a digest. Go through the defaults against real mail, sharpen each description so the model can tell them apart, and say what each does by default.
- [ ] **Hard rules as Gmail filters.** Where a rule can be written as a Gmail filter (it can match sender, recipient, subject or a search query, and archive, mark read or label; marking spam is not documented), offer to write it there too so it runs when sift is off. Track which rules really exist in Gmail: created by sift, changed or deleted there by the user, or not expressible as a filter at all.
- [ ] **Soft rules: context for the model.** A sender (or domain) plus a condition in plain language, such as "auction notices for lots I did not bid on". It cannot be matched deterministically, so it is handed to the model whenever that sender's mail is judged, narrowing the question to one yes or no. Decide how it is written, how it is shown beside hard rules, what it costs, and when a soft rule that always goes one way becomes a hard one.
- [ ] **Use history with the sender as a signal.** A real case: an investor update sift was not sure about, from someone the user had corresponded with. Today "has the user written to this address" only stops sift hiding mail (and is shown when a suggestion is opened). Record more (how many messages each way, when last, whether this message is in a thread the user took part in, the same for the sender's domain), give it to every tier, and let it decide: mail from someone the user writes to should be kept without asking.
- [ ] **Propose rules instead of saving them.** When sift has given a sender (or domain, or list) the same label several times, show "12 of 12 from this sender were Newsletters. Make it a rule?" among the suggestions. Today it saves the rule silently after three.
- [ ] **Teach from Gmail.** Notice in Gmail's history when the user moves labelled mail back to the inbox or out of spam, or changes its sift label, and treat that as a correction.
- [ ] **Audit rules.** Flag a rule the user contradicts, one that never fires, and one a spot-check by the model disagrees with.
- [ ] More scopes for an answer: this mailing list, this recipient address.
- [ ] Rules with more than one condition and with exceptions, from the dashboard; reorder rules.
- [ ] Remove a label, and say what becomes of its rules and of mail already labelled; reorder labels.
- [ ] Choose which account a rule or label is for when there is more than one (the Rules screen uses the first).
- [ ] Flag a message (star or mark important) as an extra. Forwarding would need permission to send or a verified forwarding address, which sift does not have.

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

- [ ] **One way to open a message or a decision, as a side panel.** Wherever a message is opened (Suggestions, Decisions, Changes, a rule's matches) it should be the same component with the same behaviour, and a panel that slides over from the side, as wide as three quarters of the screen if it needs, not a centred modal. Today Suggestions and the message detail are two different dialogs.
- [ ] **Change a decision from where it is shown.** Inside a decision, offer the actions that correct it: say what the mail really is, for this message or for the future (the same scoped answer as a suggestion), and undo what was done. Today only suggestions can be answered; a decision sift already acted on, or mail it kept, cannot be corrected from the dashboard.
- [ ] **Settings needs designing with intent.** What is there is a list of whatever was built, in the order it was built. Decide what a person comes to Settings to do and order it by that: whether sift is working and acting, which accounts, the model and what it costs, then the rarely touched. Each page should say what changing it will do before it is changed.
- [ ] **Know when the API is unreachable.** On a bad connection the page should say it is offline, keep showing what it last loaded, retry by itself, hold or refuse writes clearly, and never look broken. The page is a plain React app with a small `useLoaded` hook; replace that with a data layer built for this (TanStack Query: caching, retry with backoff, refetch on reconnect, optimistic writes) and add an offline indicator to the masthead.
- [ ] **Sign in to ChatGPT (and other model providers) from the dashboard**, as Gmail already is, so setup in the terminal ends at the Google client. The device-code flow suits a page: show the code and the link, wait, then offer the models.
- [ ] Show an expired Google sign-in where it will be seen: it is in Settings and the `run` log today, not in the masthead or `sift status`. Test users are signed out every 7 days.
- [ ] Labels are cards and everything else is rows. Decide whether labels should be rows too.
- [ ] Narrow screens: Suggestions has a phone layout; Rules, Decisions, Changes and the Overview tables still scroll sideways.
- [ ] Keyboard for Suggestions: move between rows, open, answer.
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

- [ ] **Structured facts about each message.** The reasoning model, rules and filters should all work from the same named facts instead of each re-reading headers. Today sift derives a few from headers and shows them to the model: has an unsubscribe header (and whether it is one-click), mailing list id, marked bulk or auto-generated, passed DMARC, whether the user has written to the sender. Make that a recorded set per message and grow it: sent through a bulk mail service, reply-to differs from sender, sender's domain differs from the links, has attachments, is a reply in a thread the user took part in, addressed to the user directly or by bcc, language, Gmail's own category tab. Then let rules match on them ("has an unsubscribe header and I have never written to them"), show them when a message is opened, and filter lists by them.
- [ ] **Rewrite the default guidelines.** The starting `guidelines.md` is explanatory text, and its examples tell the model to delete things, which sift never does and which is poor steering. Start with a short set of real instructions in the owner's voice that fit the default labels, or start empty and let the Guidelines page explain itself outside the text the model reads.
- [ ] Thread context for the model: earlier messages in the thread and whether the owner took part.
- [ ] Header heuristics as a tier of its own, before any model, for mail that is obviously bulk.
- [ ] Decision model tier (Jev or Clef through pi-ai `classify`) in front of the reasoning model, once there are enough examples to set thresholds. The stage exists and is not wired.
- [ ] Confirm a ChatGPT subscription token refreshes by itself over weeks and survives a restart; try the device-code login inside Docker.
- [ ] Decide whether pi-durable is needed. Triage is one call per message and the SQLite queue already retries and decides once, so it is not used today.

## Setup

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

- [ ] **Encrypt what is sensitive at rest.** Email is sensitive and today everything is plain files with owner-only permissions: subjects, senders and headers in `messages`, message text in `suggestion_bodies` and whole messages in `examples`, reasons in `decisions`, the Gmail refresh tokens, the model credentials, the Google client secret and the session secret. Design first; the open questions:
  - Where the key lives. sift runs unattended and must read mail metadata to work, so a key beside the database only protects a copied database or backup. The alternatives are the OS keyring or a TPM, a passphrase typed at start (no unattended restart), or a key held by the signed-in browser (then nothing sorts while nobody is signed in).
  - What is encrypted: the whole database (SQLCipher or similar; `node:sqlite` has none built in), or only the sensitive columns, which keeps counts and charts queryable but not search over subjects and senders.
  - Whether stored message content gets a stricter key than metadata, readable only while someone is signed in.
  - Per-account keys, so one account's data cannot be read with another's sign-in. This goes with keeping people apart.
  - What a lost key costs, and how backup and key rotation work.
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
