# sift verification map

The maintained recipes for proving what a dashboard user sees and does. Read this, then the feature file for what changed.

## Baseline preconditions

- A run started with `verify.sh up "$RUN"` in a new directory, and `verify.sh doctor "$RUN"` printing `ok`.
- The seed as SKILL.md describes it: account `me@example.org` with a second, empty mailbox `me@work.example.org`, and a second person `bravo@example.net` who cannot be signed in to; sift off, Anthropic in use with a made-up key (a stand-in that places nothing judged the seed mail); 4 suggestions (Deals, Ada Lovelace, Grace Hopper as `Which label?`; Store as `Marketing`); one proposal (`Make a rule?` for `billing@utility.example.net` as Receipts and transactions); 3 user rules; the default labels.
- `B=http://127.0.0.1:$(cat "$RUN/port")`, and `ab` below means `verify.sh ab "$RUN"`.
- Never drive an instance this run did not start.

## Driving conventions

- Start each recipe from a fresh seed unless it says otherwise. Recipes change rules and labels, so two in one run interact: answering one suggestion re-decides the others.
- Find by role and accessible name (`ab find role button click --name "Save answer"`). Table rows have no name to find by. Open a suggestion by its subject cell, `ab find role cell click --name "<subject>"`; `find text` on a subject reaches the hidden phone copy and fails. Open a label with `ab find text "<label name>" click --exact`.
- Pick from a combobox with two steps: `ab find role combobox click --name "<combobox>"`, then `ab find role option click --name "<option>"`.
- After every action, wait for the result you expect to see, not a fixed time.

## Proof and skip reporting

- Before and after: a snapshot or screenshot of the state the action changed, in `$RUN/evidence/`.
- `ab console` and `ab errors` empty after the journey.
- The stored row, via `verify.sh sql`, and a second screen that shows it.
- `SELECT count(*) AS n FROM actions` is `0`.
- Name the feature and entry point with each artifact. An entry point not driven is reported as not verified, not covered by another.

## Feature entry contract

An H1 and one paragraph of what the user gets, then four H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify.sh`, `Gotchas`. The driving section starts with `Preconditions:` and pairs each user action with its command and what should be visible after it. User paths and handles only, no implementation.

## Features

- [Agree with a suggestion](./agree-suggestion.md): press the check beside the label sift gave a row.
- [Answer a suggestion](./answer-suggestion.md): teach sift what a waiting message is, and the rule that makes.
- [Add a rule](./add-rule.md): a rule made on the Rules screen, and its effect on what is waiting.
- [Rules from a shortcut](./rule-shortcuts.md): every other press that makes a rule opens the rule dialog in place, started on what that place knows: a proposal, a message, a fact, a standing.
- [Edit a label](./edit-label.md): change what a label does.
- [Read a message as its HTML](./message-html.md): the Text and HTML choice in the message panel, and that nothing remote loads.
- [What sift saw in a message](./message-facts.md): the facts shown on an opened message, rules on them, and lists narrowed by them.
- [Remove a mailbox, delete the account](./remove-mailbox.md): what sift holds about a mailbox, or a whole person, goes.
