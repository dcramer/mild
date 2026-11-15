# TODO

The working list for sift. Remove an item when it lands; add what you find. Design and current state are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Direction

sift suggests first and acts second. By default it only observes: every decision is a suggestion, shown in the dashboard. The user teaches it there (right, wrong, do this instead) until it stops making mistakes, and only then lets it act. The dashboard is where that happens; a Chrome extension that talks to it comes later.

## Teaching loop

This is the next real piece of work. Nothing below exists yet.

- [ ] A suggestions view: what sift would do with each message, grouped by sender or kind, newest first.
- [ ] Approve or correct a suggestion: "right", or "should have been <kept|archived|...>", for this message, this sender, or this kind of mail.
- [ ] Turn a correction into something durable: a sender record, a rule, a category change or a line in the guidelines, and show the user which.
- [ ] Re-decide waiting suggestions after a correction, so the effect is visible straight away.
- [ ] Track accuracy from those answers, per tier and per category, and show when a sender or category has been right often enough to trust.
- [ ] Let trust be granted in pieces: act on this sender or this category while everything else stays a suggestion, instead of one global `act` switch.
- [ ] The dashboard needs to accept writes for all of this. It has no login today; design that first (a per-install token, same-origin checks, what a Chrome extension would use).

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

A React app in `web/` (shadcn/ui on Base UI, Tailwind, Recharts) served by `sift dashboard`.

- [ ] Offer `tailscale serve` as the way to reach the dashboard from other devices: sift stays on localhost and Tailscale adds HTTPS and identity. Today it listens on the Tailscale address over plain HTTP.
- [ ] `pnpm dev:web` proxies to localhost:8787; make it follow `dashboard.port`.
- [ ] Undo a change, answer a question, and edit rules and categories from the dashboard (see Teaching loop for the write path). The CLI commands for these are stopgaps.
- [ ] Senders view: per-sender volume, what sift does with them, and a way to see their messages.
- [ ] Rule detail: the messages a rule matched, hits over time, rules that never fire.
- [ ] Live view of what the agent is doing once the agent exists (current run, tool calls, cost so far).
- [ ] Split the bundle (it is about 790 kB, mostly Recharts) if load time matters.
- [ ] Keep filters, tab and open message in the URL so a view can be bookmarked.
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
