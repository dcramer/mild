# Sync

Built for Inbox: its list and the reader's conversation are drawn from the copy. For review, labels, rules and settings still read the server as [architecture.md](architecture.md#dashboard) describes, until each moves onto it.

The dashboard keeps a copy of the person's mail in the browser, encrypted, and draws the screens from it. The server sends what changed since the copy was last brought up to date. A screen opened, a conversation opened, J and K, a filter changed or a press made waits on nothing; the network only reconciles.

The shape follows what mail clients built for this do: Fastmail's offline web client on JMAP (a counter per account, "changes since", a fresh start when a cursor is too old, the inbox's listing worked out from what is held), Linear's sync engine (a write confirmed when the client has applied the log through its number), and Proton Mail's web client for the device's key (held by the server, released to a live session). Sources are at the end.

## What the page holds

The window is:

- every conversation with a message in the inbox now, all its recorded messages with it;
- labels, rules, proposals, and the person's settings and mailboxes (what `/api/manage` reads);
- For review's rows, in a later step: until then they are kept with the frame (below), drawn from the device and asked of Mild again.

It is the person's, across all their mailboxes; the mailbox switch narrows it in the browser. Inbox's views, its label and unread filters, the period headings, "3 of 19", previous and next are worked out from it.

Outside the window the page asks the server, as now: a search, Ask, archived and sent mail a search finds, Activity, Contacts, a sender's and a domain's page, usage, a rule's figures. Those reads no longer poll: each reloads when the feed says a kind it is built from changed.

The copy fills in stages: conversations newest first, then the text of the newest 30 inbox conversations' newest messages, then the text of the conversations either side of the one open, and any other as it opens. Inbox says it is empty only once the whole window has arrived, never while it is still filling.

A message's HTML is still a frame loaded from the server under its own policy (`FRAME_POLICY`, `src/dashboard/policy.ts`). The text is held, so a message opens on its text if the frame has not loaded yet.

## Records

A conversation is one record, `SyncedConversation` (`src/dashboard/types/mail.ts`): its recorded messages, oldest first, each as Inbox and the reader's folded rows show it (sender's name and address, subject, preview, when, Gmail's label ids), and what Mild thinks of its newest (the current decision, or the person's answer where they gave one; the label by its id, named from the person's labels so renaming one changes no conversation). It is one record because an archive in Gmail that takes its last message out of the inbox takes all of it out of the window, including messages that did not change.

A message's text is not in the feed: the reader reads it with the rest of the message (`GET /api/message`), ahead of a press that opens it. Labels, rules, proposals and settings stay server reads for now (Settings' data is kept with the frame, `web/src/lib/device.ts`); each gets a kind of its own in the feed when a screen needs it.

What is `held` in a reply is `held` in these too, and the page draws it through `reveal` as before.

## The feed

`GET /api/sync?since=<cursor>` (`syncPage`, `src/dashboard/queries/sync.ts`) answers `SyncPage`:

```
{ cursor, reset, more, mailboxes, conversations: [{ accountId, threadId, conversation }] }
```

- `conversation` null: gone, or out of the window.
- `reset` true: drop everything held first, then take what follows, with the pages after it, as the whole window, newest first, 200 conversations a page. The page gets it with no cursor, with one it cannot read or of an older shape (`SHAPE`: a cursor carries the version of what a record holds), with one older than `purgedThrough`, and with one ahead of the counter (a database restored from a backup).
- After that, the conversations changed since the cursor, in the order they changed, at most 500 a reply, each read whole at the time of the request, so one changed several times comes once.
- `more` true: ask again at once from the new `cursor`.
- `mailboxes`: the person's mailboxes. Removing one deletes its mail by cascades from the central handle, where nothing is marked, so the page drops any conversation of a mailbox not listed.

Behind it:

- **One counter per person** (`sync_heads`). Triggers (`0073_conversations_sync_triggers.sql`) mark a conversation whenever a message of it is recorded, forgotten, or changes its labels or headers, and whenever a decision, an answer or kept text of one of its messages is written or deleted, giving it the next number (`conversation_changes`, one row a conversation). Triggers, so no write path can forget it. A write through the central handle marks nothing.
- **Numbers in the order they commit.** The trigger takes the next number by updating the person's counter row, which stays locked until the write commits, so a page that has seen 12 has seen everything before it. A Postgres sequence would not do: it can give 12 to a write that commits before the one given 11, and a page that read in between never sees 11. The lock holds the person's writes one after another; Mild's transactions wait only on the database, so this costs little.
- **Gone is remembered 30 days.** Upkeep drops the row of a conversation with no message left 30 days after it went (`pruneGone`, `src/store/changes.ts`) and moves `purgedThrough` past its number: a cursor older than that gets a reset, never an answer missing that it went.
- **Turning Inbox on or off** changes which conversations the window holds without changing any, so it moves `purgedThrough` to the counter: every page starts again.
- **A preview is kept with the text** (`mail_bodies.preview`, sealed), so a page of 200 conversations never opens their whole text; the pass that indexes text kept before there was a search index gives such text its preview too (`indexKept`).
- **A new key** rewrites every record's headers, which marks every conversation: each page reads them all again once.

## Writes

Every write's reply carries the person's counter after it, in a header (`x-sift-seq`), set in `src/dashboard/server.ts` for every write route. The page shows the change at once, sends it, and the change is done when the copy has been brought up to that number: the page asks the feed straight away. A refusal or a failure undoes the change on the page and says why, as now. Nothing is queued while Mild is unreachable.

## On the device

Proton Mail's web client keeps a random key on the server for each session and releases it only to that session, so what is on the disk cannot be read without a live sign-in. Mild did the same until 2026-11-21, when the key moved onto the device: released by the server, every opening of the page waited on it, and an installed app that waits on the network is not instant.

- **A key per browser.** A random 256-bit key kept as one of the person's sign-ins (`credentials`, kind `device`), sealed through `src/secrets.ts` like the others, so the rekey covers it, and an HttpOnly cookie, `sift_device`, naming it for 400 days, the most a browser keeps one. The page makes it the first time (`POST /api/device`, answered in `src/dashboard/sign-in.ts`) and asks for it again (`GET /api/device`) only when it has none.
- **Kept on the device.** The page imports it so no script can read it out (non-extractable) and keeps it in IndexedDB (`sift-device`, `web/src/lib/device.ts`), with the frame's data beside it: the session, Settings' data, usage, and For review's list with the rules Mild proposes (`suggestions-false`), which Inbox draws above its rows, each sealed under the key with the build that kept it. Every page is drawn the same for everyone and the service worker serves it at once, so the page opens with no request: the frame from what it kept, the inbox from the copy, then each is asked of Mild and kept again. Another build's frame is not drawn, since it may not be what this build reads: after an update the page waits on Mild, once.
- **Wiped**, key, frame, copy and outbox, at sign-out, once what waits in the outbox has been sent (up to 5 s); when Mild says nobody is signed in (the session ended, here or by removing the person's mailbox or account, or expired); and when Mild no longer knows the device (its key removed, or the cookie gone), which then makes a new one. Only what was kept before the page opened is wiped that way: a session read before this page's first key was made says the same of a new device. Reload, where a page failed to draw, drops the frame alone, which may be what failed.
- **In the browser**, the copy is in IndexedDB, each record's value encrypted with AES-GCM and a random 12-byte IV through WebCrypto. The outbox is in IndexedDB too (`sift-outbox`), each press sealed the same way, with its id, its time and the tab that made it readable. Readable on the disk: ids, times and Gmail's label ids, what the server keeps unencrypted too, which is enough to find the newest 120 inbox conversations and decrypt them first.
- **Signing out** also deletes the device's key on the server and answers with `Clear-Site-Data: "storage"`. Deleting the account deletes every key with it.
- **Unreachable,** the page still opens on what this device kept.
- **Safari** deletes a site's storage after 7 days without a visit unless it is installed to the home screen; the copy starts again. Installed, the page asks for storage that is kept (`navigator.storage.persist()`).

It holds against another person using the machine under their own account, and against a device after sign-out or once Mild has forgotten it. It does not hold against someone with this browser's files while the person is still signed in on it: the key is there with the copy, so a lost, stolen or copied disk reads the copy with no session, as the frame would show it. Nor against a script injected into the page or malware running as the person. [security.md](security.md) lists it.

## In the browser

All of it is `web/src/lib/copy.ts`.

- **TanStack DB** (`@tanstack/react-db`, pinned: it is a release candidate, `1.0.0-rc.1.5`). One collection, `conversations`, with a sync function of its own: it fills from the device's copy, newest first, says it is ready once the first 120 are in (more than Inbox draws at first, so the rest, all older, leaves its rows alone), decrypts the rest once the page is idle, so that waits on Inbox's first rows and not the other way round (or, with nothing on the device, says it is ready once the whole copy has arrived), then takes the feed (`begin`, `write`, `commit`; a reset is a transaction with `snapshot: true`). Changes go in 500 at a time, newest first, the page drawing between: 5,000 in one transaction held it for 600 ms. Each batch waits for the one before, and the rest read from the disk leaves out what the feed or another tab has changed since it began, and all of it once the feed has started the copy again, so it never lands over a newer change. Its own storage is not used: it is not encrypted. Started as the page's code loads where this browser last found Inbox on (`startsOnInbox`), while React is still starting, and otherwise as the dashboard is drawn while Inbox is on, so it is there before Inbox is opened. Inbox draws its first 30 rows at once and the rest of its hundred behind them, deferred.
- **Inbox's list** is a live query on it (`useLiveQuery`, `web/src/views/inbox.tsx`): the views, the label and unread filters and the mailbox switch narrow it in the browser. A search, or what Ask made of one, still asks the server, which alone holds what is outside the inbox and the index. The list says the inbox is empty only once the whole copy is here (`useWhole`). Its query is kept 30 minutes once nothing shows it, so going back from the reader draws it as it was.
- **The reader** takes a conversation the copy holds from it, and draws it at once: the subject, each message's sender and when it came, and Archive and Mark unread (`Arriving`, `web/src/views/reader.tsx`). Only the text and Mild's row wait for the message itself (`/api/message`), which is read ahead once the pointer or the keys rest on its row (`readAheadOnRest`, 200 ms, one row at a time and never under the loading bar, so passing over rows asks the server nothing), and for the conversations either side of the one open.
- **Presses** go through an outbox (`web/src/lib/outbox.ts`), as a mail app's do, so none is lost and none waits on the network to show. A press is kept on the device before it is sent and shown at once: in the copy (`changeCopied`, a TanStack DB optimistic action, which holds it over whatever the feed brings until Mild has it and the copy holds what Mild did, `caughtUp`), and for a list that is not the copy's, hidden from it (`useOutbox`). Archive, Spam and Block say so with Undo and are held while their toast shows; Undo takes the press back unsent, and anything else that closes the toast sends it, putting the page away included. Read and unread go at once. Mild not reached, a press waits, counted in the masthead's "Mild cannot be reached", and goes when Mild answers again; Mild busy or failing (408, 429, a 5xx), it is sent again after 2, 4, 8 and 16 s; refused, or busy a fifth time, it comes back, undoing what was shown, with a toast saying so (`onOutboxFailed`), as it does when Gmail did not take all of it. A conversation's presses are sent in the order made; another conversation's wait on nothing of its. Sending a press twice is safe, since the executor reads the message's labels first and skips what is done, so a press whose answer was lost is sent again rather than settled some other way. The tab that made a press sends it; one closed before it was sent (Web Locks say which are open; without them, a press five minutes old) is taken by the next tab to look, with an IndexedDB transaction so only one takes it. The tabs tell each other over a `BroadcastChannel`, so a press or an Undo in one shows in the others at once. Every write's `x-sift-seq` is heard by `onWrite` (`web/src/lib/api/client.ts`), which asks the feed at once.
- **One tab asks.** The tabs pick one with the Web Locks API (`navigator.locks`); it asks the feed, writes the device's copy and hands each reply to the others over a `BroadcastChannel`. Another takes over when it closes. A tab that opens while another asks asks once for itself, from where its own copy stands, keeping and handing on nothing: so it is up to date without waiting on that tab, which on a reload is the page going away, and takes the whole copy where the disk holds none yet, since the tab that asks hands on only what changed; and the disk's copy is cleared only when it is under another key, not because another tab has not written it yet.
- **When it asks:** first as soon as the first screen is drawn from the disk, not once the rest is read, which waits on the page being idle; then every 30 seconds while the page is visible, when it is returned to, when Mild answers again after being unreachable, and straight after a write. Mail reaches Mild at the minute tick's pace, so asking more often brings little sooner.
- **Where the browser cannot encrypt** (a plain-HTTP address, where WebCrypto is not offered) nothing is kept on the device: the copy is fetched whole each time the page opens and held in memory.

Measured on verify-sift's seed with Inbox on, 60 ms of network and 150 ms more for each server reply, against the page without the copy: Inbox opened again from 861 ms to 690 ms until its rows show; a conversation opened from 357 ms to 237 ms; J to the next from 272 ms to 88 ms. The dashboard's frame was a Suspense boundary, which React shows no sooner than 300 ms after the page first paints; it blocks now ([architecture.md](architecture.md#dashboard)), and Inbox opened again shows its rows at 129 ms on localhost where it took 407.

With the frame kept on the device (2026-11-21), a reload with the service worker in place and a server that takes a second to answer shows the frame in 194 ms and Inbox's rows in 277; drawn on the server, both waited 1.2 s. At 5,000 messages more (1,768 conversations in the inbox) and the browser's processor slowed four times, as a phone's is, Inbox opened again from the device showed "Nothing is in your inbox" at 830 ms and its rows at 1.2 to 1.5 s, every change the rest of the copy made to the rows Inbox asked for starting their deferred draw again; reading the first 120, drawing 30 of them at once and the rest once the page is idle, it shows them at 550 to 700 ms (2026-11-22). With no service worker (a browser's first visit) it is slower than before: 60 ms of network and 150 ms a reply show the frame in 1.1 s where the server's HTML had it in 376 ms, since it waits on the page's scripts and the device's store.

## What it costs

- **Requests.** An open Inbox asks about three times a minute now (its list, settings, usage); the feed asks twice. An answer with nothing new is the session and one indexed read.
- **Writes.** For each change to a conversation, the counter and its row written again: two small updates. Copying 100,000 messages in 33,000 conversations leaves 33,000 rows of a key and a number, a few MB.
- **A device's first copy.** About 600 bytes a message summary: a 2,000-message inbox is 1.2 MB, about 0.5 MB compressed, once per browser; after that only what changed.
- **The page.** TanStack DB adds about 84 KB compressed to the first load (337 KB now).

They are in [runtime.md](runtime.md#what-it-costs) too.

## Order of work

1. The server. Built: `tests/api/sync.test.ts`, `tests/sync.test.ts`.
2. The browser: the encrypted copy, the one tab that asks, the collection, and Inbox and the reader on it. Built: `e2e/inbox.spec.ts`.
3. For review on the copy.
4. Remove what it replaces: each screen's polling, and what the server answered only for lists the copy now draws.

## Sources

- Fastmail: [offline architecture](https://www.fastmail.com/blog/offline-architecture/), [offline mail storage](https://fastmail.com/blog/offline-mail-storage), [offline sync](https://www.fastmail.com/blog/offline-sync/); JMAP [RFC 8620](https://www.rfc-editor.org/rfc/rfc8620.html) and [RFC 8621](https://www.rfc-editor.org/rfc/rfc8621.html); IMAP's CONDSTORE and QRESYNC, [RFC 7162](https://www.rfc-editor.org/rfc/rfc7162.html).
- Linear: [rebuilding the delta sync read path](https://linear.app/blog/rebuilding-delta-sync-read-path), and [a reverse-engineered account](https://github.com/wzhudev/reverse-linear-sync-engine).
- Replicache: [backend strategies](https://doc.replicache.dev/strategies/overview), [per-space version](https://doc.replicache.dev/strategies/per-space-version); Postgres on [why a sequence is not commit order](https://www.postgresql.org/message-id/30939.1465743698%40sss.pgh.pa.us).
- Proton Mail's web client: [persisted sessions](https://github.com/ProtonMail/WebClients/blob/main/packages/shared/lib/authentication/persistedSessionHelper.ts), [its client key](https://github.com/ProtonMail/WebClients/blob/main/packages/shared/lib/authentication/clientKey.ts), [encrypted search](https://proton.me/blog/engineering-message-content-search).
- The browser: [non-extractable keys on disk](https://lists.w3.org/Archives/Public/public-webcrypto-comments/2015Feb/0037.html), [`Clear-Site-Data`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Clear-Site-Data), [WebKit's storage limits](https://webkit.org/tracking-prevention/).
- TanStack DB: [its docs](https://tanstack.com/db/latest/docs).
