# Guidelines

The user's own words about how to sort their mail, which the model reads before each message. Written and saved under Settings; kept as `guidelines.md` in sift's home.

## Sub-features

- `guidelines-edit` types into the `Guidelines` textbox; the button turns from `Saved` (disabled) to `Save`.
- `guidelines-save` writes them; the button returns to `Saved`.

## How to get to it (user POV)

- Settings, `Guidelines`, then `Save`.

## Driving it with verify.sh

Preconditions:

- Fresh seed. There is no `$RUN/home/guidelines.md`.

- **Open.** `ab open "$B/settings"`. A level-2 heading `Guidelines`, an empty `Guidelines` textbox, and `Saved` disabled.
- **Write.** `ab find role textbox fill "Keep anything from my bank." --name "Guidelines"`. The button reads `Save` and is enabled.
- **Save.** `ab find role button click --name "Save"`. The button reads `Saved` and is disabled again.
- **Second view.** `ab reload`. The textbox still holds `Keep anything from my bank.`
- **Stored.** `cat "$RUN/home/guidelines.md"` prints `Keep anything from my bank.` `actions` is empty.

## Gotchas

- There is no model in the seed, so this proves the text is kept, not that the model reads it. That is `tests/model.test.ts`.
- `Save` is the only button by that name on Settings; on Labels and other screens with an open editor, scope by the dialog first.
