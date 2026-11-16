# Security

How sift keeps one person's mail from anyone else, including the people running it. Decided 2026-11-15 for sift on Postgres, hosted for others (Vercel, Cloudflare) or run locally. Every change is held to it. Where the code does not do something yet, this says so; the plan is in TODO.md.

## Hold as little as possible

Everything stored or sent anywhere (a column, a log line, telemetry, what the model provider is sent) has a reason, a lifetime and a form from the table below; anything without a reason goes. Message text is kept in two places only: mail the person answered for, until they delete it, and the text of mail waiting on them, for at most 30 days.

## What is stored, and how

This is about storage at rest. Plaintext passes through the server at the moment something is made or changed (a message fetched from Gmail, an address the browser sends for a new rule), and is hashed or sealed before it is written.

| What | Stored as | Who can read it |
| --- | --- | --- |
| Sender addresses and domains, wherever they are kept (mail records, rules, cached correspondents) | A keyed hash per person, for exact lookups and grouping, and a sealed copy for showing | The hash: nobody. The copy: only the person's browser |
| Message text, subjects, sender names, recipients, stored headers | Sealed | Only the person's browser |
| Credentials: Gmail refresh tokens, model sign-ins | Encrypted with the server's key, bound to the person and what each is for | The server, which uses them while the person is away |
| What the person writes or sift decides: rules (apart from their addresses), labels, actions, conditions in their own words, decisions and outcomes, times, costs | Plain | The server. Conditions and label descriptions are read on every pass, to be given to the model |

**Sealed** means encrypted to the person's own public key. The server can seal whenever it holds plaintext; it can never open what it sealed. The private key exists in usable form only in the person's browser, unlocked by a passkey (WebAuthn PRF) or by a passphrase stretched with Argon2id in the page, with a recovery code shown once. The server keeps it only wrapped.

**Keyed hash** means an HMAC with a key derived for the person from the install's master key (HKDF of the master key and the person's id). Addresses are lowercased first. A plain hash would not do: addresses are guessable, and a list of them could be hashed and matched. With a key per person the same sender hashes differently for each person, so the database does not show that two people hear from the same sender. Search is by exact address or domain.

**The master key** is `SIFT_KEY` locally, or the platform's key service when hosted. It is never in the database or the repository, and nothing derived from it is stored. Credentials are encrypted with keys derived the same way.

**Rules** match by hash: a pass hashes each incoming message's sender and domain and compares. A Gmail filter is written when its rule is made or changed, while the server has the address from the browser. Checking one hashes what Gmail reports, and replacing one reads the address back from the filter Gmail holds.

## Keeping people apart

1. **The application's own checks** are the guard. Every query runs through the per-person handle (`store.user(id)`, through the signed-in person's `open(id)`), and every table of a person's data carries the person's id in its keys and foreign keys, so no row can point at another person's. A test runs every dashboard route as two people.
2. **Row-level security** is defence in depth: the one check the database enforces itself. Every such table is `FORCE ROW LEVEL SECURITY` with a policy on the person's id, set per transaction by the handle. sift connects as a role that owns no table and cannot bypass the policies; migrations run as another. A test fails when a table has no policy.
3. **Encryption** limits what a leaked database or backup reveals when both fail: hashes, sealed copies, and what the person wrote.
4. **The host's own** encryption at rest and TLS on every connection.

## What it does not cover

- **Mail while it is being classified.** sift reads it from Gmail, and the model provider is sent what the model needs.
- **A server under someone else's control.** It holds the credentials, and a Gmail token reads the whole mailbox. It also serves the page that unlocks the person's key, and could serve one that takes it.
- **What the person writes.** Rules' conditions other than addresses, and labels, are plain.

## What follows from it

- The dashboard shows senders and subjects only once the browser has unlocked the person's key: a passkey prompt on each new device.
- Showing the model a few of the person's earlier answers, test runs and re-judging need stored text, so they run only while the person has the page open and unlocked.
- A person who loses their passkey and their recovery code loses what was sealed. Rules keep working: they match by hash.
- The key pair exists before anything is stored: sign in with Google, make the passkey, then sift starts reading mail.
- The server's own logs may name a mailbox, never a sender.
- Nobody running sift reads a person's mail, and no tool is built that would show it (Google's Limited Use).
- Deleting a person deletes their rows; backups keep them no longer than the stated retention.

## Now

Done: one Postgres database (PGlite locally); every person's table carries `user_id` in its keys and foreign keys and has a forced row-level security policy; every query is built on the session's `open(id)` handle, whose builder adds the person to every read, join, change and delete and sets them on every insert, and runs as `sift_app` with the person set; tests check each table's policy, that people cannot reach each other's rows, and that the builder keeps them apart with row-level security switched off. Credentials are encrypted with `SIFT_KEY` ([SECRETS.md](SECRETS.md)). Not yet: keys derived per person, hashing and sealing; everything but credentials is stored plain.
