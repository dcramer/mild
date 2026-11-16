# Answer a suggestion

A message sift could not place waits in Suggestions. The user opens it, says which label it is and how far the answer reaches, and sift turns that into a rule, stores the message as an example, and moves on to the next one.

## Sub-features

- `answer-open` opens a waiting message in the side panel from its row.
- `answer-label` picks a label, by click or by its number key.
- `answer-scope` chooses how far the answer reaches (this sender by default).
- `answer-reading` chooses whether sift still reads each message (`sift reads each one to check`) or decides from the rule alone.
- `answer-sentence` says back, before sending, what the rule will do.
- `answer-teach` sends it; the panel moves to the next waiting message and the count drops.

## How to get to it (user POV)

- Suggestions, a row, then the label and `Teach sift`.
- The same with keys: `1`–`9` for a label, `Enter` to send.
- From any screen with `?message=<id>&account=me%40example.org` in the address.

## Driving it with verify.sh

Preconditions:

- Fresh seed. The `Suggestions` link reads `Suggestions 3`.

- **Open.** Choose the Deals row. `ab open "$B/suggestions"`, then `ab find text "deals@promo.example.com" click --exact`. The address gains `?message=m4`, a level-2 heading reads `48 hours only: 30% off`, `sift suggests` shows `NOT SURE`, and `Teach sift` is disabled.
- **Pick a label.** Choose Marketing. `ab find role radio click --name "7 Marketing"`. The radio is checked, `Teach sift` is enabled, and the sentence above it reads `From now on, mail from deals@promo.example.com is usually Marketing: archived, and unsubscribed from. sift still reads each one and asks about any that is something else.`
- **Teach.** `ab find role button click --name "Teach sift"`. A toast (a dialog inside the `Notifications` region) repeats the sentence; the panel shows the next waiting message (`?message=m6`, Ada Lovelace).
- **Back in the list.** `ab find role button click --name "Close"`. The link reads `Suggestions 2` and there is no Deals row.
- **Second view.** `ab open "$B/rules"`. A row reads `from deals@promo.example.com` / `When it is Marketing` / `sift reads each one`, and the heading meta says `4 · the most specific one wins`.
- **Stored.** `verify.sh sql "$RUN" "SELECT match_json, when_label, source FROM rules WHERE source = 'correction'"` returns `{"from":"deals@promo.example.com"}`, `marketing`. `SELECT message_id, label_id, status FROM examples` returns `m4`, `marketing`, `pending`. `actions` is empty.

## Gotchas

- The toast repeats the sender's address for a few seconds, so look for the row (`cell "Deals deals@promo.example.com"`), not the address.
- Rows have no accessible name. `find role row --name` matches nothing; use the sender's address as text.
- Number keys choose a label only while focus is not in a text field.
- The example stays `pending`: its body is captured on the next pass, and `sift dashboard` never runs one.
- Answering re-decides the other waiting mail. A second answer in the same run starts from a changed list.
