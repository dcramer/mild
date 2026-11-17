# Edit a label

A label is what mail is; its outcome is what happens to it. The user changes a label's name, its description (which the model reads) and its outcome from the Labels screen, and mail with that label follows.

## Sub-features

- `label-open` opens a label's editor from its row.
- `label-outcome` changes `What Sift does with it`, with `Mark it read` and `Unsubscribe, when the sender offers a safe way`.
- `label-describe` edits `Name` and `What it is`.
- `label-add` adds a label of the user's own (`Add a label`).

## How to get to it (user POV)

- Labels, a row, then `Save`.
- Labels, `Add a label`.

## Driving it with verify.sh

Preconditions:

- Fresh seed. Labels lists Newsletters once per mailbox; `me@example.org`'s row (first) reads `Archive`, 2 messages.

- **Open.** `ab open "$B/labels"`, then `ab find text "Newsletters" click --exact`. The first, `me@example.org`'s, opens: a level-2 heading `Newsletters` with `Name`, `What it is`, `What Sift does with it: Archive`, and `Unsubscribe, when the sender offers a safe way` unchecked.
- **Change the outcome.** `ab find role combobox click --name "What Sift does with it"` lists `Keep`, `Archive`, `Spam`, `Block`; then `ab find role option click --name "Keep"`.
- **Save.** `ab find role button click --name "Save"`. The panel stays open (`?label=newsletter`). `Close`: the `me@example.org` Newsletters row's outcome cell reads `Keep`.
- **Second view.** `ab reload`. The row still reads `Keep`; `me@work.example.org`'s still reads `Archive`.
- **Stored.** `verify.sh sql "$RUN" "SELECT disposition, block, mark_read, unsubscribe FROM labels WHERE id = 'newsletter' AND account_id = 'me@example.org'"` returns `keep`, `false`, `false`, `false`. No `actions` row but the seed's filters.

## Gotchas

- Changing the outcome leaves the extras (`Mark it read`, `Unsubscribe…`) as they were; the row shows the outcome alone, never its extras.
- `Block` is spam plus blocking the sender, stored as `disposition = 'spam'`, `block = true`.
- Changing a label re-decides waiting suggestions with that label; in the fresh seed none are waiting, so the For review count does not move.
- Removing a label is not built.
