# Write and send mail

With Inbox on, the person writes new mail in a panel over whatever is open, and replies and forwards in the reader at the foot of the conversation, from any of their addresses Google lets Mild send from, and Mild sends it as them. What they have written is kept in the browser until it goes or they discard it.

## Sub-features

- `compose-new` opens a new message with C or the rail's `Compose`, from the mailbox the account menu's `Mailbox` shows (the primary one for All mailboxes).
- `compose-addresses`: To, and Cc and Bcc once their buttons add them, turn each address into a chip at a comma, `;`, Enter, Tab or leaving the field. One that is not an address stays as a chip named `<it>, not an address`, with `“<it>” is not an address.` under the field, until it is pressed (back to text) or removed (`Remove <it>`).
- `compose-suggest`: typing in an address field suggests people the person knows, as options (`Ada Lovelace` / `ada@example.org` for `lovel`); senders who only mail in bulk are left out.
- `compose-files`: `Attach files` adds files, listed under the text as `Attachments`, each with `Remove <file>`; `Send` waits while one is uploading. A forward carries the message's own files.
- `compose-send` sends with `Send` or Ctrl+Enter (⌘↵ on a Mac), then says `Sent` over the subject in a toast.
- `compose-draft` keeps what is written through closing and reloading; `Discard` drops it, with a `Draft discarded` toast and `Undo Z`.
- `compose-grant` says Mild can’t send from a mailbox yet, with nothing to write in, and offers `Let Mild send`.
- `compose-reply` answers a message from the mailbox it came to, the newest or any other of its conversation; sent from the reader, it joins the conversation there, open.
- `compose-forward` sends a message on as new mail, `Fwd: ` and its subject, quoted under what is written.

## How to get to it (user POV)

- Any screen, C, or `Compose` in the rail (desktop); on a phone, `Compose` in Inbox's header.
- The reader (Inbox, a conversation open), under the conversation: `Reply` (R), `Reply all` (A), `Forward` (F), which open the reply in their place, on the newest. On a phone those three are not drawn: the bar along the bottom has `Reply`, and each message's `Reply all, forward and more` the others. On any open message's head: `Reply to <sender>`, and `Reply all, forward and more`, a menu (Reply all, Forward, and Show as text where Mild holds the HTML). The address alone opens one too: `?message=<id>&compose=reply` (or `all`, `forward`), with `&answering=<id>` for another message of the conversation.

## Driving it with verify.sh

Preconditions:

- A run started with `verify.sh up "$RUN" --inbox`: Inbox on, Google letting Mild send from `me@example.org` (as itself or `me+lists@example.org`), not from `me@work.example.org`. `/` is Inbox (`/inbox`).

- **Open.** `ab open "$B/inbox"`, wait for the rows, `ab press c`. A dialog `New message`: combobox `From` (`me@example.org`), combobox `To` focused, buttons `Cc` and `Bcc`, `Subject`, `Message`, `Attach files`, `Discard`; `Send` disabled.
- **Addresses.** `ab keyboard type "lovel"`: the option `Ada Lovelace` (`ada@example.org`). `ab press ArrowDown`, `ab press Enter`: a chip `Ada Lovelace`. `ab keyboard type "nope"`, then click `Subject`: `“nope” is not an address.` under To and a chip `nope, not an address`. `ab find role button click --name "Remove nope"` clears it. `ab find role button click --name "Bcc" --exact`, `ab keyboard type "grace@example.net"`, `ab press Tab`.
- **Draft.** Fill `Subject` and `Message`, `ab reload`: the same dialog with the same chips and words (`?compose=new`).
- **Send.** Click `Message`, `ab press Control+Enter`. The dialog goes, a toast says `Sent` over the subject. Gmail holds it in `me@example.org`, labelled `SENT`, with `Bcc: grace@example.net` (`jq -r '.mailboxes[0].messages[] | select(.labelIds == ["SENT"]) | .raw' "$RUN/google.json"`, the last being it; the first is the seed's `s1`); `SELECT id, thread_id, label_ids, decided FROM messages WHERE label_ids = '["SENT"]'` is the id Gmail gave it, its own thread, `["SENT"]`, `true`, `mail_bodies` has its text, and `actions` has one `send`, `done`.
- **From the reader.** `ab open "$B/inbox?message=m6&thread=t6"`, wait for `Reply all A`, `ab press r`: the region `Reply` under the conversation, From `me@example.org` whatever the menu shows, a chip `Ada Lovelace`, no Subject, `Message` focused, and `&compose=reply` in the address. Type, `ab press Control+Enter`: `Sent` over `Re: Lunch on Thursday?`, the reader stays, and under Ada's message an open one from `me`; after `Escape`, Inbox's row is `Ada, me 2`. Gmail's copy is in thread `t6` with `In-Reply-To: <thursday@example.org>`.
- **An earlier message.** `ab open "$B/inbox?message=m11&thread=bills"`: the three bills, open (unread). Three buttons are named `Reply to Utility`, one a bill; the first takes May's (`m13`): the region `Reply` at the foot, `Replying to Utility, <time>` over its fields, and `&compose=reply&answering=m13` in the address, which a reload keeps. Sent, Gmail's copy has `Subject: Re: Your May bill` and `In-Reply-To: <may@utility.example.net>`.
- **Forward, with a file.** `ab open "$B/inbox?message=m7&thread=t7"` (Grace's `Notes from the review`), `ab press f`: the region `Forward`, To focused and empty, Subject `Fwd: Notes from the review`, Message starting with two empty lines then `---------- Forwarded message ---------`, and `Attachments` holding `review-notes.pdf`. Type `ada@example.org`, Tab, `Send`: Gmail's copy carries `review-notes.pdf`, has no `In-Reply-To` and a thread of its own.
- **Grant.** After the drafts above are sent or discarded: `ab find role button click --name "Account, me@example.org"`, `ab find role menuitemradio click --name "me@work.example.org" --exact`, `ab press c`: `Mild can’t send from me@work.example.org yet` with `Let Mild send` (`/auth/login?grant=send&mailbox=me%40work.example.org&to=<this page, encoded>?compose=new`), From, and no To, text or `Send` until From is an address Mild may send from.

## Gotchas

- With Inbox off (any other seed) there is no `Compose`, C does nothing, and `?compose=new` opens nothing.
- A kept new-message draft keeps its From, so the composer reopens on it: the grant shows only for a draft started on the work mailbox.
- `?message=<id>&compose=reply` without `&thread=` opens the reply on that message alone, with no conversation above it.
- `Let Mild send` goes to Google, which cannot be reached here.
- The fake Gmail sends nothing on: what it was asked to send stays in `$RUN/google.json`, labelled `SENT`.
