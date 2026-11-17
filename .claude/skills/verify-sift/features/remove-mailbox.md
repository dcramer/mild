# Remove a mailbox, delete the account

A person removes one of their mailboxes, or deletes their whole account, from Settings. Either is confirmed by typing the address. sift revokes its Gmail access at Google, then deletes everything it recorded about that mail. The Gmail filters it wrote and its labels on mail stay in Gmail, and the confirm says so.

## Sub-features

- `remove-mailbox` is the trash can on a mailbox's row, then typing its address. Removing the one signed in as signs out.
- `remove-last`: on a person's only mailbox the trash can is disabled, and hovering it says `You cannot delete your only remaining mailbox.` The account is deleted from its own row.
- `delete-account` is `Delete account…` under Your account, then typing one of their addresses.
- `delete-handover` is the earliest person left becoming the owner when the owner deletes their account.

## How to get to it (user POV)

- Settings (`?settings=1`), Mailboxes: the trash can on a row.
- Settings, Your account: `Delete account…`.

## Driving it with verify.sh

Preconditions:

- Fresh seed. Settings lists `me@example.org` (signed in as this one) and `me@work.example.org`.

- **Remove a mailbox.** `ab open "$B/?settings=1"`, then `ab find role button click --name "Remove me@work.example.org"`. A dialog `Remove me@work.example.org` says the filters and labels stay in Gmail; `Remove mailbox` is disabled. `ab find role textbox fill --name "The address" "me@work.example.org"`, then `ab find role button click --name "Remove mailbox"`. Mailboxes lists only `me@example.org`.
- **Stored.** `verify.sh sql "$RUN" "SELECT id FROM accounts ORDER BY id"` returns `bravo@example.net`, `me@example.org`. `SELECT count(*) AS n FROM labels WHERE account_id = 'me@work.example.org'` is `0`.
- **Delete the account.** `ab find role button click --name "Delete account…"`, type `me@example.org` into `The address`, `ab find role button click --name "Delete everything"`. The page goes to the sign-in screen, which here reads `No Google client yet.` (the harness has no Google client).
- **Stored.** `SELECT id, owner FROM users` returns only Bravo's, owner `true`. `SELECT count(*) AS n FROM messages` is `0` and `SELECT count(*) AS n FROM credentials` is `0`. `curl` with the old cookie to `/api/manage` answers 401.

## Gotchas

- Delete the account last: it ends the run's session, and Bravo cannot be signed in to, so nothing after it can be driven. `down` and `up` a new run to go on.
- With a Gmail token stored, removing calls Google's revoke endpoint; the seed stores none, so nothing leaves the machine.
- `actions` stays `0`: removal changes nothing in Gmail.
