# Dashboard

`sift run` serves it and prints its addresses. It is where Sift is watched, taught and managed.

## Reaching it

- `http://localhost:8787` on the machine running Sift.
- `https://<machine>.<tailnet>.ts.net` from your other devices, once `tailscale serve --bg 8787` is on.

A plain `http://hostname:8787` address shows the page but cannot sign you in: Google returns a browser only to `localhost` or an HTTPS address.

Signing in with Google is what connects a Gmail account, and only someone signed in as a connected account sees anything. Connect a second account from Settings. Who can sign in at all is Google's to say: the client's test users, or anyone once the app is published.

## Screens

- **Setting up,** in place of every screen until a model is connected and each mailbox has a label of its own: connect a model, say in your own words what you want from Sift, keep what fits of the labels the model suggests, and (for the install's owner) pull in recent mail to answer.
- **For review,** the home page: the rules Sift proposes where you keep doing something other than what a label does, then one row per message for what Sift would do, with a sender's mail Sift gave one label folded into one row. Agree in one press (for every message a folded row holds), or open the row to read the mail, see what Sift knows about the sender and what it saw in the message (a mailing list, a one-click unsubscribe, a reply, attachments; each one a rule away). Narrow the list by what Sift saw. The text of each message you answer for is stored, as an example to test and train Sift with.
- **Activity:** what Sift changed in Gmail, or everything it decided, over a period, searchable by subject or sender and narrowed by what Sift saw in the message. Undo what Sift changed in Gmail from the row; open it for that message's whole history, with each decision's reason and cost and each mailbox change.
- **Labels:** what mail can be, and what Sift does with each. Open one to change it. Add labels by describing the mail to the model and keeping what fits of what it suggests, or by hand.
- **Rules:** what mail is, or what to do with it, without asking a model. Add one by describing it to the model, which fills in the form for you to check, or fill the form in yourself; remove them; see how often and how recently each matched. A rule's conditions can include what Sift saw in the message ("that is a reply", "that has a one-click unsubscribe"); such a rule cannot be a Gmail filter.
- **Settings:** whether Sift is on (changes your Gmail) or off (only suggests), the model and what it has cost, the connected accounts, and pulling in older mail to teach with. Changes apply to the running Sift straight away. Removing a mailbox, or deleting your account, is confirmed by typing the address: Sift revokes its access at Google and deletes everything it recorded about that mail. Your last mailbox is how you sign in, so removing it deletes your account.

A sender's name anywhere is a link to their page: what Sift knows about them, the standing you give them, and all their mail. An address that writes under several names (a service's "Dependabot" and "Security alerts") is titled by the address, lists each name with what its mail is and a rule for it, and its mail can be narrowed to one name. After the name, a small icon says whether this is their first message (yellow), someone you write to, or someone who writes often and whom you have never answered; pointing at it says which.

## What Sift leaves in Gmail

Mail Sift acts on gets its label (`sift/newsletters`) and, if Sift moved it, a second one for what Sift did (`sift/did/archived`, `sift/did/spam`). Mail it could not place gets `sift/review` and stays in the inbox. So everything Sift touched can be found in Gmail itself. Removing a mailbox from Sift leaves these labels, and the filters it wrote; delete the filters in Gmail's settings if you no longer want them.

## Working on the page

The page is a React app in `web/`, styled with Tailwind and built from Sift's own design system ([design.md](design.md), every part shown at `/system`).

- `sift run` builds it the first time and whenever its sources are newer than the build. `pnpm build:web` does the same by hand, into `web/dist`.
- `pnpm dev` runs Sift from source and reloads the page when either the server or the page changes. Give it `--home <scratch>`.
- It is served under a content security policy that allows no inline script, no inline style and nothing from another origin. A violation shows in the browser console, not in the build.

Why it is built this way is in [architecture.md](architecture.md#dashboard).
