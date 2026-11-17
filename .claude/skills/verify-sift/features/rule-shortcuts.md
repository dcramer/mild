# Rules from a shortcut

Wherever sift offers to make a rule outside the Rules screen, the press opens the rule dialog in place, started on everything that place knows, so the user sees and can change the rule before adding it. It opens on `What should it do?` with that rule already said in words; `Write it yourself` shows the form, filled in the same. Nothing makes a rule in one press. Closing the dialog changes nothing.

## Sub-features

- `shortcut-proposal`: For review's proposal line (`Keep Receipts from …?`). `Make a rule…` opens the dialog on the proposal's sender, waiting for its label (`Only when it is this label`), then doing what the user has been doing; adding resolves the proposal, whatever the user changed; closing the dialog leaves it. `Dismiss` is one press and makes no rule.
- `shortcut-message`: the message panel's `Make a rule…`, on the sender and the label the message has; and `Keep as <label>…` beside it, on the sender once a model gives that label, keeping it.
- `shortcut-fact`: a `What Sift saw` row's `Rule…`, on the sender and that fact, or on the list (see message-facts.md).
- `shortcut-standing`: `Trust`, `Unwanted`, `Block` (the group `Where <name> stands`) on a sender's or domain's page, on that address or domain: `Leave in inbox` as the label for Trust, or no label and `Archive` or `Spam`. Adding one opens the rule's panel (`?rule=<id>`). Pressing the standing that is on takes it back in one press.
- `shortcut-sender`: a sender's page's own `Make a rule…` beside `Where <name> stands`, on that address and its label; under `Names` (an address several names write from), one per name, on the address and that name; under `What it is` (one name, mail under more than one label), one per label.
- `shortcut-replaces`: when the dialog's conditions are exactly those of a rule already there, a `Replaces` line names what that rule says, and adding replaces it.

## How to get to it (user POV)

- For review, the line above the list.
- Any message, `Make a rule…` at the top of the panel or `Rule…` beside what sift saw.
- A sender's name anywhere, then `Where <their name> stands` on their page; or the domain linked from it.

## Driving it with verify.sh

Preconditions:

- Fresh seed. For review shows `Keep Receipts from billing@utility.example.net? You kept the last 3, but the label archives them.`

- **Open on a proposal.** `ab open "$B/"`, `ab find role button click --name "Make a rule…"`. Add a rule opens over For review, `What should it do?` reading `Mail from billing@utility.example.net, once it is Receipts: leave it in the inbox.` `ab find role button click --name "Write it yourself"`: `Condition 1` reads `from`, `Value 1` `billing@utility.example.net`, `Only when it is this label` `Receipts`, `What happens to it` `Keep`, and a line says `A model reads each message it matches to tell.`
- **Close.** `ab press Escape`. The line is still there; `verify.sh sql "$RUN" "SELECT status FROM proposals"` is `open`.
- **Change and add.** `Make a rule…` again, `Write it yourself`, `ab find role textbox fill "utility.example.net" --name "Value 1"`: the hint reads `Mail from anyone at utility.example.net.` `ab find role button click --name "Add rule" --exact`. A toast reads `Rule added`, the address gets `?rule=<id>&apply=1`, `Apply to your inbox` opens (`Cancel`; it reads Gmail), and the line is gone. `SELECT status FROM proposals` is `accepted`; `SELECT label_id, when_label, disposition, source FROM rules ORDER BY created_at DESC LIMIT 1` is null, `transactional`, `keep`, `user`. Rules has the row `anyone at utility.example.net as Receipts` with `Keep`.
- **From a message.** `ab open "$B/?message=m8&account=me%40example.org"`, `ab find role button click --name "Make a rule…"`. The words read `Mail from sale@store.example.com is Marketing.`; `Write it yourself` shows `Value 1` `sale@store.example.com` and `Label it as` `Marketing`; the address still has `?message=m8`. `ab press Escape`. `ab find role button click --name "Keep as Marketing"`: `Mail from sale@store.example.com, once it is Marketing: keep it in the inbox.` `ab press Escape`.
- **From a fact or a list.** On `?message=m4`, `ab find role button click --name "Make a rule for mail that came through a mailing list"`, then `Write it yourself`: `Condition 1` reads `on the list`, `Value 1` `promo.example.com`, `What happens to it` `Archive`. `ab press Escape`.
- **A standing.** `ab open "$B/sender/me%40example.org/ada%40example.org"`, `ab find role button click --name "Trust"`. The words read `Mail from ada@example.org: leave it in the inbox.`; `Write it yourself` shows `ada@example.org`, `Label it as` `Leave in inbox`. `Add rule`: the rule's panel opens (`?rule=<id>`; note the id), `Then` `Leave in inbox`, and says `It only keeps mail in your inbox, which Gmail does anyway.` `Close`. Then `Unwanted`, `Write it yourself`: the dialog shows `Replaces` `Leave in inbox` and `Archive`. `Add rule`, then `Cancel` on `Apply to your inbox`, then `Close`: `Their next mail` reads `Archive`, `Unwanted` is pressed (read `aria-pressed`, SKILL.md), and `SELECT id, disposition FROM rules WHERE id = '<id>'` is the same id with `archive`. `Unwanted` again: none of the three is pressed, and `SELECT count(*) AS n FROM rules WHERE id = '<id>'` is `0`.
- **A sender's page.** `ab open "$B/sender/me%40example.org/notifications%40code.example.com"`. Five `Make a rule…`: the first, beside the standing, reads `Mail from notifications@code.example.com is Notifications.`; under `Names`, Dependabot's reads `Mail from notifications@code.example.com named “Dependabot” is Notifications.` Find each by its ref from `ab snapshot -i` (the names are the same). `What it is` shows on no seeded sender: answer the two Ops alerts with different labels (answer-suggestion.md), then on `/sender/me%40example.org/alerts%40ops.example.com` its rows' `Make a rule…` read `Mail from alerts@ops.example.com is <label>.`
- **A domain.** `ab open "$B/domain/me%40example.org/promo.example.com"`. `Block` is already pressed: the seed's `anyone at promo.example.com` → Spam is the domain's standing, so pressing `Block` would take it back. `Unwanted`, `Write it yourself`: `promo.example.com`, hint `Mail from anyone at promo.example.com.`, `Replaces` `Spam`, `What happens to it` `Archive`. `ab press Escape`.
- **Phone.** `ab set viewport 390 844`. The proposal line's text wraps above its two buttons; the dialog covers the screen, the form in its three parts with labels above their controls. `ab eval "document.documentElement.scrollWidth - document.documentElement.clientWidth"` is `0`.
- After all of it, no `actions` row but the seed's filters, and `ab console` and `ab errors` print nothing.

## Gotchas

- Several buttons share the name `Make a rule…` (the proposal line, the panel, every row of a sender page), and an open panel hides the ones behind it. On a sender page, take refs from a fresh `ab snapshot -i`.
- A rule that moves mail opens `Apply to your inbox` after `Add rule`, because `Apply to mail already there` is ticked by default; it reads Gmail and can only fail here, so press `Cancel`.
- Any rule added re-decides everything waiting, so the seed's promo → Spam rule takes Deals off For review on the first one.
