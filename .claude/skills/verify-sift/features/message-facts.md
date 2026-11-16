# What sift saw in a message

An opened message lists what sift saw in it that the reader can use (a mailing list, a one-click unsubscribe, a reply, attachments, a tracking pixel), each in the words of the rule condition it makes. A rule can carry those conditions, and Suggestions and Activity can be narrowed by a few of them.

## Sub-features

- `facts-panel`: the message panel's `What sift saw` section; each row with a `Rule…` press (named `Make a rule for mail that …`) that opens Add a rule over the panel, started on the sender and that fact, or on the list.
- `facts-rule`: in Add a rule, `That` holds conditions on facts (`Add a condition`, a `Condition N` select per condition, `Remove “…”` beside it). With one, the address may be left empty: `From anyone`.
- `facts-rules-list`: a rule's facts read after its sender on Rules: `mail that is in Promotions`, `the list promo.example.com, that has a tracking pixel`.
- `facts-filter`: `What sift saw` in the Filters panel of Suggestions and Activity (not Activity's Failed view); the chip reads `Mail that …`.

## How to get to it (user POV)

- Open any message from Suggestions or Activity; `What sift saw` is in the right-hand column (under the sender on a phone).
- Rules, then `Add a rule`, then `Add a condition`.
- Suggestions or Activity, then `Filters`, then a choice under `What sift saw`.

## Driving it with verify.sh

Preconditions:

- Fresh seed. Suggestions shows 4 waiting (Deals, Ada, Grace, Store); Rules shows 3 rules.

- **See the facts.** `ab open "$B/suggestions?message=m4&account=me%40example.org"`. `What sift saw` lists `Came through a mailing list` (`promo.example.com`), `Has a one-click unsubscribe` (`sift can use it`), `Was sent through a bulk mail service` (`Mailchimp`), `Has replies going elsewhere`, `Is in Promotions`, `Has a tracking pixel` (`And its links are tracked`). `?message=m7` shows only `Has attachments`; `?message=m6` only `Is a reply`.
- **Rule from a fact.** On m4, `ab find role button click --name "Make a rule for mail that has a one-click unsubscribe"`. Add a rule opens over the panel (the address is unchanged) and shows `deals@promo.example.com` and `has a one-click unsubscribe`. `Cancel`.
- **Rule from the editor.** `ab open "$B/rules"`, `ab find role button click --name "Add a rule"`, `ab find role button click --name "Add a condition"`, `ab find role combobox click --name "Condition 1"`, `ab find role option click --name "is in Promotions"`. The hint under Mail reads `From anyone`. `ab find role button click --name "Add rule"`.
- **On Rules, and in a new decision.** A row reads `mail that is in Promotions → Archive`; the masthead reads `Suggestions 2`. `verify.sh sql "$RUN" "SELECT message_id, stage, reason FROM decisions WHERE message_id IN ('m4','m8') ORDER BY id"` ends with two `rules` rows reading `rule: is in Promotions: archive it`, and `SELECT match::text FROM rules` has `{"facts": {"category": "promotions"}}`.
- **Filter Suggestions.** On a fresh seed, `ab open "$B/suggestions"`, `ab find role button click --name "Filters"`, `ab find role radio click --name "Is a reply"`. Only Ada's row is left; the address has `?fact=reply`; closing Filters shows the chip `Mail that is a reply`.
- **Filter Activity.** `ab open "$B/activity?show=all"`, `Filters`, `ab find role radio click --name "Has a one-click unsubscribe"`. Only Weekly Digest, Deals and Store rows are left.
- **Phone.** `ab set viewport 390 844` and repeat any step: the facts rows keep their `Rule…`; Add a rule's labels sit above their controls; Activity's Changed, Everything and Failed take a row under the search. `ab eval "document.documentElement.scrollWidth - document.documentElement.clientWidth"` is `0`.

## Gotchas

- Attachments and tracking are known only for mail a model has read; on other mail those conditions and filters match nothing.
- A rule with a fact condition cannot be a Gmail filter, and Gmail filters cannot be shown here anyway.
