# What Gmail's API gives sift

What sift can use directly, and what it has to do itself. From Google's documentation as read on 2026-11-15; re-check before relying on a limit. sift holds two scopes, `gmail.modify` and `gmail.settings.basic`, both of which Google classes as restricted.

## Used directly

| Need | API | Notes |
| --- | --- | --- |
| Find new mail | `users.history.list` | A history id is "typically valid for at least a week", sometimes only hours. A 404 means resync, which sift does with a bounded search. 2 quota units. Besides new messages it lists labels added and removed, per message; a record has no time and does not say who made the change, and sift's own changes appear like anyone's. |
| Read a message | `users.messages.get` | 20 units for metadata, 60 for the full message. Metadata is headers and labels only: whether a message has attachments needs the full message, whose parts carry a `filename`. |
| Who took part in a thread | `users.threads.get` | `format=minimal` gives each message's id and labels; one the owner sent carries `SENT`. Asked only for a reply the model is about to judge. 10 units. |
| Archive, mark spam, mark read, label | `users.messages.modify` | Add or remove label ids: `INBOX`, `SPAM`, `UNREAD`, `STARRED`, `IMPORTANT`, the `CATEGORY_*` tabs and user labels can all be applied. 5 units. |
| Many at once | `users.messages.batchModify` | Up to 1,000 ids, 50 units. Not used yet: sift changes one message at a time so each has its own audit row. |
| Labels | `users.labels.*` | Nested names (`sift/newsletters`) are ordinary labels with a slash. |
| Copy a rule to Gmail | `users.settings.filters` | With `gmail.settings.basic`, which sift already asks for. A filter matches on from, to, subject, a Gmail search query, attachment and size, and can add or remove labels: archive (`INBOX` off), mark read (`UNREAD` off), star, mark important, one user label, never-spam. Up to 1,000 filters; no update, only create, delete, get and list; creating a duplicate is refused. The documentation does not say a filter can add `SPAM`, so sift never writes one. Filters apply to a message, not its thread, and only to mail that arrives afterwards. `to` matches Cc and Bcc as well as To. |
| The owner's other addresses | `users.settings.sendAs.list` | With `gmail.settings.basic`. Lists the account's own address and every send-as alias; one still `pending` was never confirmed from its own inbox, so sift does not count it. 1 unit. |
| Put a message in the mailbox | `users.messages.insert` | Works with `gmail.modify`. "Does not send a message." This is how a daily digest can arrive without sift being able to send. 25 units. |

Rate limit: 6,000 quota units a minute per user, which is about 300 metadata reads.

## Available, not used yet

- **Push** (`users.watch`). Needs a Google Cloud Pub/Sub topic, renewed at least every 7 days, and only says "something changed": the changes still come from `history.list`. Google recommends polling for a client like sift, which is what it does.
- **Threads** (`users.threads.modify`). Applies a change to every message in a thread; later messages do not inherit it.

## Not checked against real Gmail

- Whether a filter's `from: @example.com` leaves out subdomains, as sift's domain rules do.
- Whether Gmail hands a filter back exactly as it was created. sift compares against what Gmail returned at creation, not what it sent, so a rewrite at creation is harmless; a later rewrite would show as "changed".
- How a snoozed message appears in history. If snoozing takes `INBOX` off and waking puts it back, sift reads each as the user moving the message, and records two answers for it.
- Whether editing a filter in Gmail's settings keeps its id (seen by sift as "changed") or replaces it (seen as "gone").

## Not in the API: sift does it itself, or cannot

| Feature | Status |
| --- | --- |
| **Block a sender** | Gmail's blocked-senders list is not exposed. sift's block is its own: the message is marked spam and a rule makes that sender's later mail spam without a model. A Gmail filter cannot stand in for it unless filters can add `SPAM`, which is not documented. |
| **Unsubscribe** | No API. sift makes the sender's one-click request itself (RFC 8058) when the user asks; see `src/actions/unsubscribe.ts`. Lists that need an email sent cannot be left: sift cannot send. |
| **Report spam or phishing** | No API beyond applying the `SPAM` label. |
| **Mute, snooze** | Not in the API. |
| **Contacts, "people I have emailed"** | Not in the Gmail API. sift searches sent mail for an address instead and caches the answer. |
| **Send, forward** | Possible with other scopes (`gmail.send`; forwarding needs a verified address). sift does not ask for them. |
| **Delete** | Trash is possible with `gmail.modify`; permanent deletion needs full mail access. sift does neither. |
