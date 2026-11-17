# Rules from a shortcut

Wherever sift offers to make a rule outside the Rules screen, the press opens the rule dialog in place, started on everything that place knows, so the user sees and can change the rule before adding it. Nothing makes a rule in one press. Closing the dialog changes nothing.

## Sub-features

- `shortcut-proposal`: For review's proposal line (`Keep Receipts from …?`). `Make a rule…` opens the dialog on the proposal's sender, waiting for its label (`Only when it is this label`), then doing what the user has been doing; adding resolves the proposal, whatever the user changed; `Cancel` leaves it. `Dismiss` is one press and makes no rule.
- `shortcut-stop-reading`: a `Stop checking?` line (a rule that waits for a label, after ten agreeing messages). `Stop reading them…` opens a dialog that says what happens `Now` and `After`; `Stop reading them` in it changes the rule.
- `shortcut-message`: the message panel's `Make a rule…`, on the sender and the label the message has.
- `shortcut-fact`: a `What sift saw` row's `Rule…`, on the sender and that fact, or on the list (see message-facts.md).
- `shortcut-standing`: `Trust`, `Unwanted`, `Block` on a sender's or domain's page, on that address or domain, no label, and `Keep`, `Archive` or `Spam`. Adding one opens the rule's panel (`?rule=<id>`). Pressing the standing that is on takes it back in one press.
- `shortcut-replaces`: when the dialog's conditions are exactly those of a rule already there, a `Replaces` line names what that rule says, and adding replaces it.

## How to get to it (user POV)

- For review, the line above the list.
- Any message, `Make a rule…` at the top of the panel or `Rule…` beside what sift saw.
- A sender's name anywhere, then `Your say` on their page; or the domain linked from it.

## Driving it with verify.sh

Preconditions:

- Fresh seed. For review shows `Keep Receipts from billing@utility.example.net? You kept the last 3, but the label archives them.`

- **Open on a proposal.** `ab open "$B/"`, `ab find role button click --name "Make a rule…"`. Add a rule opens over For review: `Value to match` reads `billing@utility.example.net`, `Only when it is this label` reads `Receipts`, `What happens to it` reads `Keep`, and a line says `A model reads each message it matches to tell.`
- **Close.** `ab find role button click --name "Cancel"`. The line is still there; `verify.sh sql "$RUN" "SELECT status FROM proposals"` is `open`.
- **Change and add.** `Make a rule…` again, `ab find role textbox fill "utility.example.net" --name "Value to match"`, the hint reads `Anyone at utility.example.net`. `ab find role button click --name "Add rule"`. A toast reads `Rule added`, `Apply to your inbox` opens (`Cancel`; it reads Gmail), and the line is gone. `SELECT status FROM proposals` is `accepted`; `SELECT label_id, when_label, disposition, source FROM rules ORDER BY created_at DESC LIMIT 1` is null, `transactional`, `keep`, `user`. Rules has the row `anyone at utility.example.net as Receipts` with `Keep`.
- **From a message.** `ab open "$B/?message=m8&account=me%40example.org"`, `ab find role button click --name "Make a rule…"`. The dialog shows `sale@store.example.com` and `Label it as` `Marketing`; the address still has `?message=m8`. `Cancel`.
- **From a fact or a list.** On `?message=m4`, `ab find role button click --name "Make a rule for mail that came through a mailing list"`: `Match mail` reads `on the list`, the value `promo.example.com`, `What happens to it` `Archive`. `Cancel`.
- **A standing.** `ab open "$B/sender/me%40example.org/ada%40example.org"`, `ab find role button click --name "Trust"`. The dialog shows `ada@example.org`, `No label, just act`, `Keep`. `Add rule`: the rule's panel opens (`?rule=<id>`; note the id) and says `It only keeps mail in your inbox, which Gmail does anyway.` `Close`. Then `Unwanted`: the dialog shows `Replaces` `Keep` and `Archive`. `Add rule`, then `Cancel` on `Apply to your inbox`, then `Close`: `Their next mail` reads `Archive`, `Unwanted` is pressed (read `aria-pressed`, SKILL.md), and `SELECT id, disposition FROM rules WHERE id = '<id>'` is the same id with `archive`. `Unwanted` again: none of the three is pressed, and `SELECT count(*) AS n FROM rules WHERE id = '<id>'` is `0`.
- **A domain.** `ab open "$B/domain/me%40example.org/promo.example.com"`. `Block` is already pressed: the seed's `anyone at promo.example.com` → Spam is the domain's standing, so pressing `Block` would take it back. `Unwanted`: `promo.example.com`, hint `Anyone at promo.example.com`, `Replaces` `Spam`, `What happens to it` `Archive`. `Cancel`.
- **Phone.** `ab set viewport 390 844`. The proposal line's text wraps above its two buttons; the dialog covers the screen with labels above their controls. `ab eval "document.documentElement.scrollWidth - document.documentElement.clientWidth"` is `0`.
- After all of it, no `actions` row but the seed's filters, and `ab console` and `ab errors` print nothing.

## Gotchas

- The seed has no `Stop checking?` proposal: it needs ten messages a judged rule was checked against. Prove it with `tests/dashboard.test.ts`.
