# Edit a label

A label is what mail is; its outcome is what happens to it. The Labels screen lists each label once, under what Sift does with its mail, whatever mailboxes have it; changing one changes it in all of them, and mail with that label follows.

## Sub-features

- `label-open` opens a label's editor from its row.
- `label-outcome` changes `What Sift does with it`, with `Mark it read` and `Unsubscribe, when the sender offers a safe way`.
- `label-describe` edits `Name` and `What it is`.
- `label-add` adds labels: described, then kept from what the model suggests (`Suggest labels`), with a `Not in these labels` note for what it left out, or by hand (`Write one yourself`).
- `label-remove` removes a label from its panel, with the rules that name it.

## How to get to it (user POV)

- Labels, a row, then `Save`.
- Labels, `Add labels`.
- Labels, a row, then `Remove`.

## Driving it with verify.sh

Preconditions:

- Fresh seed. Labels lists Newsletters once, under `Archived`, with 2 messages.

- **Open.** `ab open "$B/labels"`, then `ab find text "Newsletters" click --exact`. It opens: a level-2 heading `Newsletters` with `Name`, `What it is`, `What Sift does with it: Archive`, and `Unsubscribe, when the sender offers a safe way` unchecked.
- **Change the outcome.** `ab find role combobox click --name "What Sift does with it"` lists `Keep`, `Archive`, `Spam`, `Block`; then `ab find role option click --name "Keep"`.
- **Save.** `ab find role button click --name "Save"`. The panel stays open (`?label=newsletter`). `Close`: Newsletters is now under `Kept in your inbox`.
- **Second view.** `ab reload`. It is still under `Kept in your inbox`. `ab open "$B/"`: Deals (`48 hours only: 30% off`) is gone (see Gotchas).
- **Spam drops Mark it read.** `ab open "$B/labels?label=marketing"`, tick `Mark it read`, then choose `Spam`: the box goes. `Save`; `SELECT disposition, mark_read FROM labels WHERE id = 'marketing'` is `spam`, `false`.
- **Add, suggested.** `Add labels`, `ab find role textbox fill "Archive sales pitches and my receipts" --name "What mail"`, `Suggest labels`. `Not in these labels` says `Your Receipts and transactions label covers receipts already.`, above one suggestion, `Sales pitches`, checked (`Keep Sales pitches`). `ab find role button click --name "Add this label"`: it is under `Archived`, in both mailboxes. Words naming neither pitches nor receipts show `The model could not suggest labels (the model did not suggest any usable labels). Try again.`; words naming only receipts show the note alone, with `Back` and no add button.
- **Add, by hand.** `Write one yourself`, `ab find role textbox fill "Field trips" --name "Name"`, `ab find role button click --name "Add label" --exact`.
- **Stored.** `verify.sh sql "$RUN" "SELECT disposition, block, mark_read, unsubscribe FROM labels WHERE id = 'newsletter'"` returns `keep`, `false`, `false`, `false` for each of `me@example.org` and `me@work.example.org`. No `actions` row but the seed's filters.
- **Remove.** In the Newsletters panel, `ab find role button click --name "Remove" --exact`. It asks `Remove Newsletters and its 1 rule?` beside a second `Remove` and `Cancel`; the second `Remove` is inside the group named by the question. Pressing it closes the panel with the toast `Label removed` over `Newsletters`, and the count beside `Add labels` drops by one.
- **Stored after removing.** `verify.sh sql "$RUN" "SELECT account_id, removed_at IS NOT NULL AS removed FROM labels WHERE id = 'newsletter'"` is `true` for both mailboxes: the row stays. `SELECT label_id FROM rules` no longer has `newsletter`. `m1` and `m2` keep their `newsletter` decisions, and the sender page for `digest@news.example.com` still names Newsletters.

## Gotchas

- `Unsubscribe…` survives any change of outcome; `Mark it read` exists only for Keep and Archive, and a block only for Block. The row's group says the outcome alone, never its extras.
- `Suggest labels` asks `serve.ts`'s stand-in (SKILL.md), never a provider: its answers are fixed by the words, as above. Each ask is a `label_proposals` row; its `labels` and `note` are sealed.
- `Remove`'s question replaces the button with one of the same name: wait for `Remove <label>?` before the second press, or it presses nothing.
- `Block` is spam plus blocking the sender, stored as `disposition = 'spam'`, `block = true`.
- Changing or removing any label re-decides every waiting suggestion. The seed adds its spam rule for `promo.example.com` without doing that, so the first save moves `m4` from `Unlabelled` to that rule, and For review drops from 12 to 11. That comes from the seed, not from the label.
- Leave in inbox opens on its figures and a line saying it is Sift's own: nothing to edit, and no `Remove`. Removing the last label besides it is refused under the button, since Sift reads no mail without one.
