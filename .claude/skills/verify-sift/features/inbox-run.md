# Go through the inbox, apply a rule to it

Mail already in the inbox when Sift starts, or when a rule is added, is not looked at by itself. The user can have Sift go through the inbox from Settings, after seeing what it would cost, or apply one rule to the mail it covers there. Either is a run in the background, one for each mailbox, that the user can stop.

## Sub-features

- `inbox-go`: Settings' `Your inbox` (`2,412 messages. Going through them costs about $3.10.`), `Go through…`, then `Go through your inbox?` with `In your inbox`, `Need the model`, `About` and the model, and `Go through 2,412` or `Not now`. The same dialog opens after turning Sift on.
- `inbox-progress`: while it runs, Settings' section is `Going through your inbox`, `Reading your inbox · N found`, with `Stop`; once stopped, `Stopped after N messages … · $N` and `Go through again…`.
- `apply-rule`: `Apply to inbox…` on a rule's panel (and `Apply to your inbox`, opened after adding a rule that moves mail): `In your inbox` `About N`, the newest it found, and the press named by the action (`Archive all`, …) or `Cancel`.
- `apply-progress`: the panel's `Still in your inbox` shows `Finding them in Gmail · N so far` with `Stop` while the run goes, then `Apply to inbox…` again.

## How to get to it (user POV)

- Settings (`?settings=1`), `Your inbox`, `Go through…`; or Settings, `Turn on` twice.
- Rules, a rule that archives or marks spam, `Apply to inbox…`; or `Add rule` with `Apply to mail already there` ticked.

## Driving it with verify.sh

Preconditions:

- Fresh seed. For the run that stays under way until stopped, start it with `verify.sh up "$RUN" --listing`.

- **Go through.** `ab open "$B/?settings=1"`, `ab find role button click --name "Go through…"`. `Go through your inbox?` reads `In your inbox` `2,412`, `Need the model` `1,830`, `About` `$3.10` `on claude-haiku-4-5`. `ab find role button click --name "Go through 2,412"`: Settings shows `Going through your inbox`, `Reading your inbox · 0 found` and `Stop`, and stays there (no pass is given a model).
- **Stop it.** `ab find role button click --name "Stop"`. `Your inbox` reads `Stopped after 0 messages just now · $0` with `Go through again…`. `verify.sh sql "$RUN" "SELECT account_id, stopped, finished_at IS NOT NULL AS done FROM inbox_runs WHERE rule_id IS NULL"` is one row a mailbox, `me@example.org` and `me@work.example.org`, each `true`, `true`.
- **Apply a rule.** `ab open "$B/rules"`, `ab find role cell click --name "anyone at ci.example.org"`, `ab find role button click --name "Apply to inbox…"`. `Apply to your inbox` reads `anyone at ci.example.org → Archive`, `About 1,200`, and `Found in Gmail 1` to `5` under `Newest`. `ab find role button click --name "Archive all"`: the panel's `Still in your inbox` shows `Finding them in Gmail · 0 so far` and `Stop`. `SELECT rule_id, listed, finished_at IS NOT NULL AS done FROM inbox_runs WHERE rule_id IS NOT NULL` is one row a mailbox, each finished within a second; the panel catches up at its next look, about fifteen seconds, and shows `Apply to inbox…` again.
- **Stop applying.** In a `--listing` run, the same press leaves the panel at `Finding them in Gmail · 0 so far`, and the runs' `finished_at` stays null. `ab find role button click --name "Stop"`: the panel shows `Apply to inbox…` again, and both runs are `stopped`.
- `SELECT count(*) AS n FROM actions WHERE type NOT IN ('filter', 'unfilter')` is still `0`, and `ab console` and `ab errors` print nothing.

## Gotchas

- Every count here is the stand-in's (SKILL.md): `About 1,200` and `Found in Gmail` whatever the rule, `2,412` for any inbox. Whether the run finds and moves the right mail is for `tests/run.test.ts` and a real account.
- A rule that moves nothing (one that leaves mail in the inbox) offers no `Apply to your inbox` after adding.
