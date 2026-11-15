# What Gmail's API gives sift

What sift can use directly, and what it has to do itself. From Google's documentation as read on 2026-11-15; re-check before relying on a limit. sift holds two scopes, `gmail.modify` and `gmail.settings.basic`, both of which Google classes as restricted.

## Used directly

| Need | API | Notes |
| --- | --- | --- |
| Find new mail | `users.history.list` | A history id is "typically valid for at least a week", sometimes only hours. A 404 means resync, which sift does with a bounded search. 2 quota units. |
| Read a message | `users.messages.get` | 20 units for metadata, 60 for the full message. |
| Archive, mark spam, mark read, label | `users.messages.modify` | Add or remove label ids: `INBOX`, `SPAM`, `UNREAD`, `STARRED`, `IMPORTANT`, the `CATEGORY_*` tabs and user labels can all be applied. 5 units. |
| Many at once | `users.messages.batchModify` | Up to 1,000 ids, 50 units. Not used yet: sift changes one message at a time so each has its own audit row. |
| Labels | `users.labels.*` | Nested names (`sift/newsletters`) are ordinary labels with a slash. |
| Put a message in the mailbox | `users.messages.insert` | Works with `gmail.modify`. "Does not send a message." This is how a daily digest can arrive without sift being able to send. 25 units. |

Rate limit: 6,000 quota units a minute per user, which is about 300 metadata reads.

## Available, not used yet

- **Filters** (`users.settings.filters`, with `gmail.settings.basic`). A filter matches on from, to, subject, a Gmail search query, attachment and size, and can add or remove labels: archive (`INBOX` off), mark read (`UNREAD` off), star, mark important, one user label, never-spam. Up to 1,000 filters; there is no update, only create and delete. The documentation does not say a filter can add `SPAM`, and filters apply to a message, not its thread. This is where stable rules can be copied so they run when sift is off.
- **Push** (`users.watch`). Needs a Google Cloud Pub/Sub topic, renewed at least every 7 days, and only says "something changed": the changes still come from `history.list`. Google recommends polling for a client like sift, which is what it does.
- **Threads** (`users.threads.modify`). Applies a change to every message in a thread; later messages do not inherit it.

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
