# Add a rule

On the Rules screen the user writes a rule directly: a condition, then what it says (an action, a label, or an action for mail sift says is a given label). Mail already waiting that the rule now covers stops being a suggestion.

## Sub-features

- `rule-mail` is one list of lines (`Condition 1`, `Value 1`, `Remove condition 1`, …; `Add a condition` adds a line of the kind before it). A line's kind is `from`, `named`, `name contains`, `on the list`, `sent to` or `subject contains`, with a value, or an answer about what sift saw in the message (see message-facts.md), with none. Lines of one kind are alternatives; different kinds must all hold. `from` takes an address or a domain. The hint says `Only this address` for one address, and reads the rule back (`Mail from … or from anyone at …`) once there is a domain or more than one value.
- `rule-name` is optional (`Name`); the Rules list, sender pages and a decision's reason say it in place of the conditions, and the rule's panel lists them under `Mail`.
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

- **Open the dialog.** `ab open "$B/rules"`, then `ab find role button click --name "Add a rule"`. It opens on `What should it do?` with `Fill in the rule` (which calls the model; the seed's key is made up, so it fails here) and `Write it yourself`: `ab find role button click --name "Write it yourself"`. The form is in three parts, `Which mail`, `What it is` and `What happens`, with `Add rule` disabled; `Condition 1` reads `from`, `Label it as` reads `No label, just act`, `What happens to it` reads `Archive`.
- **Value.** `ab find label "Value 1" fill "deals@promo.example.com"`. The hint reads `Only this address`; `Add rule` is enabled.
- **Several values, and a name** (instead of the value above). `Value 1` `example.com`, `Add a condition`, `Value 2` `shop@example.net`, `Add a condition`, `Condition 3` → `subject contains`, `Value 3` `receipt`, `Name` `Shop receipts`. The hint reads `Mail from shop@example.net or from anyone at example.com, with a subject containing “receipt”.`; once added the list's row reads `Shop receipts → Archive`.
- **Add.** `ab find role button click --name "Add rule"`. A toast reads `Rule added` and `Apply to your inbox` opens over the list; it reads Gmail, so here it says `Sift has no access to me@example.org.` Press `Cancel`. The new rule's panel is open: `Then` `Archive`, `Used` `1 time, last just now`, and `In your inbox` `1` lists `48 hours only: 30% off` (decided, not moved: sift is off). `Close`: the list has `deals@promo.example.com` above `anyone at promo.example.com`.
- **Effect on what is waiting.** `ab open "$B/"`. The link's count is one fewer and there is no Deals row.
- **Stored.** `verify.sh sql "$RUN" "SELECT disposition, label_id, source, hits FROM rules ORDER BY created_at DESC LIMIT 1"` returns `archive`, null, `user`, `1`; `SELECT count(*) AS n FROM rules` is one more than before; `SELECT stage, disposition FROM decisions WHERE message_id = 'm4' ORDER BY id DESC LIMIT 1` is `rules`, `archive` (the new rule sits above the Spam one). No `actions` row but the seed's filters.
- **Remove.** `ab open "$B/rules"`, `ab find role cell click --name "deals@promo.example.com"`, `ab find role button click --name "Remove"`: the panel asks `Remove this rule?`. `ab find role button click --name "Remove" --exact`. The panel closes and the row is gone; `SELECT count(*) AS n FROM rules` is back to what it was. It had no filter, so `$RUN/gmail.json` is unchanged and `actions` has no `unfilter` row.

## Gotchas

- The dialog has no Cancel: close it with its close button (top right) or `Escape`.
- Writing a rule to Gmail as a filter needs Google and sift on, so it cannot be shown here.
- `anyone at promo.example.com` has exactly the conditions of the seed's Spam rule, so adding it replaces that rule (`Replaces` in the dialog) and the count stays the same. Use an address with no rule to prove adding.
- Removing a rule asks Gmail for its filter first, even with none recorded; here the fake answers (SKILL.md). Removing one that is a filter is in [gmail-filter.md](gmail-filter.md).
- Every row's `Remove` has the same name, so remove from the rule's panel, not the list.
