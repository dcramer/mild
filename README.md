# sift

sift helps you manage a Gmail inbox, on a machine you own. Each new message gets a label (Newsletters, Receipts, Cold outreach, or one of your own), and the label decides what happens: keep, archive, mark spam or block the sender. A language model is asked only about mail no rule covers, and what it answers consistently becomes a rule, so it is asked less over time.

It suggests before it acts. Every decision appears in a dashboard, you correct the wrong ones, and nothing in Gmail changes until you turn sift on. It never deletes mail and cannot send any. Every change it makes can be undone.

**Status: early.** In use on one real inbox, with sift off; it has not yet been turned on against a real mailbox. Open work is in [TODO.md](TODO.md).

![Suggestions](docs/images/suggestions.png)

## Set up

Requires Node 24 and pnpm.

```bash
pnpm install
```

```bash
pnpm sift init
```

`init` asks for four things, and can be run again to change any of them. First it generates the key that encrypts your Google and model credentials, and saves it as `SIFT_KEY` in `.env` in the directory you ran it from. sift finds it only when started from there.

1. **Where sift runs.** This machine, or a server you reach from another one. Google only signs people in at `localhost` or an HTTPS address, so on a server `init` turns on `tailscale serve`.
2. **A Google OAuth client.** sift reads your mail through a client you own, so nobody sits in between. `init` gives you each Google Cloud page in turn with the values to enter, and you paste the client's JSON back.
3. **A model.** Optional: a ChatGPT subscription or an API key. Without one, mail no rule covers stays in your inbox.
4. **Who can sign in.** Optional: the only Google accounts allowed into the dashboard. Without a list, the first account to sign in connects itself.

```bash
pnpm sift run
```

Open the address it prints and sign in with Google. Signing in is what connects your Gmail account. sift handles mail that arrives from then on; it does not sweep what is already in your inbox.

## More

- [docs/DASHBOARD.md](docs/DASHBOARD.md): what each screen is for, what sift leaves in Gmail, and working on the page.
- [docs/CLI.md](docs/CLI.md): the commands, their options, and the files sift keeps.
- [docs/DOCKER.md](docs/DOCKER.md): running it in a container.
- [docs/DEPLOY.md](docs/DEPLOY.md): upgrading, backing up and restoring.
- [docs/SECRETS.md](docs/SECRETS.md): encrypting stored credentials with a key you supply.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it decides, and why it is built this way.
- [AGENTS.md](AGENTS.md): the rules for changing it. `pnpm check` is the gate.
