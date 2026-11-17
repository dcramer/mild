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

- Fresh seed. For review shows 4 waiting, one from `deals@promo.example.com`.

- **Open the dialog.** `ab open "$B/rules"`, then `ab find role button click --name "Add a rule"`. A level-2 heading `Add a rule` appears with `Add rule` disabled; `Match mail` reads `from`, `Label it as` reads `No label, just act`, `What happens to it` reads `Archive`.
- **Value.** `ab find role textbox fill "promo.example.com" --name "Value to match"`. `Add rule` is enabled.
- **Add.** `ab find role button click --name "Add rule"`. The dialog closes and a row reads `anyone at promo.example.com` with `Archive`.
- **Effect on what is waiting.** `ab open "$B/"`. The link reads `For review 3` and there is no Deals row.
- **Stored.** `verify.sh sql "$RUN" "SELECT match, disposition, label_id, source FROM rules WHERE match->>'fromDomain' = 'promo.example.com'"` returns `{"fromDomain":"promo.example.com"}`, `archive`, null, `user`. `actions` is empty.

## Gotchas

- `Escape` may not close the dialog; use `Cancel`.
- Writing a rule to Gmail as a filter needs Google and sift on, so it cannot be shown here.
