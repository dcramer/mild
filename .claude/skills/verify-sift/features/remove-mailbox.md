# Remove a mailbox, delete the account

A person removes one of their mailboxes, or deletes their whole account, from Settings. Either is confirmed by typing the address. Mild revokes its Gmail access at Google, then deletes everything it recorded about that mail. The person's labels and rules stay for their other mailboxes, and the Gmail filters it wrote and its labels on mail stay in Gmail; the confirm says both.

## Sub-features

- `remove-mailbox` is the trash can on a mailbox's row, then typing its address. Removing the one signed in as signs out.
- `remove-last`: on a person's only mailbox the trash can is disabled, and hovering it says `You cannot delete your only remaining mailbox.` The account is deleted from its own row.
- `delete-account` is `Delete account…` under Your account, then typing the primary address, which the dialog names.
- `delete-handover` is the earliest person left becoming the owner when the owner deletes their account.
- `primary-handover`: the `Primary mailbox` select under Mailboxes (shown with two or more) names who the account is, and the account menu shows it. Removing the primary one hands it to the one connected longest.

## How to get to it (user POV)

- Settings (the account menu, `Account, me@example.org`, then `Settings`; or `?settings=1`), Mailboxes: the trash can on a row.
- Settings, Your account: `Delete account…`.

## Driving it with verify.sh

Preconditions:

- Fresh seed. Settings lists `me@example.org` (signed in as this one, and the primary) and `me@work.example.org`.

- **Remove a mailbox.** `ab open "$B/?settings=1"`, then `ab find role button click --name "Remove me@work.example.org"`. A dialog `Remove me@work.example.org?` says your labels and rules stay, and the filters and labels stay in Gmail; `Remove mailbox` is disabled. `ab find role textbox fill --name "Type me@work.example.org to confirm" "me@work.example.org"`, then `ab find role button click --name "Remove mailbox"`. Settings stays open, with no toast: Mailboxes lists only `me@example.org`, whose trash can is disabled (`You cannot delete your only remaining mailbox.`), and `Primary mailbox` is gone. The account menu no longer has its `Mailbox` group (`All mailboxes` and each address).
- **Hand on the primary.** On a fresh run, choose `me@work.example.org` in `Primary mailbox` (`ab find role combobox click --name "Primary mailbox"`, then the option); the account menu button becomes `Account, me@work.example.org`. Removing `me@work.example.org` makes `me@example.org` primary again, and the select goes, with one mailbox left.
- **Stored.** `verify.sh sql "$RUN" "SELECT id FROM accounts ORDER BY id"` returns `bravo@example.net`, `me@example.org`; `SELECT id FROM accounts WHERE \"primary\"` both of them. `SELECT count(*) AS n FROM labels WHERE user_id = 1 AND removed_at IS NULL` is still `11` and `SELECT count(*) AS n FROM rules WHERE user_id = 1` still `4`: they are the person's, not the mailbox's. `jq -c '[.grants[][1].address]' "$RUN/google.json"` no longer has `me@work.example.org`: its sign-in was revoked at the fake Google.
- **Delete the account.** `ab find role button click --name "Delete account…"`, a dialog `Delete your account?`; type `me@example.org` into `Type me@example.org to confirm` (only the primary address enables it), `ab find role button click --name "Delete everything"`. The page goes to the sign-in screen: `Your inbox, without the pesky salespeople.` and `Sign in with Google`.
- **Stored.** `SELECT id, owner FROM users` returns only Bravo's, owner `true`. `SELECT count(*) AS n FROM messages` is `0` and `SELECT count(*) AS n FROM credentials` is `1`, Bravo's Gmail sign-in. `curl` with the old cookie to `/api/manage` answers 401.

## Gotchas

- Delete the account last: it ends the run's session, and Bravo cannot be signed in to, so nothing after it can be driven. `down` and `up` a new run to go on.
- Removing calls Google's revoke endpoint for the mailbox's stored sign-in; here the fake Google answers it inside the app's server, so nothing leaves the machine. Revoke never fails here, so `Mild still has access at Google` is not shown.
- `actions` stays `0`: removal changes no mail or filter in Gmail.
