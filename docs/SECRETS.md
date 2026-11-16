# Secrets

Four things in the home directory would let someone else act as you: `google-client.json` (your Google OAuth client), `google/*.json` (a Gmail refresh token per account), `model-auth.json` (model provider keys and tokens) and `dashboard-key` (signs dashboard sessions). sift encrypts them when you give it a key. The database is not encrypted.

A key beside what it protects protects nothing, so the key is the one setting that comes from the environment and not `sift.toml`. It guards a copied home directory or backup. It does not guard against someone who can read the running process's environment.

## Setting a key

```sh
openssl rand -base64 32
```

Give the result to sift as `SIFT_KEY`: in the environment, or in a `.env` file. sift reads `.env` from the home directory and then from the directory it was started in; a variable already set is never replaced. `.env` in the home directory is the convenient place and the weak one, since a copy of the home then carries its own key. With Docker, set it on the container (the compose file passes `SIFT_KEY` and `SIFT_OLD_KEYS` through).

At the next `sift run`, everything stored plain is encrypted, and says so. Without a key sift still runs, stores these files plain with owner-only permissions, and says so at start.

## Rotating

1. Put the new key in `SIFT_KEY` and the one it replaces in `SIFT_OLD_KEYS` (comma-separated if there are several).
2. Start `sift run`. It re-encrypts every file with the new key and lists them.
3. Remove `SIFT_OLD_KEYS`.

Each file records the id of the key that encrypted it (a short hash, the `2cac0b47` in `sift-secret:v1:2cac0b47:…`), which is how sift picks the key and how you can tell which files an old one still covers.

## Losing the key

sift refuses to start, and names the files it cannot open. Nothing in them can be recovered. Delete them and set up again:

| Deleted | Then |
| --- | --- |
| `google/<account>.json` | Sign in to the dashboard with that account. |
| `google-client.json` | `sift init`, and paste the client again from Google Cloud Console. |
| `model-auth.json` | `sift init`, the model step. |
| `dashboard-key` | Nothing; everyone is signed out of the dashboard. |

Mail, decisions, rules and labels are in the database and are untouched.

## How

AES-256-GCM from `node:crypto`. The key is derived from `SIFT_KEY` with scrypt, so a passphrase works, but a random value is better. The file's name is authenticated with its contents, so one account's token file cannot be renamed into another's place. Code: `src/secrets.ts`.
