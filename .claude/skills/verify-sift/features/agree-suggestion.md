# Agree with a suggestion

A message sift placed shows the label it gave in the row's answer: a dropdown starting on that label, after a meter of how sure sift is, and a check. Pressing the check agrees: sift records the answer, keeps the message as an example, and carries out what the label does to that message in Gmail on the next pass, even while sift is off. No rule is made.

## Sub-features

- `agree-check` is the check beside the dropdown; its name is `Agree:` then the label.
- `agree-change` is choosing another label in the dropdown (`What this message is`), which turns the check into `Save:` and inks it; nothing is sent until it is pressed.
- `agree-more` is the toast's `Same for N more`, offered when the sender has other waiting mail sift guessed the same way.

## How to get to it (user POV)

- For review, the check on a row.
- On a phone the row has no dropdown or check; it opens the message, where the same answer leads the panel.

## Driving it with verify.sh

Preconditions:

- Fresh seed. The Store row (`Winter sale starts now`) has a dropdown reading `Sure Marketing` and the check `Agree: Marketing`; the Notifications rows have `Agree: Notifications`; the six `Which label?` rows have the check disabled (`Choose what it is first`).

- **Agree.** `ab open "$B/"`, then `ab find role button click --name "Agree: Marketing"`. A toast reads `Archive as Marketing`. The link's count is one fewer, the Store row is gone, and no panel opens.
- **Second view.** `ab open "$B/rules"`. No rule mentions `sale@store.example.com`.
- **Stored.** `verify.sh sql "$RUN" "SELECT label_id, carry_out, by_user, outcome FROM decisions WHERE message_id = 'm8' ORDER BY id DESC LIMIT 1"` returns `marketing`, `true`, `true`, null: the answer waits for the next pass to be carried out (`sift dashboard` runs none). `SELECT e.message_id, e.label_id, f.verdict FROM examples e JOIN decisions d ON d.message_id = e.message_id JOIN feedback f ON f.decision_id = d.id WHERE e.message_id = 'm8'` returns `m8`, `marketing`, `right`.

## Gotchas

- An answer makes no rule, and answers that agree with the label propose none. Only answers giving a label's mail another action do (two in a row for one sender), which the dashboard's check never gives: the seed makes its one from Gmail answers.
- Only a row sift placed starts on a label. In the seed those are Store (`m8`) and the Dependabot and github-actions[bot] rows, placed by the stand-in model as sure; it is unsure of everything else, so `Unsure` and `Fairly sure` meters cannot be shown here, and the dropdown's likely group holds only the label itself.
- The check has no key of its own; Enter on a focused check presses it.
