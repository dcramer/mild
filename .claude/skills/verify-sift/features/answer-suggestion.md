# Answer a suggestion

A message Mild could not place, or placed wrongly, waits in For review. The user opens it and picks what it is: picking is the answer. The reader moves on to the next waiting message, and once the answer's toast goes, Mild records the label, carries out that label's action on the message (even while Mild is off), keeps the message as an example, and makes no rule.

## Sub-features

- `answer-open` opens a waiting message from its row, in the reader in the list's place, its subject the page's heading.
- `answer-pick` chooses a label in the reader's dropdown (`What this message is`): `Leave in inbox` first and set apart, then the label Mild gave and the two its sender's other mail got most, each with a meter, then the rest, and `Add a label…` last. Picking answers; the check beside it (`Agree:` the label, or `Choose what it is`, disabled, on an `Unlabelled` message) agrees with the label shown. Only that message is answered; on For review, a folded row's check answers every message in it.
- `answer-undo` is the toast's `Undo Z`, which puts the message back and sends nothing.
- `answer-more` is the toast's `Same for N more`: the only way one answer reaches the sender's other waiting mail, offered when that mail has the same label (or, like the two Ops alerts, none).
- `answer-rule` is `Make a rule…`, last in the dropdown's list after `Add a label…`, which opens the rule dialog over the reader, started on this sender and the message's label (see rule-shortcuts.md).

## How to get to it (user POV)

- For review, a row's subject, then the dropdown under the heading. Inbox off: with Inbox on, Inbox takes For review's place.
- From any screen with `?message=<id>` in the address.

## Driving it with verify.sh

Preconditions:

- Fresh seed (counts in [README.md](README.md)). For review is newest first, so Deals is its first row and Ada's release-script reply its last.

- **Open.** `ab open "$B/"`, then `ab find role cell click --name "Disk 91% full on db-2"`. The address gains `?message=m9`, the heading (level 1) reads `Disk 91% full on db-2`, the dropdown reads `Unlabelled`, and `Choose what it is` is disabled.
- **Pick.** `ab find role combobox click --name "What this message is"`, then `ab find role option click --name "Notifications" --exact`. A toast reads `Archive as Notifications` with `Same for 1 more` and `Undo Z`; leave it. The reader moves to `Replica lag on db-3` (`?message=m10`), still `Unlabelled`, the rail's link reads `For review 11`, and that row stays on For review.
- **The last one.** `ab open "$B/?q=48%20hours"`, open `48 hours only`, pick `Marketing`: with nothing after it the reader closes, the address has no `?message`, and the list says `Nothing waiting matches.`
- **A rule, on purpose.** `ab open "$B/?message=m6"`, `ab find role combobox click --name "What this message is"`, then `ab find role option click --name "Make a rule…"`. The rule dialog opens over the reader on `What should it do?`, its box started on the sender alone (`Mail from ada@example.org: `, since Ada's mail has no label); `Write it yourself` shows `Value 1` reading `ada@example.org`; the address keeps `?message=m6`. `ab press Escape`.
- **Second view.** `ab open "$B/rules"`. As many rules as before: answering made none.
- **Stored**, once the toast has gone (8 seconds). `verify.sh sql "$RUN" "SELECT label_id, carry_out, by_user, outcome FROM decisions WHERE message_id = 'm9' ORDER BY id DESC LIMIT 1"` returns `notification`, `true`, `true`, `done`: the answer began a pass, which archived `m9` in Gmail (`$RUN/google.json`). `SELECT message_id, label_id FROM examples WHERE message_id IN ('m9', 'm10')` returns `m9` with `notification`, and no `m10` (the seed's three bills are examples too).

## Gotchas

- A row shows the sender's name and then the address (the name alone on a phone). The name is a link to the sender's page, so open a row by its subject cell.
- Each subject is in its row twice, once in a copy shown only on phones, so `find text "<subject>"` reaches the hidden one and fails. Use `find role cell`.
- Rows have no accessible name. `find role row --name` matches nothing.
- Nothing is sent until the toast goes; Undo before then leaves no trace.
- The answer copies the text Mild read of the waiting message into the example: `SELECT status FROM examples WHERE message_id = 'm9'` is `captured`, and `read_bodies` still has `m9` until 30 days after it was read.
