# Edit a label

A label is what mail is; its outcome is what happens to it. The Labels screen lists each label once, under what Sift does with its mail, whatever mailboxes have it; changing one changes it in all of them, and mail with that label follows.

## Sub-features

- `label-open` opens a label's editor from its row.
- `label-outcome` changes `What Sift does with it`, with `Mark it read` and `Unsubscribe, when the sender offers a safe way`.
- `label-describe` edits `Name` and `What it is`.
- `label-add` adds labels: described, then kept from what the model suggests (`Suggest labels`), or by hand (`Write one yourself`).

## How to get to it (user POV)

- Labels, a row, then `Save`.
- Labels, `Add labels`.

## Driving it with verify.sh

Preconditions:

- Fresh seed. Labels lists Newsletters once, under `Archived`, with 2 messages.

- **Open.** `ab open "$B/labels"`, then `ab find text "Newsletters" click --exact`. It opens: a level-2 heading `Newsletters` with `Name`, `What it is`, `What Sift does with it: Archive`, and `Unsubscribe, when the sender offers a safe way` unchecked.
- **Change the outcome.** `ab find role combobox click --name "What Sift does with it"` lists `Keep`, `Archive`, `Spam`, `Block`; then `ab find role option click --name "Keep"`.
- **Save.** `ab find role button click --name "Save"`. The panel stays open (`?label=newsletter`). `Close`: Newsletters is now under `Kept in your inbox`.
- **Second view.** `ab reload`. It is still under `Kept in your inbox`.
- **Stored.** `verify.sh sql "$RUN" "SELECT disposition, block, mark_read, unsubscribe FROM labels WHERE id = 'newsletter'"` returns `keep`, `false`, `false`, `false` for each of `me@example.org` and `me@work.example.org`. No `actions` row but the seed's filters.

## Gotchas

- Changing the outcome leaves the extras (`Mark it read`, `Unsubscribe…`) as they were; the row's group says the outcome alone, never its extras.
- `Suggest labels` calls the model, and the seed's key is made up: it fails with the provider's refusal, under the button. `Write one yourself` works here.
- `Block` is spam plus blocking the sender, stored as `disposition = 'spam'`, `block = true`.
- Changing a label re-decides waiting suggestions with that label; in the fresh seed none are waiting, so the For review count does not move.
- Removing a label is not built.
