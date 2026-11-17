# Setting up

Until Sift can work (a model in use, and every mailbox with labels of its own), the dashboard is a page of steps instead: `Connect a model`, `What you want`, `Your labels`, and for the owner `Older mail`. A step already done is ticked and skipped. The user says what they want in their own words, keeps what they like of the labels suggested, then chooses whether to pull in older mail.

## Sub-features

- `setup-connect`: `Connect a model`, shown when no model is in use or its sign-in is gone.
- `setup-want`: `What do you want from Sift?`, a box with example words to start from, and `Suggest labels`.
- `setup-labels`: `Your labels`, the suggestions with a check each, and a `Not in these labels` note for what they leave out. `Use this label` (or `Use these N labels`) and `Start over`; with only a note, `Start over` alone.
- `setup-older`: `Older mail`, `How far back`, `Pull in mail` or `New mail only`.

## How to get to it (user POV)

- A new account, or one whose model was signed out.

## Driving it with verify.sh

Preconditions:

- `Connect a model`: a fresh seed. The rest: a run started with `verify.sh up "$RUN" --bare`, whose `me@work.example.org` has no labels of its own. The dashboard refuses to remove the last label, so a normal seed cannot get there.

- **Connect.** Sign the model out (SKILL.md, `/api/model/signout`) and reload: the heading is `No model connected`, with no steps listed (a model lost after setting up is the only thing to do).
- **Reach the rest.** In the `--bare` run, `ab open "$B/"`. The steps are listed with `Connect a model` ticked, and the heading is `What do you want from Sift?`, with example words to start from (`Get sales pitches out of my inbox`, …). Once suggestions have been asked for, the latest decide the step (`Your labels`; `Start over` goes back).
- **Only a note.** `ab find role textbox fill "Just my receipts" --name "What do you want from Sift?"`, `Suggest labels`. `Your labels` shows `Not in these labels` and only `Start over`.
- **Labels.** `Start over`, `No more sales pitches`, `Suggest labels`: `Sales pitches`, checked, and `Use this label`. Press it: the heading is `Older mail`, with `How far back` (`The last week`), `Pull in mail` and `New mail only`.
- **Done.** `ab find role button click --name "New mail only"`: For review. `SELECT name FROM labels WHERE account_id = 'me@work.example.org' AND gmail_label IS NOT NULL` is `Sales pitches`: the labels are made in the mailboxes that had none.
- **Phone.** `ab set viewport 390 844`: `document.documentElement.scrollWidth - document.documentElement.clientWidth` is `0`.
- `ab console` and `ab errors` print nothing.

## Gotchas

- `Suggest labels` is `serve.ts`'s stand-in (SKILL.md): words naming pitches get `Sales pitches`, receipts the note, neither an error.
- `Pull in mail` reads Gmail, which the harness cannot reach.
- Every mailbox needs labels of its own: one bare mailbox is enough to show the steps to its person.
