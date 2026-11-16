# Agree with a suggestion

A message sift placed shows the label it gave in the row's answer: a dropdown starting on that label, after a meter of how sure sift is, and a check. Pressing the check agrees: sift records the answer, keeps the message as an example, and carries out what the label does to that message in Gmail on the next pass, even while only observing. No rule is made.

## Sub-features

- `agree-check` is the check beside the dropdown; its name is `Agree:` then the label.
- `agree-change` is choosing another label in the dropdown (`What this message is`), which turns the check into `Save:` and inks it; nothing is sent until it is pressed.
- `agree-more` is the toast's `Same for N more`, offered when the sender has other waiting mail sift guessed the same way.
- `agree-propose` is sift proposing a rule for a sender after three answers alike.

## How to get to it (user POV)

- Suggestions, the check on a row.
- On a phone the row has no dropdown or check; it opens the message, where the same answer leads the panel.

## Driving it with verify.sh

Preconditions:

- Fresh seed. The Store row (`Winter sale starts now`, last) has a dropdown reading `Marketing` and a check; the other three read `Not sure`, with the check disabled.

- **Agree.** `ab open "$B/suggestions"`, then `ab find role button click --name "Agree: Marketing"`. A toast reads `Archived as Marketing`. The link reads `Suggestions 3`, the Store row is gone, and no panel opens.
- **Second view.** `ab open "$B/rules"`. No rule mentions `sale@store.example.com`.
- **Stored.** `verify.sh sql "$RUN" "SELECT label_id, mode, by_user, outcome FROM decisions WHERE message_id = 'm8' ORDER BY id DESC LIMIT 1"` returns `marketing`, `act`, `1`, null: the answer waits for the next pass to be carried out (`sift dashboard` runs none). `SELECT message_id, label_id FROM examples` returns `m8`, `marketing`, and its `feedback` row has `verdict` `right`.

## Gotchas

- An answer makes no rule; three alike for one sender propose one, shown on Suggestions as `Make a rule?`.
- Only a row sift placed starts on a label. In the seed that is `m8` alone, placed by the header heuristics; nothing reaches the model, so `Unsure` and `Fairly sure` meters cannot be shown here, and the dropdown's likely group holds only the label itself.
- The check has no key of its own; Enter on a focused check presses it.
