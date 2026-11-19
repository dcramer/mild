# Write and send mail

With Inbox on, the person writes new mail and replies in a panel over whatever is open, from any of their addresses Google lets Sift send from, and Sift sends it as them. What they have written is kept in the browser until it goes or they discard it.

## Sub-features

- `compose-new` opens a new message with C or the rail's `Compose`, from the mailbox the switch shows (the primary one for All).
- `compose-addresses` checks each address in To and Cc once the reader has moved past it.
- `compose-send` sends with `Send` or Ctrl+Enter (⌘↵ on a Mac), then says `Sent` in a toast.
- `compose-draft` keeps what is written through closing and reloading; `Discard` drops it, with Undo.
- `compose-grant` says Sift may not send from a mailbox yet, and offers `Let Sift send`.
- `compose-reply` answers a message from the mailbox it came to.

## How to get to it (user POV)

- Any screen, C, or `Compose` in the rail (desktop).
- An open message's reply (the reader, once built); for now its address: `?message=<id>&compose=reply` (or `all`).

## Driving it with verify.sh

Preconditions:

- A run started with `verify.sh up "$RUN" --inbox`: Inbox on, Google letting Sift send from `me@example.org` (as itself or `me+lists@example.org`), not from `me@work.example.org`.

- **Open.** `ab open "$B/"`, wait for the rows, `ab press c`. A dialog `New message`: `From` (`me@example.org`), `To` focused, `Cc`, `Subject`, `Message`; `Send` disabled.
- **Addresses.** `ab keyboard type "ada@example.org, nope"`, then click `Subject`: `“nope” is not an address.` under To. `ab find role textbox fill "Ada <ada@example.org>" --name "To"` clears it.
- **Draft.** Fill `Subject` and `Message`, `ab reload`: the same dialog with the same words (`?compose=new`).
- **Send.** Click `Message`, `ab press Control+Enter`. The dialog goes, a toast says `Sent` over the subject. `cat "$RUN/sent.json"` holds it, `mailbox` `me@example.org`; `SELECT id, thread_id, label_ids, decided FROM messages WHERE id LIKE 'sent%'` is `sent-1`, `["SENT"]`, `true`, and `mail_bodies` has its text.
- **Grant.** Switch the mailbox to `me@work.example.org`, `ab press c`: `Sift may not send from me@work.example.org yet` with `Let Sift send` (`/auth/login?grant=send&mailbox=…&to=/?compose=new`), `Send` disabled.
- **Reply.** `ab open "$B/?message=m6&compose=reply"`: `Reply` over Ada's `Lunch on Thursday?`, `Re: Lunch on Thursday?` under it, From `me@example.org` whatever the switch shows, To `Ada Lovelace <ada@example.org>`, no Subject. Sent, `sent.json` has `threadId` `t6` and `In-Reply-To: <thursday@example.org>`.

## Gotchas

- With Inbox off (any other seed) there is no `Compose`, C does nothing, and `?compose=new` opens nothing.
- `Let Sift send` goes to Google, which cannot be reached here.
- The stand-in Gmail sends nothing: `sent.json`, beside `gmail.json`, is the only place sent mail goes.
