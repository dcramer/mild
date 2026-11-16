# Agree with a suggestion

A message sift placed shows the label it gave as the row's button, after a meter of how sure sift is. Pressing it agrees: sift makes a rule for that sender's mail of that label, settles their other waiting mail of the same label, and the label decides what happens.

## Sub-features

- `agree-button` is the label button on a placed row; its name is the meter's (`Unsure`, `Fairly sure`, `Sure`) then the label.
- `agree-key` agrees with `A` on the row the reader is on; `J` and `K` move between rows.
- `agree-change` is `Change…` beside it, which opens the message instead ([Answer a suggestion](./answer-suggestion.md)).

## How to get to it (user POV)

- Suggestions, the label button on a row.
- Keys: `J` / `K` to the row, then `A`.

## Driving it with verify.sh

Preconditions:

- Fresh seed. The Store row (`Winter sale starts now`, last) has a `Sure Marketing` button and `Change…`; the other three have `Not sure…`.

- **Move to the row.** `ab open "$B/suggestions"`, then `ab press j` four times. The Store row's button reads `Sure Marketing A`: the keycap shows only on the current row.
- **Agree.** `ab press a`, or `ab find role button click --name "Marketing"`. A toast reads `From now on, mail from sale@store.example.com that is Marketing is archived, and unsubscribed from. sift still reads each message, and asks about anything else from them.` The link reads `Suggestions 3`, the Store row is gone, and no panel opens.
- **Second view.** `ab open "$B/rules"`. The last row reads `from sale@store.example.com` / `When it is Marketing` / `sift reads each one` / `ARCHIVE + unsubscribe` / `You`.
- **Stored.** `verify.sh sql "$RUN" "SELECT when_label, source FROM rules WHERE match_json LIKE '%store%'"` returns `marketing`, `user`. `SELECT message_id, label_id FROM examples` returns `m8`, `marketing`, and its `feedback` row has `verdict` `right`. `actions` is empty.

## Gotchas

- Agreeing makes a `user` rule, not a `correction`.
- Only a row sift placed has the button. In the seed that is `m8` alone, placed by the header heuristics; nothing reaches the model, so `Unsure` and `Fairly sure` cannot be shown here.
- On a phone the label button stays on the row and `Change…` is hidden; open the row to change it.
