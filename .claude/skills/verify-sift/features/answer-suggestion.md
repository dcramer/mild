# Answer a suggestion

A message sift could not place, or placed wrongly, waits in Suggestions. The user opens it, chooses what it is, and presses the check. sift records the label, carries out that label's action on the message on the next pass (even while sift is off), keeps the message as an example, makes no rule, and moves on to the next one.

## Sub-features

- `answer-open` opens a waiting message in the side panel from its row.
- `answer-pick` chooses a label in the panel's dropdown (`What this message is`), sift's likely labels first, each with a meter.
- `answer-save` is the check: `Agree:` the label while it is sift's, `Save:` once changed. The panel moves to the next waiting message and the count drops.
- `answer-rule` is `Make a rule…`, which opens the rule dialog over the panel, started on this sender and the message's label (see rule-shortcuts.md).

## How to get to it (user POV)

- Suggestions, a row, then the dropdown and the check at the top of the panel.
- From any screen with `?message=<id>&account=me%40example.org` in the address.

## Driving it with verify.sh

Preconditions:

- Fresh seed. The `Suggestions` link reads `Suggestions 4`.

- **Open.** `ab open "$B/"`, then `ab find role cell click --name "48 hours only: 30% off"`. The address gains `?message=m4`, a level-2 heading reads `48 hours only: 30% off`, the dropdown reads `Which label?`, and the check is disabled.
- **Choose and save.** `ab find role combobox click --name "What this message is"`, `ab find role option click --name "Marketing"`, then `ab find role button click --name "Save: Marketing"`. A toast reads `Archive as Marketing`; the panel shows the next waiting message (`?message=m6`, `Lunch on Thursday?`).
- **A rule, on purpose.** On m6, `ab find role button click --name "Make a rule…"`. The rule dialog opens over the panel with the value reading `ada@example.org`; the address keeps `?message=m6`. `Cancel`.
- **Second view.** `ab open "$B/rules"`. Still 3 rules: answering made none.
- **Stored.** `verify.sh sql "$RUN" "SELECT label_id, carry_out, by_user FROM decisions WHERE message_id = 'm4' ORDER BY id DESC LIMIT 1"` returns `marketing`, `true`, `true`. `SELECT message_id, label_id FROM examples` returns `m4` with `marketing`.

## Gotchas

- A row shows the sender's name, not the address; the address is in the panel.
- Each subject is in its row twice, once in a copy shown only on phones, so `find text "<subject>"` reaches the hidden one and fails. Use `find role cell`.
- Rows have no accessible name. `find role row --name` matches nothing.
- The example stays `pending`: its body is captured on the next pass, and `sift dashboard` never runs one.
