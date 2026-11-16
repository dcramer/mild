# Add a rule

On the Rules screen the user writes a rule directly: a condition, then what it says (an action, a label, or an action for mail sift says is a given label). Mail already waiting that the rule now covers stops being a suggestion.

## Sub-features

- `rule-condition` chooses what to match: `From the address`, `From anyone at`, `On the list`, `Sent to`, `Subject contains`.
- `rule-kind` chooses what the rule says: `Always do this to it`, `It is always this label`, `When sift says it is this label`.
- `rule-action` chooses `Keep it`, `Archive it` or `Spam it`, with `Mark it read` and `Unsubscribe, when the sender offers a safe way`.
- `rule-add` adds it to the list; waiting suggestions it covers are re-decided.
- `rule-remove` removes a rule from its row.

## How to get to it (user POV)

- Rules, then `Add a rule`.
- Remove: the `Remove` button on a rule's row.

## Driving it with verify.sh

Preconditions:

- Fresh seed. Rules shows 3 rules; Suggestions shows 3 waiting, one from `deals@promo.example.com`.

- **Open the dialog.** `ab open "$B/rules"`, then `ab find role button click --name "Add a rule"`. A level-2 heading `Add a rule` appears with `Add rule` disabled.
- **Condition.** `ab find role combobox click --name "Condition"`, then `ab find role option click --name "From anyone at"`.
- **Value.** `ab find role textbox fill "promo.example.com" --name "Value to match"`. `Add rule` is enabled. `What the rule says` stays `Always do this to it` and `What sift does` stays `Archive it`.
- **Add.** `ab find role button click --name "Add rule"`. The dialog closes and a row reads `from anyone at promo.example.com`; the heading meta reads `4 · the most specific one wins`.
- **Effect on what is waiting.** `ab open "$B/suggestions"`. The link reads `Suggestions 2` and there is no Deals row.
- **Stored.** `verify.sh sql "$RUN" "SELECT match_json, disposition, source FROM rules WHERE match_json LIKE '%promo%'"` returns `{"fromDomain":"promo.example.com"}`, `archive`, `user`. `actions` is empty.

## Gotchas

- `What sift does` only appears for `Always do this to it` and `When sift says it is this label`; `It is always this label` shows a label picker instead.
- `Escape` may not close the dialog; use `Cancel`.
- Writing a rule to Gmail as a filter needs Google and acting, so it cannot be shown here.
