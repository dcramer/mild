# Answer a suggestion

A message sift could not place, or placed wrongly, waits in Suggestions. The user opens it, says what should happen, which label it is and how far the answer reaches, and sift turns that into a rule, stores the message as an example, and moves on to the next one.

## Sub-features

- `answer-open` opens a waiting message in the side panel from its row, its `Not sure…` button, or `Change…` on a placed row.
- `answer-does` picks what happens: `Keep`, `Archive`, `Spam`.
- `answer-label` picks a label, by click or by its number key.
- `answer-scope` chooses how far the answer reaches (this sender by default).
- `answer-sentence` says back, before sending, what the rule will do.
- `answer-teach` sends it; the panel moves to the next waiting message and the count drops.

## How to get to it (user POV)

- Suggestions, a row, then what should happen and `Save answer` (`Agree` when nothing was changed).
- Keys in the panel: `I` / `E` / `!` for keep, archive, spam; `1`–`9` for what it is; `Enter` to send.
- From any screen with `?message=<id>&account=me%40example.org` in the address.

## Driving it with verify.sh

Preconditions:

- Fresh seed. The `Suggestions` link reads `Suggestions 4`.

- **Open.** `ab open "$B/suggestions"`, then `ab find role cell click --name "48 hours only: 30% off"`. The address gains `?message=m4`, a level-2 heading reads `48 hours only: 30% off`, `sift suggests` shows `Not sure`, no action is chosen, and `Save answer` is disabled.
- **Say what happens.** `ab find role radio click --name "Archive"`. `How far this answer reaches` reads `Everything from them`, `Save answer` is enabled, and the sentence above it reads `From now on, mail from deals@promo.example.com is archived, whatever it is. sift will not ask about it again.`
- **Save.** `ab find role button click --name "Save answer"`. A toast in the `Notifications` region repeats the sentence; the panel shows the next waiting message (`?message=m6`, `Lunch on Thursday?`).
- **Only what it is.** On m6, `ab find role button click --name "Personal"`. `Keep` becomes checked, the reach changes by itself to `Only this message`, and the sentence reads `Only this message: Personal, kept. No rule is made; sift is shown it as an example next time.` Save; no rule is added.
- **Their mail of one kind, by key.** On m7, `ab press 1` chooses Personal. Then `ab find role combobox click --name "How far this answer reaches"` and `ab find role option click --name "Their Personal"`. The sentence reads `From now on, mail from grace@example.net that is Personal is kept. sift still reads each message, and asks about anything else from them.` Save; the panel moves to `?message=m8`.
- **Second view.** `ab open "$B/rules"`. The heading meta reads `5 · the most specific one wins`; rows read `from deals@promo.example.com` / `Anything` / `ARCHIVE` and `from grace@example.net` / `When it is Personal` / `sift reads each one`, both `You, correcting sift`.
- **Stored.** `verify.sh sql "$RUN" "SELECT match_json, label_id, when_label, disposition FROM rules WHERE source = 'correction'"` returns the Deals rule with only `disposition` `archive`, and Grace's with only `when_label` `personal`. `SELECT message_id, label_id FROM examples` returns `m4` with no label, `m6` and `m7` with `personal`. `actions` is empty.

## Gotchas

- A row shows the sender's name, not the address; the address is in the panel.
- Each subject is in its row twice, once in a copy shown only on phones, so `find text "<subject>"` reaches the hidden one and fails. Use `find role cell`.
- Rows have no accessible name. `find role row --name` matches nothing.
- Keys work only while focus is not in a text field, and not at all when the reader has turned shortcuts off (Settings, `Keyboard`, kept per browser).
- The toast's wording can differ slightly from the sentence (Grace's says `kept in your inbox`).
- The example stays `pending`: its body is captured on the next pass, and `sift dashboard` never runs one.
- Answering re-decides the other waiting mail. A second answer in the same run starts from a changed list.
