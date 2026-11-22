# Agree with a suggestion

A message Mild placed shows the label it gave in the row's answer: a dropdown starting on that label, after a meter of how sure Mild is, and a check. Pressing the check agrees; picking another label in the dropdown is the answer too, with no second press. The row goes at once and a toast with Undo says what happens; once the toast goes, Mild records the answer, keeps the message as an example, and begins a pass that carries out what the label does to that message in Gmail, even while Mild is off. No rule is made.

## Sub-features

- `agree-check` is the check beside the dropdown; its name is `Agree:` then the label, or `Choose what it is`, disabled, on an `Unlabelled` row.
- `agree-change` is choosing another label in the dropdown (`What this message is`), which answers at once.
- `agree-fold`: a folded row's check answers every message in it.
- `agree-undo` is the toast's `Undo Z`, which puts the row back and sends nothing. The answer is sent only when the toast goes, 8 seconds on, or longer while the pointer rests on it.
- `agree-more` is the toast's `Same for N more`, offered when the sender has other waiting mail with the same label (or, like the two Ops alerts, none) that is not folded into the row answered.

## How to get to it (user POV)

- For review, the check on a row.
- On a phone the row has no dropdown or check; it opens the message, where the same answer is under the title.

## Driving it with verify.sh

Preconditions:

- Fresh seed. The Store row (`Winter sale starts now`) has a dropdown (`What this message is`, like every row's) holding a `Sure` meter and `Marketing`, and the check `Agree: Marketing`; the Notifications rows have `Agree: Notifications`; the six `Unlabelled` rows have the check `Choose what it is`, disabled.

- **Agree.** `ab open "$B/"`, then `ab find role button click --name "Agree: Marketing"`. A toast reads `Archive as Marketing` with `Undo Z`. The rail's link reads `For review 11` (from 12), the Store row is gone, and no reader opens.
- **A folded row.** `ab find role button click --name "Agree: Notifications"` on Dependabot's row (`3 messages`; take its ref from `ab snapshot -i`, as both Notifications rows have that name). The toast reads `Archive as Notifications: 3 messages` and the count drops by three.
- **Same for more.** Pick `Notifications` in the `Replica lag on db-3` row's dropdown: the toast offers `Same for 1 more`, the other Ops alert (`e2e/answer.spec.ts` holds this; the reader's way is in [answer-suggestion.md](answer-suggestion.md)). In the reader it counts every waiting message from the address with that label, whatever name sent it.
- **Second view.** `ab open "$B/rules"`. No rule mentions `sale@store.example.com`. The message's reader (`ab open "$B/activity?show=all&message=m8"`) reads `You said this is Marketing · Done`.
- **Stored**, once the toast has gone. `verify.sh sql "$RUN" "SELECT label_id, carry_out, by_user, outcome FROM decisions WHERE message_id = 'm8' ORDER BY id DESC LIMIT 1"` returns `marketing`, `true`, `true`, `done`: the answer began a pass at once, which carried it out whether Mild is on or off. `SELECT type, status FROM actions WHERE message_id = 'm8'` is `archive`, `done`, and in `$RUN/google.json` Gmail's `m8` has lost `INBOX` and gained `mild/marketing`. `SELECT e.message_id, e.label_id, f.verdict FROM examples e JOIN decisions d ON d.message_id = e.message_id JOIN feedback f ON f.decision_id = d.id WHERE e.message_id = 'm8'` returns `m8`, `marketing`, `right`.

## Gotchas

- An answer makes no rule, and answers that agree with the label propose none. Only answers giving a label's mail another action do (two in a row for one sender), which the dashboard's check never gives: the seed makes its one from Gmail answers.
- Only a row Mild placed starts on a label. In the seed those are Store (`m8`) and the Dependabot and github-actions[bot] rows, placed by the stand-in model as sure. The dropdown's likely group adds the two labels the sender's other mail got most, each with a meter of its share: for `notifications@code.example.com`, Notifications and Account alerts.
- Nothing is stored until the toast goes: query the database and `google.json` after it has.
- The check has no key of its own; Enter on a focused check presses it.
