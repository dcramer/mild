# Rules from a shortcut

Wherever sift offers to make a rule outside the Rules screen, the press opens the rule dialog in place, started on everything that place knows, so the user sees and can change the rule before adding it. Nothing makes a rule in one press. Closing the dialog changes nothing.

## Sub-features

- `shortcut-proposal`: Suggestions' `Make a rule?` line. `Make a rule…` opens the dialog on the proposal's sender and label; adding resolves the proposal, whatever the user changed; `Cancel` leaves it. `Dismiss` is one press and makes no rule.
- `shortcut-stop-reading`: a `Stop checking?` line (a rule that waits for a label, after ten agreeing messages). `Stop reading them…` opens a dialog that says what happens `Now` and `After`; `Stop reading them` in it changes the rule.
- `shortcut-message`: the message panel's `Make a rule…`, on the sender and the label the message has.
- `shortcut-fact`: a `What sift saw` row's `Rule…`, on the sender and that fact, or on the list (see message-facts.md).
- `shortcut-standing`: `Trust`, `Unwanted`, `Block` on a sender's or domain's page, on that address or domain, no label, and `Keep`, `Archive` or `Spam`. Pressing the standing that is on takes it back in one press.
- `shortcut-replaces`: when the dialog's conditions are exactly those of a rule already there, a `Replaces` line names what that rule says, and adding replaces it.

## How to get to it (user POV)

- Suggestions, the line above the list.
- Any message, `Make a rule…` at the top of the panel or `Rule…` beside what sift saw.
- A sender's name anywhere, then `Your say` on their page; or the domain linked from it.

## Driving it with verify.sh

Preconditions:

- Fresh seed. Suggestions shows `Make a rule? The last 3 from billing@utility.example.net were Receipts and transactions.`

- **Open on a proposal.** `ab open "$B/"`, `ab find role button click --name "Make a rule…"`. Add a rule opens over Suggestions: `Value to match` reads `billing@utility.example.net`, `Label it as` reads `Receipts and transactions`.
- **Close.** `ab find role button click --name "Cancel"`. The line is still there; `verify.sh sql "$RUN" "SELECT status FROM proposals"` is `open`.
- **Change and add.** `Make a rule…` again, `ab find role textbox fill "utility.example.net" --name "Value to match"`, `ab find role combobox click --name "Label it as"`, `ab find role option click --name "Notifications"`, `ab find role button click --name "Add rule"`. A toast reads `Added a rule for mail from anyone at utility.example.net.` and the line is gone. `proposals` is `accepted`; `SELECT match::text, label_id FROM rules WHERE match::text LIKE '%utility%'` is `{"fromDomain": "utility.example.net"}`, `notification`. Rules has the row `anyone at utility.example.net → Notifications`.
- **From a message.** `ab open "$B/?message=m8&account=me%40example.org"`, `ab find role button click --name "Make a rule…"`. The dialog shows `sale@store.example.com` and `Label it as` `Marketing`; the address still has `?message=m8`. `Cancel`.
- **From a fact or a list.** On `?message=m4`, `ab find role button click --name "Make a rule for mail that came through a mailing list"`: `Match mail` reads `on the list`, the value `promo.example.com`, `What happens to it` `Archive`. `Cancel`.
- **A standing.** `ab open "$B/sender/me%40example.org/ada%40example.org"`, `ab find role button click --name "Trust"`. The dialog shows `ada@example.org`, `No label, just act`, `Keep`. `Add rule`: the page reads `Their mail always stays in your inbox.` Then `Unwanted`: the dialog shows `Replaces` `Keep` and `Archive`. `Add rule`: one rule for Ada, `disposition` `archive`. `Unwanted` again: `None given`, and no rule for Ada.
- **A domain.** `ab open "$B/domain/me%40example.org/promo.example.com"`, `Block`: `promo.example.com`, hint `Anyone at promo.example.com`, `Spam`. `Cancel`.
- **Phone.** `ab set viewport 390 844`. The proposal line's text wraps above its two buttons; the dialog covers the screen with labels above their controls. `ab eval "document.documentElement.scrollWidth - document.documentElement.clientWidth"` is `0`.
- After all of it, `actions` is empty and `ab console` and `ab errors` print nothing.

## Gotchas

- The seed has no `Stop checking?` proposal: it needs ten messages a judged rule was checked against. Prove it with `tests/dashboard.test.ts`.
