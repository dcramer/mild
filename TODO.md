# TODO

The working list for sift. Remove an item when it lands; add what you find. Design and current state are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Direction

sift suggests first and acts second. By default it only observes: every decision is a suggestion, shown in the dashboard. The user teaches it there (right, wrong, do this instead) until it stops making mistakes, and only then lets it act. The dashboard is where that happens; a Chrome extension that talks to it comes later.

## Labels and rules

The model: every message gets a label (what it is); the label carries the action (what happens); a rule says what mail is without a model. Built: labels with defaults and the user's own, rules that name a label with an optional exception, senders folded into rules, both Gmail labels on mail sift acts on, a Labels screen. Next, in order:

- [ ] **Outcomes, the rest.** Built: a label does one of keep, archive, mark spam or block, with "also mark it read" on keep and archive; block marks the message spam and makes a rule for the sender. Still to do:
  - Blocking is the costliest mistake: a real security notice labelled Phishing gets its sender blocked. Show blocked senders plainly (they are rules made by sift) and make unblocking one press.
  - Per-label trust: let sift act on some labels while others stay suggestions. This is where "leave it for me" went.
  - Flag a message (star or mark important) as an extra; forward it. Forwarding needs permission to send or a verified forwarding address, which sift does not have.
  - Unsubscribe as an extra on a label, automatically, once the manual button has been used enough to trust.
- [ ] **Unsubscribe, the rest.** Built: a button on a message that makes the sender's one-click request, with safeguards (docs/ARCHITECTURE.md). Not tried against a real list. Lists that need an email sent or a page opened are refused; decide whether to show their link for the user to open themselves.
- [ ] **Batch into a daily digest.** An outcome for a label: take the mail out of the inbox as it arrives, then once a day send one message covering what came in, written by a separate agent with its own prompt whose job is to pull out what might matter (a failed build among forty passed ones, a review request among notifications). Service notifications such as GitHub's are the obvious first use. To design: the digest agent and what it may read; when it runs and what an empty day does; how a digest item links back to its message; and how the digest arrives. Inserting it into the mailbox works with the access sift already has (`users.messages.insert`, see docs/GMAIL.md), so it needs no permission to send.
- [ ] **Rethink the default labels.** They should be kinds of mail someone would treat differently, and "Newsletters" is too broad a home for bulk mail: automated notifications from a service you use (GitHub, CI, alerts) are not newsletters and want different handling, probably a digest. Go through the defaults against real mail, sharpen each description so the model can tell them apart, and say what each does by default.
- [ ] **Two kinds of rule.** Built: hard rules (conditions on sender, domain, list, recipient, subject), and an answer that chooses its scope (sender, domain, sender plus words in the subject, or only the waiting mail). Still to do:
  - **Hard rules as Gmail filters.** Where a rule can be written as a Gmail filter (docs/GMAIL.md says what one can match and do: archive, mark read and label, but not provably mark spam), write it there too, and track which rules really exist in Gmail (created, changed or deleted there by the user, or not expressible as a filter at all).
  - **Soft rules: context for the model.** A sender (or domain) plus a condition in plain language, such as "auction notices for lots I did not bid on". It cannot be matched deterministically, so it is handed to the model whenever that sender's mail is judged, narrowing the question to one yes or no. Decide how it is written, shown beside hard rules, what it costs, and when a soft rule that always goes one way is turned into a hard one.
  - More scopes for an answer: this mailing list, this recipient address.
- [ ] **Use history with the sender as a signal.** A real case: an investor update sift was not sure about, from someone the user had corresponded with. Today "has the user written to this address" only stops sift hiding mail (and is shown when a suggestion is opened). Record more (how many messages each way, when last, whether this message is in a thread the user took part in, the same for the sender's domain), give it to every tier, and let it decide: mail from someone the user writes to should be kept without asking.
- [ ] **Propose rules instead of saving them.** When sift has given a sender (or domain, or list) the same label several times, show "12 of 12 from this sender were Newsletters. Make it a rule?" in the review queue. Today it saves the rule silently after three.
- [ ] **One review queue.** Suggestions, mail sift was not sure about, proposed rules and rules the user later contradicted, in one place.
- [ ] **Teach from Gmail.** Notice when the user moves labelled mail back to the inbox, or changes its sift label in Gmail, and treat that as a correction.
- [ ] **Promote stable rules to Gmail filters**, where a filter can express them. Check what filters can do (they may not be able to mark spam).
- [ ] **Audit rules.** Flag a rule the user contradicts, one that never fires, and one a spot-check by the model disagrees with.
- [ ] More per label than where the mail goes: mark as read, unsubscribe.
- [ ] Rules with more than one condition and with exceptions, from the dashboard; reorder rules.
- [ ] Merge Decisions and Changes into one activity view.
- [ ] Choose which account a rule or label is for when there is more than one (the Rules screen uses the first).

## Teaching loop

Built: the Suggestions view, answers by sender ("Right" or "No, it is <label>") that make a rule for the sender, accuracy from answers, and marked messages stored whole as examples. Tried in a browser on synthetic data only.

- [ ] Use it on real mail and see what is awkward.
- [ ] Answer for one message without teaching the sender (the API supports it; the view does not offer it).
- [ ] Correct mail sift already kept, from the Decisions view and the message panel.
- [ ] Use examples to test sift: replay the model over `examples` and report accuracy per label (`evals/`).
- [ ] Use examples to teach the model: pick relevant ones as few-shot examples in the prompt.
- [ ] Turn repeated corrections into a suggested guideline or rule, shown to the user before it is saved.
- [ ] Re-decide waiting suggestions when a label's action or the guidelines change.
- [ ] Accuracy per tier on the Overview; say when a label has been right often enough to trust (each label already shows its record).
- [ ] Trust in pieces: let sift act on this label while the rest stay suggestions, with the global switch kept as a kill switch.
- [ ] Let a Chrome extension call the API: it cannot use the page's cookie or Origin, so it needs its own token, issued to a signed-in user.
- [ ] Decide how long examples are kept and add a way to delete them; they hold full message content.

## Setup

- [ ] **Recommend a default model.** When the provider is OpenAI or ChatGPT, preselect the newest version of the Luna family from the list the provider returns (highest version number whose name matches), if there is one, instead of making the user pick from the whole list. Do the same for other providers' small, cheap families.
- [ ] **A clean README.** Say plainly what sift is for (a better Gmail filter and spam filter that learns from you and turns what it learns into rules), then the onboarding, which is install and `sift init`. Move everything else (the CLI reference, Docker detail, how the dashboard is built) out to docs/.
- [ ] Run `sift init` inside Docker, where the dashboard address is the host's, not the container's. (It has been run for real on a headless server.)
- [ ] Let `init` change a step that is already done (switch model, add a second account) instead of only filling gaps.
- [ ] Show an expired Google sign-in on the dashboard and in `sift status`, not only in the `run` log. Test users are signed out every 7 days.
- [ ] Find out what publishing actually requires (branding fields, verification for these scopes) and make that path of `init` exact.
- [ ] Check the Google Cloud Console links and field names in `init` against the live console; they were written from memory of its current layout.
- [ ] `sift config`: show and set single settings without editing `sift.toml`.

## Verify against real Gmail

Everything Gmail-facing has only run against fakes.

- [ ] `sift sync` and `sift run` (observe) against a real inbox; check history paging and the expired-cursor recovery.
- [ ] `sift apply` / `sift undo` on real messages; confirm unread state and other labels are untouched.
- [ ] `sift run --act` for a day with a handful of rules.

## Deployment and isolation

- [ ] **Encrypt what is sensitive at rest.** Email is sensitive and today everything is plain files with owner-only permissions: subjects, senders and headers in `messages`, whole messages in `examples`, reasons in `decisions`, the Gmail refresh tokens, the model credentials, the Google client secret and the session secret. Design first; the open questions:
  - Where the key lives. sift runs unattended and must read mail metadata to work, so a key beside the database only protects a copied database or backup. The alternatives are the OS keyring or a TPM, a passphrase typed at start (no unattended restart), or a key held by the signed-in browser (then nothing sorts while nobody is signed in).
  - What is encrypted: the whole database (SQLCipher or similar; `node:sqlite` has none built in), or only the sensitive columns, which keeps counts and charts queryable but not search over subjects and senders.
  - Whether examples, the only stored bodies, get a stricter key than metadata, readable only while someone is signed in.
  - Per-account keys, so one account's data cannot be read with another's sign-in. This goes with keeping people apart.
  - What a lost key costs, and how backup and key rotation work.

Decided 2026-11-15: no shell or filesystem for triage. The model runs in-process in the core container and has no tools at all, so there is no model-written code to sandbox. A sandbox container is deferred until an operator-facing agent exists.

- [ ] Register only the model providers sift supports instead of `pi-ai/providers/all`, which pulls in the AWS and Google SDKs and makes up most of the image's dependencies.
- [ ] Keep the core image light: the daemon, dashboard, credentials and the in-process triage agent. Measure the image and trim it (base image, production dependencies only).
- [ ] Restrict the core container's egress to Google and the model providers. The RFC 8058 unsubscribe POST is the one call to an arbitrary host and needs its own path.
- [ ] Publish the image (registry, tags, multi-arch) and document upgrade and backup of the data volume.

Later, only if an operator-facing agent is built (one you talk to: "why did you archive that", "clean up my rules", "propose filters from last month"):

- [ ] Run it in its own sandbox container with shell and files, no credentials, a read-only snapshot of the database, and no network except a tool channel to the core.
- [ ] Decide how it reaches its model without holding the key: a credential-injecting proxy in the core, or the core making the model calls for it.

## Dashboard

The dashboard manages sift, behind Google sign-in. That sign-in also connects the Gmail account.

- [ ] **One way to open a message or a decision, as a side panel.** Wherever a message is opened (Suggestions, Decisions, Changes, a rule's matches) it should be the same component with the same behaviour, and a panel that slides over from the side, as wide as three quarters of the screen if it needs, not a centred modal. Today Suggestions and the message detail are two different dialogs.
- [ ] **Change a decision from where it is shown.** Inside a decision, offer the actions that correct it: say what the mail really is, for this message or for the future (the same scoped answer as a suggestion), and undo what was done. Today only suggestions can be answered; a decision sift already acted on, or mail it kept, cannot be corrected from the dashboard.
- [ ] **Settings needs designing with intent.** What is there is a list of whatever was built, in the order it was built. Decide what a person comes to Settings to do and order it by that: whether sift is working and acting, which accounts, the model and what it costs, then the rarely touched. Each page should say what changing it will do before it is changed.
- [ ] **`sift dev`.** One command for working on sift: the server restarts when its code changes and the page hot-reloads, against a scratch home. Today it is `sift run` plus `pnpm dev:web`, and the server needs a restart to pick up a new build.
- [ ] **Know when the API is unreachable.** On a bad connection the page should say it is offline, keep showing what it last loaded, retry by itself, hold or refuse writes clearly, and never look broken. The page is a plain React app with a small `useLoaded` hook; replace that with a data layer built for this (TanStack Query: caching, retry with backoff, refetch on reconnect, optimistic writes) and add an offline indicator to the masthead.
- [ ] Suggestion bodies are fetched once per waiting message; reuse the text the model tier already fetched instead of asking Gmail twice.
- [ ] Message text is plain and cut at 4,000 characters, as the model sees it. Decide whether reading needs more (longer text, quoted replies folded, links listed).
- [ ] Keyboard for the Suggestions grid: move between cards, open, answer.
- [ ] Design system (docs/DESIGN.md), parts still missing: a confirmation for a destructive press (Remove, Forget and Undo act at once), a toast or other place for "done" that survives a reload of the list, a text link, a multi-line form layout, and a part for a long list (the model select has no search).
- [ ] The specimen page (`/#system`) is reachable without signing in. It holds no data; decide whether to keep it in the production build.
- [ ] Narrow screens: Suggestions has a phone layout; Rules, Decisions, Changes and the Overview tables still scroll sideways.
- [ ] Try the sign-in for real: a Web application client, `tailscale serve`, the redirect URIs, and a second account.
- [ ] Keep people apart: today everyone signed in sees every connected account. Scope each session to its own account before more than one person uses an install.
- [ ] Filter every view by account once there is more than one.
- [ ] **Sign in to ChatGPT (and other model providers) from the dashboard**, as Gmail already is, so setup in the terminal ends at the Google client. The device-code flow suits a page: show the code and the link, wait, then offer the models.
- [ ] Use Tailscale's identity headers to skip the Google round trip for viewers on the tailnet.
- [ ] Remove an account, and its token and data, from the dashboard.
- [ ] Remove a label, and say what becomes of its rules and of mail already labelled; reorder labels.
- [ ] Answer queued questions.
- [ ] Per-sender and per-rule detail: the messages matched, hits over time, rules that never fire.
- [ ] Keep filters and the open message in the URL so a view can be bookmarked (the section and settings page already are).
- [ ] `pnpm dev:web` proxies to localhost:8787; make it follow `dashboard.port`.
- [ ] Revisit Vercel's UI SDK as the behaviour layer under `web/src/system` once it is past beta and works under the content security policy (evaluated 2026-11-15; see docs/ARCHITECTURE.md).

## Inference tier

Built: one model call per message that names a label; the label's action decides what happens. Not yet run against a real model or a real mailbox.

- [ ] **Structured facts about each message.** The reasoning model, rules and filters should all work from the same named facts instead of each re-reading headers. Today sift derives a few from headers and shows them to the model: has an unsubscribe header (and whether it is one-click), mailing list id, marked bulk or auto-generated, passed DMARC, whether the user has written to the sender. Make that a recorded set per message and grow it: sent through a bulk mail service, reply-to differs from sender, sender's domain differs from the links, has attachments, is a reply in a thread the user took part in, addressed to the user directly or by bcc, language, Gmail's own category tab. Then let rules match on them ("has an unsubscribe header and I have never written to them"), show them when a message is opened, and filter lists by them.
- [ ] **Rewrite the default guidelines.** The starting `guidelines.md` is explanatory text, and its examples tell the model to delete things, which sift never does and which is poor steering. Start with a short set of real instructions in the owner's voice that fit the default labels, or start empty and let the Guidelines page explain itself outside the text the model reads.
- [ ] Finish a ChatGPT subscription sign-in (`sift login openai-codex`; both it and `sift login openai` reach OpenAI's sign-in page) and run a real classification end to end. Confirm the token refreshes and survives a restart, and try the device-code login inside Docker.
- [ ] Recommend a model in `sift init` (it lists what the provider offers but gives no guidance beyond "smaller is usually enough").
- [ ] Measure it: a labelled synthetic set in `evals/`, accuracy per label, how often it answers "unsure", cost per message.
- [ ] Thread context for the model: earlier messages in the thread and whether the owner took part.
- [ ] Decision model tier (Jev or Clef through pi-ai `classify`) in front of the model, once there are enough decisions to set thresholds.
- [ ] Header heuristics as a built-in tier (List-Id, List-Unsubscribe, Precedence, Auto-Submitted) for obviously bulk mail.
- [ ] Decide whether pi-durable is needed. Triage is one call per message and the SQLite queue already retries and decides once, so it is not used today.

## Learning loop

- [ ] Detect corrections from Gmail history (the user moves mail back to the inbox or out of spam) and store them as rule or sender exceptions.
- [ ] Promote a learned sender or rule that keeps matching, and that Gmail can express, to a Gmail filter, with the user's approval.
- [ ] Reconcile Gmail filters sift created against what exists (the user may edit or delete them).

## Actions

- [ ] Unsubscribe executor: RFC 8058 one-click POST only, DKIM pass required, outcome recorded separately from the mailbox change.
- [ ] `sift review`: list and answer queued questions; an answer becomes a rule.
- [ ] A way to tell the user about questions and failures without a send path (the dashboard, a label, or a digest draft).

## Quality

- [ ] `evals/`: a labelled synthetic set to measure each tier's accuracy and abstention rate.
- [ ] Optional Pub/Sub pull subscription for lower latency, keeping polling as the fallback.
- [ ] Retention: prune old message rows and decisions on a configurable schedule.
