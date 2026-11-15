# TODO

The working list for sift. Remove an item when it lands; add what you find. Design and current state are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Direction

sift suggests first and acts second. By default it only observes: every decision is a suggestion, shown in the dashboard. The user teaches it there (right, wrong, do this instead) until it stops making mistakes, and only then lets it act. The dashboard is where that happens; a Chrome extension that talks to it comes later.

## Teaching loop

Built: the Suggestions view, answers by sender ("Right" or "No, it is <category>"), sender records from answers, accuracy from answers, and marked messages stored whole as examples. Tried in a browser on synthetic data only.

- [ ] Use it on real mail and see what is awkward.
- [ ] Answer for one message without teaching the sender (the API supports it; the view does not offer it).
- [ ] Correct mail sift already kept, from the Decisions view and the message panel.
- [ ] Use examples to test sift: replay the model over `examples` and report accuracy per category (`evals/`).
- [ ] Use examples to teach the model: pick relevant ones as few-shot examples in the prompt.
- [ ] Turn repeated corrections into a suggested guideline or rule, shown to the user before it is saved.
- [ ] Re-decide waiting suggestions when a category setting or the guidelines change.
- [ ] Accuracy per tier and per category on the Overview; say when a sender or category has been right often enough to trust.
- [ ] Trust in pieces: act on this sender or this category while everything else stays a suggestion, instead of one global `act` switch.
- [ ] Let a Chrome extension call the API: it cannot use the page's cookie or Origin, so it needs its own token, issued to a signed-in user.
- [ ] Decide how long examples are kept and add a way to delete them; they hold full message content.

## Setup

- [ ] Run `sift init` inside Docker, where the dashboard address is the host's, not the container's. (It has been run for real on a headless server.)
- [ ] Let `init` change a step that is already done (switch model, add a second account) instead of only filling gaps.
- [ ] Show an expired Google sign-in on the dashboard and in `sift status`, not only in the `run` log. Test users are signed out every 7 days.
- [ ] Find out what publishing actually requires (branding fields, verification for these scopes) and make that path of `init` exact.
- [ ] Check the Google Cloud Console links and field names in `init` against the live console; they were written from memory of its current layout.
- [ ] Let `init` set category preferences interactively, not just show them.
- [ ] `sift config`: show and set single settings without editing `sift.toml`.

## Verify against real Gmail

Everything Gmail-facing has only run against fakes.

- [ ] `sift auth` end to end with a real Desktop OAuth client, including the paste-the-URL fallback.
- [ ] `sift sync` and `sift run` (observe) against a real inbox; check history paging and the expired-cursor recovery.
- [ ] `sift apply` / `sift undo` on real messages; confirm unread state and other labels are untouched.
- [ ] `sift run --act` for a day with a handful of rules.

## Deployment and isolation

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

- [ ] **Design the components.** The page has a settled style but its parts were never designed: suggestion rows, the figures strip, tables, selects and buttons, the message panel, settings rows, the chart, empty and loading states. Take each in turn.
- [ ] Try the sign-in for real: a Web application client, `tailscale serve`, the redirect URIs, and a second account.
- [ ] Keep people apart: today everyone signed in sees every connected account. Scope each session to its own account before more than one person uses an install.
- [ ] Filter every view by account once there is more than one.
- [ ] Sign in to a model provider from the dashboard; it still needs `sift init`.
- [ ] Use Tailscale's identity headers to skip the Google round trip for viewers on the tailnet.
- [ ] Remove an account, and its token and data, from the dashboard.
- [ ] Edit a category's label, name and description; add and remove categories.
- [ ] Reorder rules; rules with more than one condition and with exceptions.
- [ ] Answer queued questions.
- [ ] Per-sender and per-rule detail: the messages matched, hits over time, rules that never fire.
- [ ] Split the bundle (about 800 kB, mostly Recharts) if load time matters.
- [ ] Keep filters, tab and open message in the URL so a view can be bookmarked.
- [ ] `pnpm dev:web` proxies to localhost:8787; make it follow `dashboard.port`.
- [ ] Revisit Vercel's UI SDK if shadcn ships a base built on it (evaluated 2026-11-15, not adopted; see docs/ARCHITECTURE.md).

## Inference tier

Built: one model call per message that names a category; the category's setting in the database decides what happens. Not yet run against a real model or a real mailbox.

- [ ] Finish a ChatGPT subscription sign-in (`sift login openai-codex`; both it and `sift login openai` reach OpenAI's sign-in page) and run a real classification end to end. Confirm the token refreshes and survives a restart, and try the device-code login inside Docker.
- [ ] Recommend a model in `sift init` (it lists what the provider offers but gives no guidance beyond "smaller is usually enough").
- [ ] Measure it: a labelled synthetic set in `evals/`, accuracy per category, how often it answers "unsure", cost per message.
- [ ] Show the category, the guidelines in force and learned senders on the dashboard.
- [ ] `sift senders`: list, correct and forget what has been learned about a sender.
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
