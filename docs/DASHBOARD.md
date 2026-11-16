# Dashboard

`sift run` serves it and prints its addresses. It is where sift is watched, taught and managed.

## Reaching it

- `http://localhost:8787` on the machine running sift.
- `https://<machine>.<tailnet>.ts.net` from your other devices, once `tailscale serve --bg 8787` is on.

A plain `http://hostname:8787` address shows the page but cannot sign you in: Google returns a browser only to `localhost` or an HTTPS address.

Signing in with Google is what connects a Gmail account, and only someone signed in as a connected account sees anything. Connect a second account from Settings. To limit who can sign in at all, list the addresses under `allow` in the `[dashboard]` table of `sift.toml`, or use that step of `sift init`; then no other account gets in, the first included.

## Screens

- **Suggestions,** the home page: how sift is doing (how much it decided without a model, how often it was right, what the model cost, decisions per day by tier), the rules it proposes, then one row per sender for what sift would do. Agree in one press, or open the row to read the mail, see what sift knows about the sender, and choose how far your answer reaches (the sender, their domain, only when the subject contains something, or just this mail). Each message you answer for is stored whole, as an example to test and train sift with.
- **Activity:** every decision, searchable by subject or sender and filterable by where it got to (suggested, done, undone, needs a look), what sift did and which tier decided. Undo what sift changed in Gmail from the row; open it for that message's whole history, with each decision's reason and cost and each mailbox change.
- **Labels:** what mail can be, and what sift does with each. Open one to change it; add your own.
- **Rules:** what mail is, without asking a model. Add and remove them; see how often and how recently each matched. When the model has given a sender's mail the same label five times running, sift proposes the rule on Suggestions.
- **Settings:** whether sift is observing or acting, the model and what it has cost, how often to check, the connected accounts, and pulling in older mail to teach with. Changes apply to the running sift straight away.

A sender's name anywhere is a link to their page: where they stand and why, what sift knows about them, the standing you give them, and all their mail.

## What sift leaves in Gmail

Mail sift acts on gets its label (`sift/newsletters`) and, if sift moved it, a second one for what sift did (`sift/did/archived`, `sift/did/spam`). Mail it could not place gets `sift/review` and stays in the inbox. So everything sift touched can be found in Gmail itself.

## Working on the page

The page is a React app in `web/`, styled with Tailwind and built from sift's own design system ([DESIGN.md](DESIGN.md), every part shown at `/system`).

- `sift run` builds it the first time and whenever its sources are newer than the build. `pnpm build:web` does the same by hand, into `web/dist`.
- `pnpm dev` runs sift from source and reloads the page when either the server or the page changes. Give it `--home <scratch>`.
- It is served under a content security policy that allows no inline script, no inline style and nothing from another origin. A violation shows in the browser console, not in the build.

Why it is built this way is in [ARCHITECTURE.md](ARCHITECTURE.md#dashboard).
