# Security

How Sift keeps one person's mail from anyone else. Decided 2026-11-15 for Sift on Postgres, hosted (Vercel) or run locally, and changed 2026-11-16 (below: not end to end). Every change is held to it. Where the code does not do something yet, this says so; the plan is in TODO.md.

## Hold as little as possible

Everything stored or sent anywhere (a column, a log line, telemetry, what the model provider is sent) has a reason, a lifetime and a form from the table below; anything without a reason goes. Message text and HTML are kept in two places only: mail the person answered for, until they delete it or for a year, and the text of mail waiting on them, until they answer it and for at most 30 days.

## What is stored, and how

| What | Stored as | Who can read it |
| --- | --- | --- |
| Message text and HTML, subjects, sender names, recipients, stored headers | Encrypted with the install's key, bound to the person, the message and the part | The server |
| Credentials: Gmail refresh tokens, model sign-ins | Encrypted with the install's key, bound to the person and what each is for | The server, which uses them while the person is away |
| Sender addresses and domains, list ids, wherever they are kept (mail records, rules, cached correspondents) | Plain. To come: a keyed hash per person for lookups, and an encrypted copy for showing and for Gmail filters | The server |
| What the person writes or Sift decides: rules (apart from their addresses), labels, actions, conditions in their own words, decisions and outcomes, times, costs | Plain | The server. Conditions and label descriptions are read on every pass, to be given to the model |

**Encrypted** is AES-256-GCM under the install's key, through `src/secrets.ts` ([SECRETS.md](SECRETS.md)). The person, message and part are the associated data, so a value moved into another row, or read through another person's handle, does not open.

**The install's key** is `SIFT_KEY` locally, or the platform's key service when hosted. It is never in the database or the repository.

**Keyed hash** means an HMAC with a key derived for the person from the install's key (HKDF of the key and the person's id). Addresses are lowercased first. A plain hash would not do: addresses are guessable, and a list of them could be hashed and matched. With a key per person the same sender hashes differently for each person, so the database does not show that two people hear from the same sender. Lookups are by exact address or domain.

## Not end to end

Decided 2026-11-16: mail is not sealed to a key only the person's browser holds (a key pair unlocked by a passkey was considered). Sift reads stored mail while the person is away: the model is shown their earlier answers when it judges new mail, test runs replay them, and search reads subjects and names. Sealing would end all of that. It would also protect less than it seems, because the server holds a Gmail token that reads the whole mailbox.

## Keeping people apart

1. **The application's own checks** are the guard. Every query runs through the per-person handle (`store.user(id)`, through the signed-in person's `open(id)`), and every table of a person's data carries the person's id in its keys and foreign keys, so no row can point at another person's. A test runs every dashboard route as two people.
2. **Row-level security** is defence in depth: the one check the database enforces itself. Every such table is `FORCE ROW LEVEL SECURITY` with a policy on the person's id, set per transaction by the handle. Sift connects as a role that owns no table and cannot bypass the policies; migrations run as another (`DATABASE_MIGRATION_URL`). With that set, Sift refuses to run as a role that is or can become a superuser, a role with BYPASSRLS or a table's owner; without it, Sift runs as the owner and warns at start. PGlite, locally, runs as its superuser inside Sift's own process, where there is no other role to connect as and anyone who could run a statement could read its folder. A test fails when a table has no policy.
3. **Encryption** limits what a leaked database or backup reveals without the key: addresses, labels, rules and decisions, but no message content or credential. A row that reaches another person's handle does not decrypt there.
4. **The host's own** encryption at rest and TLS on every connection.

## What it does not cover

- **A leak with the key.** The database and `SIFT_KEY` together open everything stored, including the Gmail token.
- **A server under someone else's control.** It holds the key and the credentials, and a Gmail token reads the whole mailbox.
- **Mail while it is being classified.** Sift reads it from Gmail, and the model provider is sent what the model needs.
- **Mail being read in the dashboard.** A message shown as its HTML passes through the server on its way to the browser, like the rest of the page's data. The browser shows it in a sandboxed frame that runs no script and loads nothing from anywhere, so opening it tells no sender it was read.

## What follows from it

- The server's own logs may name a mailbox, never a sender.
- Nobody running Sift reads a person's mail, and no tool is built that would show it (Google's Limited Use).
- Removing a mailbox or deleting a person is one statement that takes every row of theirs, by cascading keys a test holds every table to; their Gmail access is revoked at Google first. Backups keep them no longer than the stated retention.
- A session names the person as well as the mailbox, so a session for an address that was removed and connected again by someone else opens nothing.

## Now

Done: one Postgres database (PGlite locally); every person's table carries `user_id` in its keys and foreign keys and has a forced row-level security policy; every query is built on the session's `open(id)` handle, whose builder adds the person to every read, join, change and delete and sets them on every insert, and runs as `sift_app` with the person set; tests check each table's policy, that people cannot reach each other's rows, and that the builder keeps them apart with row-level security switched off. Credentials and message content are encrypted with `SIFT_KEY` ([SECRETS.md](SECRETS.md)), and once it is set a plain one is refused, so none can be planted in a person's place. A model provider's error is recorded as its status and kind, never its text, which can quote the request. Not yet: keyed hashes of addresses.
