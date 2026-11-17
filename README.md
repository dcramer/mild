# Sift

Sift helps you manage a Gmail inbox from a machine you own.

- **Labels.** Say what you want from your inbox, a language model suggests labels from that, and you keep the ones that fit. Each label takes its mail out of your way: archive it, mark it spam, block the sender.
- **Leave in inbox.** Mail no label fits, and anything you said you never want to miss, stays where it is.
- **Rules** say what mail is, or what to do with it, without asking the model. Where you keep giving one sender's mail a different action than its label's, Sift proposes the rule.

It suggests before it acts. Every decision appears in a dashboard for you to correct, and nothing in Gmail changes until you turn Sift on. It never deletes mail, cannot send any, and every change it makes can be undone.

**Status: early.** In use on one real inbox with Sift off; it has not yet changed a real mailbox. Open work is in [TODO.md](TODO.md).

![For review](docs/images/suggestions.png)

## Set up

Needs Node 24 and pnpm.

```bash
pnpm install
pnpm sift init
```

`init` walks through three steps, and can be run again to change any of them:

1. **An encryption key** for the Google and model credentials Sift stores. It is saved as `SIFT_KEY` in `.env` in the directory you ran `init` from, not in Sift's home, so a copy of the home does not carry its own key. Start Sift from that directory.
2. **Where Sift runs:** this machine, or a server you reach from another one. Google signs people in only at `localhost` or an HTTPS address, so on a server `init` turns on `tailscale serve`.
3. **A Google OAuth client** of your own, so Sift reads your mail with nobody in between. `init` opens each Google Cloud page in turn with the values to enter, and you paste the client's JSON back.

Everything else Sift keeps, its settings and its database included, is in `~/.config/sift`; [docs/CLI.md](docs/CLI.md#files) lists it. There is no database server to run.

```bash
pnpm sift run
```

Open the address it prints and sign in with Google; that connects your Gmail account. The dashboard then walks you through the rest: connect a model (a ChatGPT subscription or an API key), say what you want, choose your labels, and pull in recent mail to answer if you like. Sift reads nothing from Gmail until you have a label of your own, and from then on handles mail as it arrives.

It also runs in a container ([docs/DOCKER.md](docs/DOCKER.md)) and on Vercel ([docs/VERCEL.md](docs/VERCEL.md)).

## More

- [docs/DASHBOARD.md](docs/DASHBOARD.md): what each screen is for, what Sift leaves in Gmail, and working on the page.
- [docs/CLI.md](docs/CLI.md): the commands, their options, and the files Sift keeps.
- [docs/DEPLOY.md](docs/DEPLOY.md): upgrading, backing up and restoring.
- [docs/SECRETS.md](docs/SECRETS.md): the encryption key, and replacing it.
- [docs/SECURITY.md](docs/SECURITY.md): how one person's mail is kept from anyone else.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it decides, and why it is built this way.
- [docs/RUNTIME.md](docs/RUNTIME.md): how one codebase runs as one process or as functions.
- [AGENTS.md](AGENTS.md): the rules for changing it. `pnpm check` is the gate.
