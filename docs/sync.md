# Sync

Not built yet: this is the design the work follows. Until it lands, [architecture.md](architecture.md#dashboard) describes the page as it is.

The dashboard keeps a copy of the person's mail summaries, labels, rules and settings in the browser, encrypted, and draws every screen from it. The server sends what changed since the copy was last brought up to date. A screen opened, a conversation opened, J and K, a filter changed or a press made waits on nothing; the network only reconciles.

The shape follows what mail clients built for this do: Fastmail's offline web client on JMAP (a counter per account, "changes since", a fresh start when a cursor is too old, the inbox's listing worked out from what is held), Linear's sync engine (a write confirmed when the client has applied the log through its number), and Proton Mail's web client for the device's key (held by the server, released to a live session). Sources are at the end.

## What the page holds

The window is:

- every conversation with a message in the inbox now, all its recorded messages with it;
- labels, rules, proposals, and the person's settings and mailboxes (what `/api/manage` reads);
- For review's rows, in a later step: they stay a server read until Inbox and the reader are on the copy.

It is the person's, across all their mailboxes; the mailbox switch narrows it in the browser. Inbox's views, its label and unread filters, the period headings, "3 of 19", previous and next are worked out from it.

Outside the window the page asks the server, as now: a search, Ask, archived and sent mail a search finds, Activity, Contacts, a sender's and a domain's page, usage, a rule's figures. Those reads no longer poll: each reloads when the feed says a kind it is built from changed.

The copy fills in stages: conversations newest first, then the text of the newest 30 inbox conversations' newest messages, then the text of the conversations either side of the one open, and any other as it opens. Inbox says it is empty only once the whole window has arrived, never while it is still filling.

A message's HTML is still a frame loaded from the server under its own policy (`FRAME_POLICY`, `src/dashboard/policy.ts`). The text is held, so a message opens on its text if the frame has not loaded yet.

## Records

| Kind | Key | What it holds |
| --- | --- | --- |
| `conversation` | `<accountId>/<threadId>` | Its recorded messages, oldest first, each as Inbox and the reader's folded rows show it: id, sender's name and address, subject, preview, when, Gmail's label ids, unread, and what Sift thinks of it (the current decision, or the person's answer where they gave one) |
| `text` | `<accountId>/<messageId>` | A message's readable text, and whether Sift holds its HTML |
| `label`, `rule`, `proposal` | their ids | As `/api/manage` and `/api/rules` send them |
| `settings` | `settings` | What `/api/manage` sends besides labels |

What is `held` in a reply today is `held` in these too, and the page draws it through `reveal` as before. A conversation is one record because an archive in Gmail that takes its last message out of the inbox takes all of it out of the window, including messages that did not change.

## The feed

`GET /api/sync?since=<cursor>` answers:

```
{ cursor, reset, more, changes: [{ kind, key, value }] }
```

- `changes` in the order they were made, at most 500 a reply; `more` is true when there are others, and the page asks again at once with the new `cursor`.
- `value` null: gone, deleted or out of the window.
- `reset` true: drop everything held first, then take what follows as the whole window. The page gets it with no cursor, with a cursor older than the oldest deletion the server still remembers, and when what a record holds has changed since the cursor was given (the cursor carries the version of the shapes).
- A conversation is sent whole, read at the time of the request, so a record changed several times since the cursor comes once.

Behind it:

- **One counter per person.** Each write to a table the window is built from (messages, decisions, feedback, labels, rules, proposals, preferences, mailboxes, the text of mail kept) bumps the counter and records the record's kind, key and the number, one row per record, by triggers in a custom migration. Triggers, so no write path can forget it. A decision or an answer marks its message's conversation.
- **Numbers in the order they commit.** The trigger takes the next number by updating the person's counter row, which stays locked until the write commits, so a page that has seen 12 has seen everything before it. A Postgres sequence would not do: it can give 12 to a write that commits before the one given 11, and a page that read in between never sees 11. The lock holds the person's writes one after another; Sift's transactions wait only on the database, so this costs little.
- **Deletions are remembered 30 days**, then dropped, and the person's counter remembers the newest number it dropped (`purgedThrough`): a cursor older than that gets a reset, never a partial answer.
- **The rekey marks nothing.** It rewrites every encrypted row without changing what any says; the triggers pass over its writes.

## Writes

Every write's reply carries the person's counter after it, in a header (`x-sift-seq`), set by the server for every write route. The page shows the change at once, sends it, and the change is done when the copy has been brought up to that number: the page asks the feed straight away. A refusal or a failure undoes the change on the page and says why, as now. Nothing is queued while Sift is unreachable.

## On the device

Proton Mail's web client keeps a random key on the server for each session and releases it only to that session, so what is on the disk cannot be read without a live sign-in. Sift does the same:

- **A key per browser.** A row of its own in the person's database (`devices`): a random 256-bit key sealed through `src/secrets.ts` like every other secret (the rekey covers it), when it was made and last used, and an HttpOnly cookie, `sift_device`, naming the row. A signed-in page without one is given one.
- **In the page, not a request.** The dashboard's frame is drawn on the server for whoever asked (`src/sift/page-data.ts`), and it carries the device's key beside the session. That page is never kept (`no-store`), and the service worker keeps only pages drawn for everyone. It is a key, not mail: it unlocks only this browser's copy.
- **In the browser**, the key is imported so it cannot be exported and held in memory only. The copy is in IndexedDB, each record's value encrypted with AES-GCM and a random 12-byte IV through WebCrypto. Readable on the disk: ids, times and Gmail's label ids, what the server keeps unencrypted too, which is enough to find the newest 50 inbox conversations and decrypt them first.
- **Signing out** deletes the device's row, so a copy left behind can never be read, answers with `Clear-Site-Data: "storage"`, and the page deletes its database. Removing a mailbox or deleting the account deletes their devices; a device unused for 30 days is deleted and its copy starts again.
- **Unreachable,** the page cannot get its key and shows nothing it holds, as it shows nothing now.
- **Safari** deletes a site's storage after 7 days without a visit unless it is installed to the home screen; the copy starts again. Installed, the page asks for storage that is kept (`navigator.storage.persist()`).

It holds against a lost, stolen or copied disk, another user of the machine, and a device after sign-out. It does not hold against a script injected into the page or malware running as the person while they are signed in: both can read the API now. [security.md](security.md) says so once it is built.

## In the browser

- **TanStack DB** (`@tanstack/react-db`, pinned: it is a release candidate, `1.0.0-rc.1.5`), one collection a kind, each with its own sync function: it fills from the device's copy, says it is ready, then takes the feed (`begin`, `write`, `commit`; `truncate` on a reset). Its own storage is not used: it is not encrypted. Its write handlers call the routes the page calls now and resolve once the copy reaches the write's number; a throw undoes the change. Screens read through `useLiveQuery`.
- **One tab asks.** The tabs pick one with the Web Locks API (`navigator.locks`); it asks the feed, writes the device's copy and hands each reply to the others over a `BroadcastChannel`. Another takes over when it closes.
- **When it asks:** every 30 seconds while the page is visible, when it is returned to, when Sift answers again after being unreachable, and straight after a write. Mail reaches Sift at the minute tick's pace, so asking more often brings little sooner.
- TanStack Query stays for what is read from the server.

## What it costs

- **Requests.** An open Inbox asks about three times a minute now (its list, settings, usage); the feed asks twice. An answer with nothing new is the session and one indexed read.
- **Writes.** One more row written for each record changed, and the counter. Copying 100,000 messages writes 100,000 rows of a key and a number, about 10 MB.
- **A device's first copy.** About 600 bytes a message summary: a 2,000-message inbox is 1.2 MB, about 0.5 MB compressed, once per browser; after that only what changed.
- **The page.** TanStack DB adds about 84 KB compressed to the first load (337 KB now).

These go in [runtime.md](runtime.md#what-it-costs) as they are built.

## Order of work

1. The server: the migration (the counter, the records' numbers, the triggers, `devices`, a sealed preview kept with each message so a summary is not cut from its whole text), `GET /api/sync`, `x-sift-seq` on writes, the device key in the frame and its end at sign-out. Tests: two people; writes at the same moment; a conversation leaving the inbox; a cursor too old; the rekey marking nothing.
2. The browser: the encrypted copy, the one tab that asks, the collections, and Inbox and the reader on them, against a stand-in feed until the server's lands.
3. For review on the copy.
4. Remove what it replaces: each screen's polling, and what the server answered only for lists the copy now draws.

## Sources

- Fastmail: [offline architecture](https://www.fastmail.com/blog/offline-architecture/), [offline mail storage](https://fastmail.com/blog/offline-mail-storage), [offline sync](https://www.fastmail.com/blog/offline-sync/); JMAP [RFC 8620](https://www.rfc-editor.org/rfc/rfc8620.html) and [RFC 8621](https://www.rfc-editor.org/rfc/rfc8621.html); IMAP's CONDSTORE and QRESYNC, [RFC 7162](https://www.rfc-editor.org/rfc/rfc7162.html).
- Linear: [rebuilding the delta sync read path](https://linear.app/blog/rebuilding-delta-sync-read-path), and [a reverse-engineered account](https://github.com/wzhudev/reverse-linear-sync-engine).
- Replicache: [backend strategies](https://doc.replicache.dev/strategies/overview), [per-space version](https://doc.replicache.dev/strategies/per-space-version); Postgres on [why a sequence is not commit order](https://www.postgresql.org/message-id/30939.1465743698%40sss.pgh.pa.us).
- Proton Mail's web client: [persisted sessions](https://github.com/ProtonMail/WebClients/blob/main/packages/shared/lib/authentication/persistedSessionHelper.ts), [its client key](https://github.com/ProtonMail/WebClients/blob/main/packages/shared/lib/authentication/clientKey.ts), [encrypted search](https://proton.me/blog/engineering-message-content-search).
- The browser: [non-extractable keys on disk](https://lists.w3.org/Archives/Public/public-webcrypto-comments/2015Feb/0037.html), [`Clear-Site-Data`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Clear-Site-Data), [WebKit's storage limits](https://webkit.org/tracking-prevention/).
- TanStack DB: [its docs](https://tanstack.com/db/latest/docs).
