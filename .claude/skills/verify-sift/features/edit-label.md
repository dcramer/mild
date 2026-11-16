# Edit a label

A label is what mail is; its outcome is what happens to it. The user changes a label's name, its description (which the model reads) and its outcome from the Labels screen, and mail with that label follows.

## Sub-features

- `label-open` opens a label's editor from its row.
- `label-outcome` changes `What sift does with it`, with `Mark it read` and `Unsubscribe, when the sender offers a safe way`.
- `label-describe` edits `Name` and `How to recognise it`.
- `label-add` adds a label of the user's own (`Add a label`).

## How to get to it (user POV)

- Labels, a row, then `Save`.
- Labels, `Add a label`.

## Driving it with verify.sh

Preconditions:

- Fresh seed. The Newsletters row reads `ARCHIVE + unsubscribe`, 2 messages, 1 rule.

- **Open.** `ab open "$B/labels"`, then `ab find text "Newsletters" click --exact`. A level-2 heading `Newsletters` with `Name`, `How to recognise it`, `What sift does with it: Archive`, and `Unsubscribe, when the sender offers a safe way` checked.
- **Change the outcome.** `ab find role combobox click --name "What sift does with it"` lists `Keep`, `Archive`, `Spam`, `Block`; then `ab find role option click --name "Keep"`.
- **Save.** `ab find role button click --name "Save"`. The editor closes and the Newsletters row's outcome cell reads `KEEP + unsubscribe`.
- **Second view.** `ab reload`. The row still reads `KEEP + unsubscribe`.
- **Stored.** `verify.sh sql "$RUN" "SELECT disposition, block, mark_read, unsubscribe FROM labels WHERE id = 'newsletter'"` returns `keep`, `0`, `0`, `1`. `actions` is empty.

## Gotchas

- Changing the outcome leaves the extras as they were: Keep with unsubscribe still checked is `KEEP + unsubscribe`.
- `Block` is spam plus blocking the sender, stored as `disposition = 'spam'`, `block = 1`.
- Changing a label re-decides waiting suggestions with that label; in the fresh seed none are waiting, so the Suggestions count does not move.
- Removing a label is not built.
