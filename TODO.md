# TODO

The working list for sift. Remove an item when it lands; add what you find. What is built is in [docs/architecture.md](docs/architecture.md), the dashboard's parts in [docs/design.md](docs/design.md), and what Gmail's API can and cannot do in [docs/gmail.md](docs/gmail.md).

## Labels and rules

- [ ] **Rules in the user's words.** A label rule can carry a condition in the user's words, which the model applies. Let one name an action without a label (today it needs one, if only Leave in inbox); propose a plain rule when the condition always holds.
- [ ] **A sender's page says the kinds of rule in Sift's words**, not the user's. Its list of names counts mail with an action and no label as undecided (`unplaced`, `web/src/views/sender.tsx`).
- [ ] **Standing.** The server counts a label rule whose label archives as Unwanted (`src/store/senders.ts` gives the rule its label's action), while the sender page lights a standing only for an action rule for exactly them; make them agree. Add standing that is earned (answers that keep agreeing) beside the one given, and a list of all senders and domains to browse by standing.
- [ ] **Use whether the user reads a sender's mail** (`messages.read_at`; not known for mail from before Sift was connected): in their standing, and to propose unsubscribing from a sender whose mail goes unopened and is never moved back. Suggested labels unsubscribe only where the sender never had permission, so lists the user was added to stay subscribed today.
- [ ] **Unsubscribe.** Lists that need an email sent or a page opened are skipped: show their link for the user to open. Show on Labels and Rules how many senders each has unsubscribed from. Say plainly, before Sift is turned on, which labels will start unsubscribing. Mail moved by applying a rule, or by an answer carried out later, does not unsubscribe even when the rule says to; only the sender's next message does.
- [ ] **What an answer cannot do.** An answer cannot block or unsubscribe; decide whether those belong on the label only.
- [ ] **Flag as an extra.** Star or mark important, beside mark read and unsubscribe.
- [ ] **Custom actions**, such as forwarding phishing to a security address. Forwarding needs permission to send or a verified forwarding address, and AGENTS.md's rule against forwarding would have to say when it is allowed; decide both before building it.
- [ ] **Is Gmail's importance marker worth anything?** A rule can ask for it; the model is not shown it. Measure on real answers how often mail the user kept was marked and mail they let go was not, before suggesting it in a rule or weighing it in the prompt.
- [ ] **Per-label trust.** Let Sift act on some labels while the rest stay suggestions, with each person's switch kept as a kill switch. Each label already shows how often Sift has been right about it.
- [ ] **Show blocked senders plainly.** Today they are found only by filtering Rules to the ones Sift made. A label set to block will block a real sender whose security notice it mislabels.
- [ ] **A daily digest.** An outcome for a label: take the mail out of the inbox as it arrives, then once a day put one message in the inbox (`users.messages.insert`, no permission to send) covering what came in, written by an agent whose job is to pull out what might matter (a failed build among forty passed ones). Service notifications such as GitHub's are the first use. To design: what the agent may read; when it runs and what an empty day does; how an item links back to its message.
- [ ] **Setting up labels.**
  - Run it with a real model: whether its suggestions are narrow (Cold outreach, not Marketing) and mostly filters, not categories to keep; whether "never miss" goes into the descriptions of labels that might catch it; how long the call takes; whether eight is too many to read.
  - Check on the owner's answered mail that the model's "unsure" still means unsure with Leave in inbox on the list, not "none of these".
  - Look at a provider's own sign-in step (an API key, ChatGPT's code) in the setting-up page's layout.
- [ ] **Rules as Gmail filters.** Decide whether a filter may mark mail read (refused today). Mail a filter archives never reaches Sift, so it has no record, no hit count and no unsubscribe: record mail that arrives outside the inbox already carrying a `sift/` label.
- [ ] **Propose leaving a sender in the inbox** after a run of Leave in inbox answers for them, as `proposeFromCorrections` already does for a label's mail given another action, so their mail stops costing a model call.
- [ ] **Audit rules.** Flag a rule the user contradicts (answers made in Gmail are marked as such and can feed this), one that never fires, and one a spot-check by the model disagrees with.
- [ ] **The names a sender uses.** An address that writes under many names that are people rather than kinds of mail (GitHub's notifications carry the actor's name) lists every one; decide how many to show. Propose a rule per name when an address's mail is mixed but one name's agrees. The rule dialog started from a message fills in the name only when the sender has used more than one.
- [ ] Make an exception to a rule from its panel (it shows them; nothing makes one). Reorder rules and labels.
- [ ] **Undo an apply as one.** Applying a rule to the inbox can move hundreds of messages, each with its own Undo in Activity and none for the press as a whole.
- [ ] **Rules for one mailbox.** A rule is the person's, for every mailbox. Someone with a personal and a work account may want one in one and not the other: decide how a rule says so, likely a condition on the mailbox the mail came to, and on which of the user's own addresses it was sent to, for aliases.
- [ ] **What is still per mailbox now that labels and rules are the person's.** A sender's and a domain's page are one mailbox's, so a rule's links open the primary mailbox's; the rule drafter looks senders up in one mailbox (`senderDirectory`); a proposal comes from one mailbox's answers, so two can propose the same rule; and a rule's Gmail filter is not written to a mailbox connected after the press.
- [ ] **A new rule leaves mail Sift marked for review while on.** Making a rule skips waiting suggestions that carry the review label in Gmail (`redecideWaiting`), and applying it to the inbox skips them too (`planFor`), so only answering each one clears them. Decide whether a rule of the user's settles them, taking the review label back.

## Teaching loop

- [ ] **Going through the inbox again costs again.** Every message is put to the model anew, even one judged with the same model, labels and examples. Decide whether to keep a judgement made since the last change to any of those, and say in the estimate how many that leaves.
- [ ] **An inbox run that acts fills Activity** with a decision per message, most of them agreeing with the last. Decide whether a decision that changed nothing is listed, and whether a run's changes can be undone as one (as with applying a rule).

- [ ] **Screens for what the API already has:** test runs (start one, watch it, compare two), stored examples (list, delete, how long they are kept), accuracy per tier, and how many suggestions changed after a rule or label edit.
- [ ] Test runs: replay the whole cascade and not only the model, cancel a run, prune old runs. A run's prompt has less than new mail's: no standing and none of the sender's other labelled mail.
- [ ] The emails shown to the model as examples: check with test runs whether six, two from the same sender, and two found each way (same name, same kind of subject) are right, and whether subjects that share most words but not all should match. If a line of facts and the first 300 characters are not enough, let the model read one in full by a short handle (`E1`), which would be the judge's first tool besides recording its verdict (AGENTS.md, architecture.md).
- [ ] A removed rule Sift made leaves its mail looking as if the user's rule decided it, so it never returns to For review.
- [ ] From Gmail: snooze may read as archive then un-archive (two answers); `sift/did/*` stays on mail the user moved back; mail Sift could not place that the user archives without labelling is skipped.
- [ ] **Learn from mistakes, by proposing.** A daily pass over what the user corrected: where the model keeps getting the same kind of mail wrong, a model proposes a change (a rule for the sender, a condition on a rule, a sharper label description) for the user to accept or dismiss.
- [ ] A proposal is keyed by its sender alone (`proposals_once`, `src/store/proposals.ts`), not sender and label: overrides of a second label rewrite the open proposal, and dismissing one stops proposals for every label of that sender. Decide whether the key takes the label.

## Dashboard

- [ ] **The message panel.** Mail Sift already acted on or kept has no text held, so it opens without it. Correcting one message does not fix the sender's other mail Sift already moved.
- [ ] **Say why Sift would ask.** For review's meter says only whether Sift would have acted by itself; why it would ask (not sure enough, no label, or a protection: you have written to them, a reply in your thread, could not check) is buried in the reason. Say which wherever such a decision is shown.
- [ ] **What Sift costs, and why.** Spend by tier and by model, cost per message, which senders and kinds of mail cost the most, what rules saved, and what a change would save. Label suggestions and rule drafts are left out of spend (`src/dashboard/queries/summary.ts` and the masthead's `src/dashboard/queries/usage.ts` sum only `model_runs`) and kept until the mailbox goes; count them and decide how long to keep them.
- [ ] **Check an API key when it is pasted.** A wrong or expired key shows as connected until the label suggestion or the next classification fails. Try it on Continue with the provider's cheapest call, recorded like any model call, and say what is wrong under the field.
- [ ] **An adversarial review of every screen**, as a first-time and as a hurried user: what is unclear, cannot be found, says one thing and does another, or is missing when something goes wrong. Fix what it finds, screen by screen.
- [ ] Dashboard plumbing: after signing in again from the expired notice the browser returns to `/`, not where it started; an account with no token at all gets no masthead notice; the expired notice clears only after the next pass; a focused menu or select popup draws the yellow outline around the whole popup; push notifications; switching account from the menu; whether `/system` stays in the production build.
- [ ] Keyboard: keys to go between sections (Gmail's G then a letter); Undo by key after an answer; the Activity list's own actions.
- [ ] Design system parts: a select with search for a long list (the model select), and a filter that narrows by sender or label by typing.
- [ ] Activity lists decisions, so a change with no decision behind it (an unsubscribe, putting a message back after a correction) shows only in that message's history. Decide whether Activity lists those as rows of their own.
- [ ] Undo from a toast: nothing offers to redo an undo, and an answer cannot be taken back from the toast that reports it; the server needs a way to take an answer back.
- [ ] Retake the screenshots: README's (`docs/images/suggestions.png`) shows the old page and says an answer makes a rule; design.md's (`docs/images/design-system.png`) is out of date.
- [ ] Message text is plain and cut at 4,000 characters, as the model sees it. Decide whether reading needs more (longer text, quoted replies folded, links listed).
- [ ] On a phone a 600px HTML message scrolls sideways inside its frame; it cannot be scaled without script.
- [ ] The service worker (`public/sw.js`) keeps every built file it is asked for and never lets one go, so each new build of Sift adds to its cache. Drop files no kept page names, or clear the cache when the build changes.
- [ ] A rule's panel shows what it decided each day over 30 days and its mail still in the inbox; not yet every message it matched.
- [ ] **Download your own data**, to keep or to build an eval set from: each message's record with what each tier and the model said and what the user answered, their labels and rules, and the mail text kept in `examples`. Most of it is sealed, so the server opens it for that person alone. To decide: the format (JSON Lines, a message a line with the answer beside the decisions, reads straight into an eval), whether mail text is in it by default, and how a large record streams out within a Vercel function's time limit.
- [ ] **Mailboxes.** A mailbox switcher in the page (one, or all); a way to hand over or leave an install; try a second account end to end.
- [ ] Removing a mailbox or deleting an account leaves the Gmail filters Sift wrote, and the confirm says so. Offer to remove them, which needs the mailbox's access before it is revoked. Say that backups keep data for their own retention.
- [ ] Try a label's description, or a rule's "only when", on recent mail before saving it: what the model would now say about a few messages, beside what it said.
- [ ] Use Tailscale's identity headers to skip the Google round trip for viewers on the tailnet.
- [ ] Let a Chrome extension call the API: it cannot use the page's cookie or Origin, so it needs its own token, issued to a signed-in user.
- [ ] **Manage the inbox from Sift?** Read, archive, reply-later, search, bulk actions by sender or label. Decide whether that is the direction; the first step would be an inbox view of what Sift kept, with For review's row and panel. Replying needs permission to send.

## Inference

- [ ] **Several labels with a confidence each.** Have the model score every plausible label instead of naming one, take the highest if it clears a threshold, and ask the user if none does. It gives a real "how sure", shows the runner-up when Sift was wrong ("it was nearly Receipts"), lets thresholds differ by what the label does (higher for spam and block), and makes "these two labels are hard to tell apart" measurable. To settle: whether a message still gets exactly one label; the threshold, and whether it is per label; how the scores are stored with the decision so they can be tested against examples.
- [ ] A when-label rule reaches the model as "Mail from this sender is usually L" (`src/triage/prompt.ts`), which may push it toward L when the rule only says what to do if it is L. Decide what the prompt says of such a rule, if anything.
- [ ] Wire the classifier stage (`src/triage/stages/classifier.ts`, a small decision model through pi-ai) in front of the reasoning model, once there are enough examples to set thresholds.
- [ ] Confirm a ChatGPT subscription token refreshes by itself over weeks and survives a restart; try the device-code login inside Docker.
- [ ] Sign in with ChatGPT (`SIFT_CHATGPT_SIGN_IN=redirect`) with a real account: check that `/v1/models` lists the model Sift offers, and offer what it lists instead of pi-ai's OpenAI catalogue if not. Ask OpenAI whether a self-hosted server counts as "locally hosted".

## Setup

- [ ] Run `sift init` inside Docker, where the dashboard address is the host's, not the container's.
- [ ] **Google verification.** Find out what publishing the Google app requires (branding fields, restricted-scope verification, a yearly security assessment (CASA)) and make that path of `init` exact; check its Console links and field names against the live console, since they were written from memory. Hosting one Google client for other people on Vercel needs the same.

## Verify against real Gmail

Sift has run on the owner's inbox while off. Nothing that changes the mailbox has run for real.

- [ ] Turn Sift on for a day with a handful of rules. Confirm both Gmail labels appear, unread state and other labels are untouched, and undo puts things back.
- [ ] Mark read, mark spam and block on real messages; confirm the spam refusal for people the user has written to.
- [ ] The unsubscribe request against a real list.
- [ ] History paging on a busy day, recovery from an expired cursor, and the volume now that history is not narrowed to the inbox.
- [ ] Gmail filters: whether `from:@domain` leaves out subdomains, whether Gmail rewrites a filter's criteria after it is created, whether editing a filter in Gmail keeps its id, and how a snoozed message appears in history (docs/gmail.md lists all four).
- [ ] Encrypted credentials, the installed app and offline state, on the real install.

## Deployment and isolation

- [ ] **A contact for the hosted Sift.** Its terms, privacy policy and security page (`web/src/views/legal.tsx`) send questions to the repository's public issues and security reports to GitHub's private reporting, for want of an address of its own. Give it one (a setting beside `SIFT_CLOUD`) and name it in those pages and in the Google consent screen.
- [ ] The person's words to the label model, and what it suggests, are encrypted, but the labels made from them (names, descriptions) are plain. Decide one way.
- [ ] **Vercel.** Not yet seen: a Workflow run on the Vercel World (the cron's tick beginning runs, a step opening the instance's Sift), that `experimental_retention: 0` deletes a finished run's input there, and whether Workflow's own spans reach Sentry linked to the tick that began them. The Deploy Button ([docs/vercel.md](docs/vercel.md)) is untried: check that it adds Neon and Upstash, and that Upstash sets `REDIS_URL`.
  - **Setup in the browser.** No `sift init`: the Google client and settings entered in the dashboard, with the first visitor claiming the install safely.
  - **A public address.** Sign-in is the only gate there; review the session and write protections with that in mind.
- [ ] **Fewer Gmail calls.** Each pass fetches a new Google access token for each mailbox (`clientFor`); keeping it until it expires needs it encrypted in `Ephemeral`. The minute look at an idle mailbox (`passWanted`) still lists its waiting suggestions and their text to see whether any is to be fetched or let go, and opens the model sign-in while mail waits undecided; each could be one count in SQL.
- [ ] **Passes for changes sync ignores.** Any change the person makes in Gmail begins a pass (`syncWants`), though sync reads only moves, Sift's labels and mail opened; Gmail's own importance and category marks, and mail marked unread, begin one that finds nothing. Narrowing it means one test of a change shared with `learnFromGmail`.
- [ ] **A lost key has no way back** short of a new database: the rekey pass refuses to start while any sealed row does not open. Let the owner drop what does not open (sign-ins, sealed mail and rule text) and start ([docs/secrets.md](docs/secrets.md#losing-the-key)).
- [ ] Restrict the core container's egress to Google and the model providers. The unsubscribe request is the one call to an arbitrary host and needs a relay container of its own first; the plan is in [docs/deploy.md](docs/deploy.md).
- [ ] Publish the image (registry, tags, multi-arch). It is 1.32 GB, up from 337 MB before Next.js and the Workflow SDK: Next.js itself is about 207 MB, and its compiler binary about 94 MB more. Next.js's `output: 'standalone'` would ship only the files the server uses; not tried.
- [ ] The page (Next.js) is not behind Sift's Host check: it holds no mail, and Workflow's routes check their own key. Decide whether it should be.
- [ ] `/_next/static/*` is served without the content security policy or `nosniff` header.
- [ ] A run that never ends is only logged and reported (`STUCK_MS`, `src/app/sift.ts`); its piece is not begun again until someone cancels it with Workflow's CLI. Decide whether Sift should cancel it.
- [ ] Optional Pub/Sub push for lower latency, keeping polling as the fallback. It needs a Google Cloud topic, so it is a lot of setup for a self-hosted tool.
- [ ] **An agent you talk to** ("why did you archive that", "clean up my rules"), if ever built, gets its own sandbox container: shell and files, no credentials, a read-only snapshot of the database, no network except a tool channel to the core. Decide how it reaches its model without holding the key: a proxy in the core that adds it, or the core making the calls for it.
