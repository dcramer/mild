# Secrets

Four kinds of thing would let someone else act as you, and sift encrypts each when you give it a key:

- in the home directory, the install's own: `google-client.json` (your Google OAuth client) and `dashboard-key` (signs dashboard sessions);
- in each person's database (`users/<id>.db`, table `credentials`), theirs: a Gmail refresh token per mailbox, and their model sign-ins (API keys, a ChatGPT sign-in).

A person's sign-ins are kept in their own database so that what is done for one person cannot reach another's. The rest of the database is not encrypted.

A key beside what it protects protects nothing, so the key is the one setting that comes from the environment and not `sift.toml`. It guards a copied home directory or backup. It does not guard against someone who can read the running process's environment.

## Setting a key

`sift init` generates one and adds it as `SIFT_KEY` to `.env` in the directory it was run from, before it stores any credential. If it cannot write there (in Docker, say), it prints the key for you to set.

To set one yourself, `openssl rand -base64 32`, and give the result to sift as `SIFT_KEY`: in the environment, or in a `.env` file. sift reads `.env` from the home directory and then from the directory it was started in; a variable already set is never replaced. `.env` in the home directory is the convenient place and the weak one, since a copy of the home then carries its own key. With Docker, set it on the container (the compose file passes `SIFT_KEY` and `SIFT_OLD_KEYS` through).

At the next `sift run`, everything stored plain is encrypted, and says so. Without a key sift still runs, stores these plain (the files owner-only), and says so at start.

## Rotating

1. Put the new key in `SIFT_KEY` and the one it replaces in `SIFT_OLD_KEYS` (comma-separated if there are several).
2. Start `sift run`. It re-encrypts every file and every person's sign-ins with the new key and lists them.
3. Remove `SIFT_OLD_KEYS`.

Each value records the id of the key that encrypted it (a short hash, the `2cac0b47` in `sift-secret:v1:2cac0b47:…`), which is how sift picks the key and how you can tell what an old one still covers.

## If the key was exposed

Rotating the key (above) is enough only if nobody who had the key could also have read what it protects. If a copy of the home directory or a backup may be out with it, treat what it holds as exposed too, and replace it at its source:

| What | Do |
| --- | --- |
| Gmail access | In each Google Account, remove sift's access under third-party apps; that ends every token sift was given. Then sign in to the dashboard again. |
| The Google client (`google-client.json`) | In Google Cloud Console, reset the client's secret, then `sift init` and paste the new JSON. |
| Model keys and sign-ins | Revoke the API key, or sign out other sessions, at the provider. Then sign in again under Settings in the dashboard. |
| Dashboard sessions (`dashboard-key`) | Delete the file. sift makes a new one and everyone is signed out. |

Then rotate the key itself. The key does not encrypt the rest of the databases, so a copied home also carries its mail records.

## Losing the key

sift refuses to start, and names what it cannot open. If `sift init` made the key, first check that sift was started from the directory whose `.env` holds it. Otherwise nothing in them can be recovered, and each has to be given again:

| Lost | Then |
| --- | --- |
| A Gmail sign-in | Sign in to the dashboard with that account. |
| A model sign-in | Sign in again under Settings in the dashboard. |
| `google-client.json` | Delete it, then `sift init`, and paste the client again from Google Cloud Console. |
| `dashboard-key` | Delete it; everyone is signed out of the dashboard. |

A person's sign-ins are rows in their database: until there is a way to clear them from the dashboard, delete the rows (`DELETE FROM credentials` in `users/<id>.db`) with sift stopped. Mail, decisions, rules and labels are untouched.

## How

AES-256-GCM from `node:crypto`. The key is derived from `SIFT_KEY` with scrypt, so a passphrase works, but a random value is better. Each value is authenticated with what it is for, a file's name or the person, kind and key of a row, so one account's token cannot be moved into another's place, or into another person's database. Code: `src/secrets.ts`, and `src/store/credentials.ts` for the rows.
