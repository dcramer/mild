# Inbox

Sift's dashboard was built to answer what Sift could not decide. Inbox makes it the place to read and handle mail too, with what Sift knows about each message beside it: its label, how sure it is, the sender's standing, and rules. It is optional. Turned on, Sift keeps a copy of all mail in the inbox, not only what waits on the person, and asks Google for leave to send as them.

## What it is for

- Reading and answering mail as fast as in Gmail: a list, a reader, a composer, keys for everything.
- Seeing mail the way Sift sees it: every row says what Sift thinks it is, and the list narrows by that.
- Correcting Sift where you read, not on a separate screen: the reader is the message panel, with the answer and the ways to make a rule in its side column.

## The frame

On a desktop the sections move from the masthead to a slim column on the left (`Rail`, `web/src/system/rail.tsx`): the wordmark at its top, then one icon per section with its name under it (For review, Inbox, Activity, Labels, Rules), the current one marked in the highlighter. For review carries how many wait. At its foot: Sift's line (sync and cost, opening the same card as before), the mailbox switcher, and the avatar's menu: the switcher sits with the account whose mailboxes it chooses between, under the line, which stays for all of them. The page title sits at the top of the page, where the masthead was, and a `Notice` over it.

On a phone nothing moves from the bar and menu, which gain Inbox and the switcher.

## Mailboxes

A person may have several Gmail accounts connected. Everywhere a list shows mail, it is every mailbox's, unless the switcher at the foot of the rail narrows it to one. The choice is the reader's convenience, kept in the browser, and sent with every request as `mailbox` (`narrow`, `src/dashboard/scope.ts`). A row says which mailbox its mail is in only while the switcher shows all of them and there is more than one.

The composer has its own From, starting on the narrowed mailbox, or the one a reply's message came to.

## The list

Inbox lists conversations, newest first, under the same periods as For review. A row: who (the senders of the conversation, the reader's own name as "me"), how many messages, the subject and the start of the newest text, what Sift thinks it is (a `Meter` and the label), and when. Unread is in bold. Rows select with a check; selected rows get Archive, Mark read and Mark unread, and Label.

Keys, as Gmail's: J and K move, O or Enter opens, E archives, X selects, Shift+I and Shift+U mark read and unread, R replies, A replies to all, F forwards, C writes a new message, / searches, Z undoes.

## Sift's controls

What Sift adds to an inbox, in the order it costs:

1. **What it is.** Every message Sift decided has a label and a sureness. The list filters by label and by sureness (Sure, Needs you), and the views at the end of the bar are Everything, Needs you (what Sift would leave in the inbox or could not place) and Sorted (what it would move out).
2. **Ask.** Words typed into the search that are not a search ("invoices from vendors this month") become a filter through the rule drafter's model, shown as the filter it made, which the reader can change. One model call a question; nothing is sent to the model but the words and the sender lookups the drafter already makes.
3. **Understand.** In the reader, Summarize asks the model what a long conversation says and what it wants of the reader. One call a press, shown with its cost in the history.

The model only reads. It never sends, drafts or replies, and is given no tool that does.

## The reader

One message panel for every list. Inbox opens a conversation: its messages oldest first, each folded to its sender and first line but the newest, which is open. The side column is the same as For review's: the answer, Sift's reason, the sender, what Sift saw, history. Reply, Reply all and Forward sit in the panel's footer.

## The composer

A panel of its own, from C or the rail's Compose, or under the message in the reader for a reply: From (when there is more than one mailbox), To, Cc, Subject, the text. Plain text only. Sending goes through the executor like every other mailbox change: written to the record first, then sent, then checked. An unsent draft is kept in the browser.

## Turning it on

Settings has Inbox, off by default. Turning it on says what it changes (Sift keeps all inbox mail, and can send as you), then sends the person through Google once more to give Sift `gmail.send` and leave to read full messages. Turning it off deletes what Sift kept for it, and Sift stops sending.

## Data

Inbox is off until the person turns it on (`preferences.mail`, `POST /api/mail/on`, `mail` in `/api/manage`).

| | Where | While |
| --- | --- | --- |
| What is in the inbox now, and what is unread | `messages.label_ids`, kept from Gmail's history by every sync (`followLabels`, `src/store/messages.ts`); `messages_inbox` lists it newest first, `messages_thread` finds a thread | Always, for everyone. Stale for what changed while the history cursor had expired |
| The whole text and HTML of inbox mail | `mail_bodies`, sealed like `suggestion_bodies` (`src/store/content.ts`) | Inbox is on. Turning it off deletes every row in the same write |
