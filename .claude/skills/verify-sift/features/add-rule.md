# Add a rule

On the Rules screen the user writes a rule directly: a condition, then what it says (an action, a label, or an action for mail sift says is a given label). Mail already waiting that the rule now covers stops being a suggestion.

## Sub-features

- `rule-mail` chooses what to match (`Match mail`: `from`, `on the list`, `sent to`, `with a subject containing`) and the value (`Value to match`). `from` takes an address or a domain; the hint says `Anyone at …` or `Only this address`.
- `rule-facts` adds conditions on what sift saw in the message (`Add a condition`, then `Condition 1`, …); see message-facts.md.
- `rule-label` chooses `Label it as` (`No label, just act`, or a label); `Only when it is, in your words` narrows a label rule.
- `rule-action` chooses `What happens to it` (`Archive`, `Spam`, `Keep`).
- `rule-add` adds it to the list; waiting suggestions it covers are re-decided. A rule with exactly the conditions of one already there (no exceptions, waiting for no label) replaces it; the dialog shows `Replaces` with what that rule says.
- `rule-remove` removes a rule from its row.

## How to get to it (user POV)

- Rules, then `Add a rule`.
- Remove: the `Remove` button on a rule's row.

## Driving it with verify.sh

Preconditions:

- Fresh seed (counts in [README.md](README.md)). For review has a row from `deals@promo.example.com`; Rules has, among others, `anyone at promo.example.com` → `Spam`.

- **Open the dialog.** `ab open "$B/rules"`, then `ab find role button click --name "Add a rule"`. A level-2 heading `Add a rule` appears with `Add rule` disabled; `Match mail` reads `from`, `Label it as` reads `No label, just act`, `What happens to it` reads `Archive`.
- **Value.** `ab find role textbox fill "deals@promo.example.com" --name "Value to match"`. The hint reads `Only this address`; `Add rule` is enabled.
- **Add.** `ab find role button click --name "Add rule"`. A toast reads `Rule added` and `Apply to your inbox` opens over the list; it reads Gmail, so here it says `Sift has no access to me@example.org.` Press `Cancel`. The new rule's panel is open: `Then` `Archive`, `Used` `1 time, last just now`, and `In your inbox` `1` lists `48 hours only: 30% off` (decided, not moved: sift is off). `Close`: the list has `deals@promo.example.com` above `anyone at promo.example.com`.
- **Effect on what is waiting.** `ab open "$B/"`. The link's count is one fewer and there is no Deals row.
- **Stored.** `verify.sh sql "$RUN" "SELECT disposition, label_id, source, hits FROM rules ORDER BY created_at DESC LIMIT 1"` returns `archive`, null, `user`, `1`; `SELECT count(*) AS n FROM rules` is one more than before; `SELECT stage, disposition FROM decisions WHERE message_id = 'm4' ORDER BY id DESC LIMIT 1` is `rules`, `archive` (the new rule sits above the Spam one). No `actions` row but the seed's filters.

## Gotchas

- `Escape` may not close the dialog; use `Cancel`.
- Writing a rule to Gmail as a filter needs Google and sift on, so it cannot be shown here.
- `anyone at promo.example.com` has exactly the conditions of the seed's Spam rule, so adding it replaces that rule (`Replaces` in the dialog) and the count stays the same. Use an address with no rule to prove adding.
- `rule-remove` is refused here: removal asks Gmail first (SKILL.md, What this cannot show).
