# Design system

The dashboard is built from one small set of parts, in `web/src/system/`. Every part, in every state, is on the specimen page: open the dashboard at `/system`. It needs no sign-in: it shows only made-up examples and asks the server for no data.

![The specimen page](images/design-system.png)

## What it is going for

A proof sheet on a dark desk: ink on near-black, one highlighter pen, hard edges. Calm. Weight and size do the work.

- **Dark only.**
- **Two colours mean something.** Yellow (`highlight`) means "look here": the name, the current section's underline, the headline figure, what is waiting on the reader, a search match. Red (`destructive`) means a failure. Nothing else is coloured; everything else is the ink colour at some strength.
- **As little chrome as it takes.** Nothing on the page has a fill of its own: a list sits straight on it, and a sheet is set apart by a thin frame alone. Only what floats above the page (a panel, a dialog, a menu, a toast) is filled, so it can cover what is under it; the design-system test fails on a surface fill in any other part, and the theme has no grey surface tokens to reach for. A sheet is for a group of settings, not for a list. Inside it, space and type separate things before any line does. Controls are filled (`--fill`), not outlined. Notes and headings have no box and no rule. The only lines inside a sheet are faint dashes between rows (`--rule`).
- **Lines are ink, thinned.** `--frame` for a sheet's edge, `--rule` between rows. Never a separate grey.
- **One shadow.** `--edge`: hard, offset down and right, the edge of the sheet beneath. It belongs to sheets and to what floats (a dialog, a menu). Buttons have none: the highlighted button is a flat stroke of yellow, like the name. Any other shadow fails the design-system test.
- **One word for each thing.** What sift does with mail (Keep, Archive, Spam, Block, Not sure), where a decision got to (Suggested, Done, Undone, Failed…), where a sender stands and which tier decided each have exactly one name, kept in `web/src/lib/format.ts` and used in every filter, select and column. What sift does is its icon and its word (`Does`), and only the action: "Archive", never "Archive + unsubscribe"; what comes with an action is said where the label or rule is edited. A verdict is the action, then the label: "**Archive** as Marketing". A sentence uses the matching phrase (`willBe`). Never write one of these words in a view.
- **Say what the reader can use.** A list shows what something is, what sift said, why, where it got to and when. Model names, token counts, cost per message, confidence and change ids belong in the message panel's history, not in a row.
- **Corners are small and even** (`--corner`, 3px) on everything you press or type in, and on stamps. Only the highlighter stroke and the wordmark are cut by hand (`--cut`). Surfaces are square.
- **Type is by role, set as Peated sets it.** Karla carries everything read. Hanken Grotesk, bold, is for what is named or counted: a page's title (`.statement`, 32 to 40px), a dialog's (`.title`, 26px), a section's heading (`.heading`, 22px, clearly larger than a name so it never reads as the first row), names (`.name`), figures. Display type is tracked tight, tighter as it grows (−0.02em for a name to −0.04em for a title); that is most of what makes it look set rather than typed. Column heads and a figure's label (`.slug`) are Karla at the supporting size in lighter ink, not capitals. IBM Plex Mono is for anything typed or pasted, and nothing else. The wordmark alone is in Bricolage Grotesque. Text is 15px (`text-base`), what supports it 13px (`text-sm`), an opened message 16px (`text-reading`), keycaps 12px (`text-label`), and nothing under 12px. Those four are the only sizes a class can set; titles, figures and the wordmark are role classes. A size typed by eye (`text-[13px]`) fails the design-system test. A button's words are semibold; a select's value is not.
- **One height for controls.** Everything pressed or typed into in a row or a toolbar is `--control` high (32px), so buttons, selects and inputs line up. `lg` is for the one action a screen is about. Somewhere to type (an input, a text area, the search bar) is outlined and empty; anything pressed, a select included, is filled (`--fill`), and stronger on hover. A button is a verb in semibold; a select shows its value in regular weight beside a chevron, so the two never read alike. What cannot be pressed now is not filled: a disabled button is an outline in quiet ink, and a quiet one dims.
- No app bar, no gradients, no pills, no icons as decoration. An icon that names something (an action in `Does`) is not decoration.

Tokens and the role classes are in `web/src/index.css`.

## Parts

| Part | Use |
| --- | --- |
| `Button` | `mark`: what the screen is waiting on, one per screen at most, never down a list. `ink`: what finishes a dialog or form. `plain`: a page's own action (adding to its list),  and anything else said once. `quiet`: repeated down a list, firmer when its row is pointed at, and ways out. With `href` it is a link. `busy` while a press is being acted on. |
| `ConfirmButton` | A press that cannot be taken back (removing a rule, turning sift on). It asks in place, with the same words on the button that does it. Down a list it is an `icon` (a trash can for removing), and the question covers the row from the right rather than widening its column. |
| `Select`, `Input`, `TextArea`, `Check` | Controls. `Select` is for a short list; `icons` puts an icon before a choice (an action's, from `ActionIcon`), in the list and once chosen. |
| `ChoiceGroup` | A few choices seen at once, one on: what a message is, where a sender stands. `numbered` shows the keys that pick them; `clearable` when none is a choice too. |
| `Field`, `Form` | A form is a column of fields with what finishes it last. A field is its label, its controls, what follows from the answer (`hint`) and what is wrong (`error`). `inline` puts the label beside the controls, for a short form in a narrow column. |
| `Masthead` | The top of every screen: the name, the sections (the current one underlined with the highlighter), a `Notice` when there is one, when sift last synced, and who is signed in, as an `Avatar` that opens a `Menu`. No bar. |
| `Notice` | A state of sift itself, true on every screen, in the masthead: sift cannot be reached (plain ink, a pulse: it mends itself), a sign-in has expired (`look`, with a link: the reader mends it). |
| `PageHeader` | The top of every page: its title, and on the right the page's own action or one quiet line of numbers, centred on each other. No count beside the title (the masthead has it) and no sentence under it that says what the page is or how to use it; `meta` is only for naming the page's subject, such as a sender's address. |
| `Section` | A part of a page or a panel under its own heading, with a count and at most one action beside it. Space sets it apart. |
| `ListView`, `FilterGroup` | **How every screen shows many of one thing.** Its search and filters are kept in the address (`useParam`), so a narrowed list can be bookmarked. The page header, anything the page shows first (`intro`), one outlined bar holding the search and the Filters button, then the rows. `view` adds a few ways to see the list as segments at the end of the bar (Activity's Changed, Everything, Failed); use it for whole alternative lists, filters for narrowing one. The filter button opens a panel on the right that pushes the list left. Filters that are on show as a count on the button and, when the panel is closed, as a line of chips that each clear one. |
| `Table`, `Tr`, `Th`, `Td`, `TrGroup`, `Sub`, `OnPhone`, `RowActions` | Rows of the same kind of thing, one row per item: the only way to show a list. No surface of its own; on the page a row reaches a little past its text on both sides (`--bleed`), so the hover has room around what it holds. `Tr onOpen` makes the whole row pressable. `Sub` is a quieter second line in a cell; cells sit in the middle of their row, so a one-line cell beside a two-line one lines up with the pair. `RowActions` is the last cell: quiet presses that act without opening the row, always visible. A list that reads as plain rows can drop its column heads (keep them for screen readers). `TrGroup` heads the rows after it, such as a day, inside the one table, so J and K and the columns run through every group. |
| `AnswerPicker` | Saying what a message is: a dropdown that starts on sift's label, with what else it might be first (each with a `Meter`) and every other label after, and a check that commits. Choosing only chooses, so agreeing is one press and a change is two. Once the choice differs from sift's, the check is inked: the one ink allowed down a list, because a press is now waiting. The answer on every Suggestions row and in the message panel. |
| `Meter` | How sure sift is of a label, in three steps of ink, before the label it qualifies. Its name (Unsure, Fairly sure, Sure) is read out; the steps come from `sureness` in `lib/format.ts`. |
| `Facts`, `Fact` | What is known about one thing, as terms and values: a sender. Leave a fact out rather than give it no value. |
| `Timeline`, `TimelineEvent` | What happened to one thing, oldest first, each with at most one press (Undo). |
| `Entry` | The page in place of the dashboard until it can be used: sign-in, then connecting a model. One sheet, centred, the name across its top edge; under it who is signed in, Settings, Sign out, and the terms and privacy links. A statement says what is needed, one line says why, and one `mark` button moves on. |
| `Sheet`, `SettingRow`, `SettingsGroup` | A group of settings, framed. Each row says what it is, what follows from changing it, and holds its control. Not for a list. A settings page is `SettingsGroup`s: the group's name and what it governs on the left, its sheets on the right, a rule between groups; on a phone they stack. |
| `Figures`, `Figure` | Headline numbers, straight on the page. `look` for the one to see first, `failure` for a count of things gone wrong; `href` links to the list it counts. |
| `StackedBars` | Counts over time, stacked by series, on the left axis. `line` adds a second measure (model cost) on its own right axis; both start at zero and share their gridlines. No legend: pointing at or focusing a column opens a tooltip with that day's figures, the segment under the pointer in bold. `compact` beside figures. |
| `Swatch` | A series' or a tier's colour, always beside its name. |
| `Share` | How much of a whole one row is, as a thin bar along it (a label's share of the mail), with the figure beside it in words. For comparing rows at a glance, not for reading a value off. |
| `Panel` | One item from a list, opened beside the list: it slides over from the right, up to three quarters of the screen (`narrow` for a few facts and a short form, such as a label), with previous and next in its footer to step through the list; `keys` binds K and J to them and shows the keys, only for the message panel. Every list opens a message in the same panel (`views/message-panel.tsx`). Settings is one too, opened from the account menu over any screen, the model wall included (`?settings=1`). |
| `Dialog` | A form or a question: adding or changing a label or a rule. Centred. `footer` for the actions that finish it. A dialog and a panel are one kind of thing (`system/layer.tsx`): the same dimming behind, header, close button, gutters and footer rule, and a dialog opened from a panel dims the panel. Inside either, `--surface` is the layer's own ground, for whatever has to cover a row there (a `ConfirmButton` question). |
| `Toaster`, `useToast` | What a press did, said once in the corner after the list has moved on: what sift learned, what was undone. A failure stays until dismissed and is the only one in red. Never for something the page already shows. |
| `Menu`, `Avatar` | A few things to do, behind one button: under the avatar, who is signed in and Sign out. An item that cannot be pressed says why under its label. An avatar is the initial of an address, never a picture: the page loads nothing from another origin. Choosing one value is a `Select`, not a menu. |
| `HoverCard` | A link that previews where it goes when the pointer rests on it or it takes focus. Only a preview: a touch screen never shows it, so everything in it is also on the page the link opens. |
| `Note` | Said to the reader outside the flow, about the whole page: `plain`, `look` (needs them), `failure`. No box. |
| `Failure` | What went wrong, where it went wrong: under the form or press that failed, or `inline` as the word for a step that failed. Renders nothing without a message. The only red a screen writes. |
| `Reserve` | Holds the room for something above other content that arrives late and whose height depends on what loads (figures, a chart, a notice that may not be there), so the page below does not move. It remembers the height the part last had in this browser, per width; `room` is the usual height until then. |
| `Empty`, `Loading` | What a list shows with nothing in it (say what would put something here), and while rows are on their way. |
| `Does` | What sift does with mail: the action's icon in lighter ink, then its word. Never with what comes with the action (unsubscribe, mark read). "Not sure" is yellow. In every list, column and verdict. |
| `Stamp` | Where a sender stands, in one framed word. Not for what sift does (that is `Does`). |
| `Highlight`, `Marked` | A stroke of highlighter; a search term marked in text. |
| `Look` | A word in yellow ink for what is left to the reader, inside a line: "Not sure" in a list. |
| `TextLink`, `Code`, `Kbd`, `Copyable` | A link in text; something typed; a key, as a small keycap (see Keys); a value carried somewhere else whole. |
| `Disclosure` | What most readers never need, folded under the question that leads to it. |
| `Document`, `Clause` | A page read from top to bottom, outside the dashboard: the terms and the privacy policy. The name linking home, the title, when it last changed, then clauses at the reading size. |
| `Wordmark` | The name. |

`web/src/components/` holds what is particular to sift and built from these: `Verdict` (what sift does and as which label, in words, the same everywhere), `StatusWord`, `TierLabel`, the decision table on a sender's page, the answer form, and `SenderLink`, which is how a sender is named anywhere: a link to their page with a preview of their standing.

## Narrow screens

Every part has an answer for a phone, and a new part needs one before it is added.

On a phone a row keeps only what identifies it and what it is; figures, dates and who made it go to the panel the row opens, and so does anything that cannot be taken back, so a thumb cannot remove something by brushing a row.

| Part | On a narrow screen |
| --- | --- |
| `Masthead` | The sections, the synced line and the account (its address and what its menu holds, as buttons) move into a panel that covers the screen, opened from a menu button. The bar shows the current section's name; a dot on the button means something is waiting in another section. |
| `Notice` | A line of its own under the masthead's bar. |
| `Menu` | Opens under its button, kept inside the screen, with rows 44px tall on a touch screen. The masthead's own is not shown on a narrow screen: its panel lists the same things. |
| `Field inline` | The label goes above the controls. |
| `Facts` | Each term goes above its value. |
| `Panel`, `Dialog` | Cover the screen. |
| `ListView` | The filter panel opens above the list. The view segments take a row of their own under the search, so the search keeps its width. |
| `Table` | Columns marked `phone="hide"` drop; what they said moves under the first column in an `OnPhone`, and the row opens for the rest. `RowActions` drop too, unless the row does not open (`phone="keep"`). |
| Rows with a control | The control wraps under the text. |
| Anything pressed | At least 40px tall on a touch screen (`pointer: coarse`), whatever its size on a desktop. |

The page itself never scrolls sideways.

## Whatever can be pressed shows the pointer

A button, a link, a row that opens, a choice in a menu or a select, a checkbox with its label: each takes `cursor-pointer`, and loses it only while disabled. Nothing that cannot be pressed takes it.

## Keys

A control asks for its key and draws the keycap itself (`shortcut` on a `Button`, `keys` on a `ChoiceGroup`, `useShortcut` anywhere else), so a key that is shown always works and a key that works is always shown. Never bind a key with a listener of your own.

- **The keys are Gmail's** where it has one: `J` and `K` to move, `Enter` or `O` to open, `Esc` to close, `/` to search, `E` archive, `!` spam, `?` for the list of every key live where the reader is. `I` keeps (the inbox), `A` agrees with sift, `1` to `9` say what a message is.
- **A keycap** (`Kbd`) sits after the label, outlined; on a filled control it takes that control's ink.
- **Keys are for working through a list**, one item after another: Suggestions and Activity (`Table keys`), and the panel they open. Every other list, form and step has none: it is pressed, or tabbed through. Don't add keys to a screen because the parts allow it.
- **Down a list** only the row the reader is on shows and answers to its keys.
- **A layer's own controls are a footer** (`ControlBar`, `Control`), the way a game lists its buttons: the key first, then what it does. A table's (Move, Open, Every key) holds at the bottom of the screen while the table is on the page; a panel's (Previous, Next) runs along its bottom edge, with keys only on the message panel, beside where it is in the list. On a phone the panel's become wide Previous and Next buttons at the bottom, where a thumb is, and Close stays in the corner. Each one in a panel can be pressed as well as keyed.
- **What floats is a layer.** With a panel or dialog open the page under it hears nothing; `?` alone works everywhere.
- **Nothing happens while typing** in a field, and Enter never presses a second thing when a button or row already has the focus. A panel takes the focus itself when it opens, so Enter answers.
- **No hints on a touch screen**, and the reader can turn keys and hints off in Settings. That choice is kept in the browser, not in `sift.toml`: it is about the reader, not the mail.

## Nothing moves after it is drawn

A page is drawn before its data arrives, and what arrives must not push what is already there. Measured as layout shift on a cold load, at desktop and phone widths; keep every page under 0.05.

- A page header that will have a status line passes `meta={null}` until it knows it: the line's room is held.
- A page's action button is shown from the start and disabled until it can work. It does not appear late.
- Anything above other content whose height depends on data goes in a `Reserve`.
- A list's rows may grow downward: nothing is below them.
- Every screen but the home page is fetched when first needed (`lazyView` in `web/src/lib/lazy.tsx`) and, once the page is idle, ahead of need. While one is on its way the page shows that screen's own header and row placeholders.

## Rules for adding to it

- A page starts with a `PageHeader`; a screen that lists something is a `ListView`. Don't lay out a heading, a search box or filters by hand.
- A list is a `Table`. There are no cards.
- What a press did is a toast. An error that stops a form goes under the form; a failure that stops a page is a `Note`.
- A form that adds or changes something opens in a `Dialog`; it does not unfold inside the list.
- Opening an item of a list opens the `Panel`, and the same panel wherever that kind of item appears, so it behaves the same everywhere.

- Build screens from these parts. If a screen needs something they cannot do, add or extend a part here, with its states (hover, focus, pressed, disabled, busy, empty, failed), and add it to the specimen page in the same change. A part exported from `web/src/system/index.ts` and missing from the specimen page fails the design-system test, as does a `mark` or `ink` button inside a `Tr` or `RowActions`, or a second `mark` in one screen's file.
- A part says when to use it in its doc comment; that is the line the specimen page shows.
- No inline styles, no fills, frames, corners, shadows or colours written outside `web/src/system/`; red is `Failure` and yellow comes only from a part's tone. If a value is missing, it is a missing token. `tests/design-system.test.ts` fails on any of these and names the file and line.
- Behaviour that is hard to get right (a list that opens, a focus trap) comes from an unstyled primitive, today Base UI. Only files in `web/src/system/` import it (a lint error elsewhere), so the library can change without a screen changing.
- A part's inline `style` is only for a value computed from data (a bar's height, a series colour).
- Motion is short (80 to 150ms): a press, a dialog opening, rows pulsing while they load. All off under `prefers-reduced-motion`.
