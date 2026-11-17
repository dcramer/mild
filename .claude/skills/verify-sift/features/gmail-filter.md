# A rule as a Gmail filter

A rule Gmail can run itself can be added to Gmail as a filter, so its mail is handled without Sift. Each rule's panel says whether it is a filter and what happened to it there, and the Rules list says which rules Gmail did not take.

## Sub-features

- `filter-state`: `In Gmail` on a rule's panel: `Gmail runs this rule as a filter.`, `Its filter was deleted in Gmail. Sift will not put it back.`, `Gmail could run this by itself once Sift is on.`, or why it cannot be one; with its history (`Added to Gmail`, `Removed from Gmail`, `Deleted in Gmail`, `Not added to Gmail`).
- `filter-failed`: the line above Rules, `Gmail did not take the filter change for 1 rule. See it`.
- `filter-remove`: `Remove from Gmail` on a rule that is a filter; the rule stays.
- `filter-add`: `Add to Gmail…`, only while Sift is on, then `Add it to Gmail as a filter?` and `Add to Gmail`.
- `filter-rule-remove`: removing a rule that is a filter takes the filter out first.

## How to get to it (user POV)

- Rules, a rule's row, then `In Gmail` in its panel.
- Settings, `Active`, `Turn on`, before Add to Gmail is offered.

## Driving it with verify.sh

Preconditions:

- Fresh seed. `$RUN/gmail.json` holds one filter for `me@example.org`, `f1-@ci.example.org`. Rules shows `anyone at news.example.com` `Not added to Gmail`, `orders@shop.example.com` `Deleted in Gmail`, `anyone at ci.example.org` `In Gmail`, and the failed line above them.

- **Remove from Gmail.** `ab open "$B/rules"`, `ab find role cell click --name "anyone at ci.example.org"`. `In Gmail` reads `Gmail runs this rule as a filter.` `ab find role button click --name "Remove from Gmail"`. A toast reads `Removed from Gmail`; `In Gmail` reads `Gmail could run this by itself once Sift is on.` with `Removed from Gmail` in its history. `$RUN/gmail.json` has no filters; `SELECT type, status FROM actions ORDER BY id DESC LIMIT 1` is `unfilter`, `done`; the rule is still there.
- **Turn Sift on.** `ab open "$B/?settings=1"`, `ab find role button click --name "Turn on" --exact`; it asks `Archive, label and mark spam on new mail by itself?`; `ab find role button click --name "Turn on" --exact` again. `Active` reads `On`; `SELECT active FROM preferences` has `true` for person 1.
- **Add to Gmail.** Back on the ci rule's panel, `ab find role button click --name "Add to Gmail…"`. A dialog `Add it to Gmail as a filter?` says mail the filter archives never reaches Sift. `ab find role button click --name "Add to Gmail" --exact`. `In Gmail` reads `Gmail runs this rule as a filter.`, its history ends `Added to Gmail`, `$RUN/gmail.json` holds the filter again, and the newest `actions` row is `filter`, `done`.
- **Remove the rule.** `ab find role button click --name "Remove"`, then `ab find role button click --name "Remove" --exact` on `Remove this rule?`. The row is gone, `$RUN/gmail.json` has no filters, and the newest `actions` row is `unfilter`, `done`.
- After all of it, `SELECT count(*) AS n FROM actions WHERE type NOT IN ('filter', 'unfilter')` is `0`, and `ab console` and `ab errors` print nothing.

## Gotchas

- The fake Gmail takes every filter it is asked for and never deletes one on its own; the seed's news and shop states were made in the seed and cannot be made again from the page.
- Removing a rule is a rule change, so For review re-decides and Deals goes to the seed's promo → Spam rule (SKILL.md).
- A rule with a fact condition or a Spam action cannot be a filter; its panel says why.
