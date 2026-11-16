# Design system

The dashboard is built from one small set of parts, in `web/src/system/`. Every part, in every state, is on the specimen page: open the dashboard at `/system`.

![The specimen page](images/design-system.png)

## What it is going for

A proof sheet on a dark desk: ink on near-black, one highlighter pen, hard edges. Calm. Weight and size do the work.

- **Dark only.**
- **Two colours mean something.** Yellow (`highlight`) means "look here": the name, the current section, the headline figure, what is waiting on the reader, a search match. Red (`destructive`) means a failure. Nothing else is coloured; everything else is the ink colour at some strength.
- **As little chrome as it takes.** Nothing on the page has a fill of its own: a list sits straight on it, and a sheet or a card is set apart by a thin frame alone. Only what floats above the page (a panel, a dialog, a menu) is filled, so it can cover what is under it. A sheet is for a group of settings or a figure, not for a table. Inside either, space and type separate things before any line does. Controls are filled (`--fill`), not outlined. Notes and headings have no box and no rule. The only lines inside a sheet are faint dashes between rows (`--rule`).
- **Lines are ink, thinned.** `--frame` for a sheet's edge, `--rule` between rows. Never a separate grey.
- **One shadow.** `--edge`: hard, offset down and right, the edge of the sheet beneath. It belongs to sheets and to what floats (a dialog, a menu). Buttons have none: the highlighted button is a flat stroke of yellow, like the name.
- **Things you press have hand-cut corners** (`--cut-control`); the highlighter stroke has its own (`--cut`). Surfaces are square.
- **Type is by role.** Karla carries everything read. Hanken Grotesk, bold, is for what is named or counted: page titles, headings, names, figures. IBM Plex Mono is for anything typed or pasted, and in small capitals (`.slug`) for labels and column heads. The wordmark alone is in Bricolage Grotesque. Sized like a mail reader: text is 16px, what supports it 15px, an opened message 17px; only labels and stamps go smaller, and nothing under 12px. Secondary text is a lighter ink, not a smaller size. (The same three faces as Peated.)
- **One height for controls.** Everything pressed or typed into in a row or a toolbar is `--control` high (32px), so buttons, selects and inputs line up. `lg` is for the one action a screen is about. Somewhere to type or choose (an input, a text area, a select, the search bar) is outlined and empty; something to press is filled (`--fill`), and stronger on hover. So a form reads as fields with one filled action.
- No app bar, no gradients, no pills, no icons as decoration.

Tokens and the role classes are in `web/src/index.css`.

## Parts

| Part | Use |
| --- | --- |
| `Button` | `mark`: what the screen is waiting on, one per screen at most. `ink`: the main action of a sheet or row. `plain`: everything else, filled not outlined. `quiet`: repeated down a list, and ways out. With `href` it is a link. `busy` while a press is being acted on. |
| `Select`, `Input`, `TextArea`, `Check` | Controls. Filled, with the hand-cut corners. `Select` is for a short list. |
| `Masthead` | The top of every screen: the name, the sections (highlighted when current), a `Notice` when there is one, when sift last synced, and who is signed in, as an `Avatar` that opens a `Menu`. No bar. |
| `Notice` | A state of sift itself, true on every screen, in the masthead: sift cannot be reached (plain ink, a pulse: it mends itself), a sign-in has expired (`look`, with a link: the reader mends it). |
| `SubNav` | The pages within a section, beside the page, the current one marked with a stroke. Like the sections, they are links to a path (`/settings/accounts`), read with `useRoute`. |
| `Menu`, `Avatar` | A few things to do, behind one button: under the avatar, who is signed in and Sign out. An item that cannot be pressed says why under its label. An avatar is the initial of an address, never a picture: the page loads nothing from another origin. Choosing one value is a `Select`, not a menu. |
| `Sheet`, `SheetHead` | The surface everything sits on. Rows inside take the class `row`. |
| `Table`, `Tr`, `Th`, `Td` | Rows of the same kind of thing, one row per item: the default for a list. It has no surface of its own, no background and no frame: on the page it sits flush under the list's heading, divided only by the dashes between rows. `Tr onOpen` makes the whole row pressable. |
| `Figures`, `Figure` | Headline numbers, straight on the page. `look` for the one to see first, `failure` for a count of things gone wrong. |
| `StackedBars` | Counts over time, stacked by series. Its legend reads out the column pointed at or focused. |
| `ListView`, `FilterGroup` | **How every screen shows many of one thing.** Its search and filters are kept in the address (`useParam`), so a narrowed list can be bookmarked. A title with the count, then one outlined bar holding the search and the Filters button (not filled: the list has no surface, so its search has none either), then the rows or cards. The filter button opens a panel on the right that pushes the list left. Filters that are on show as a count on the button and, when the panel is closed, as a line of chips that each clear one. |
| `Card`, `CardHead`, `CardFoot`, `CardGrid` | A thing shown whole, where each one is read on its own rather than compared down a column: a label. Head (what it is), body, foot (what can be done to it). Lists of mail, rules and decisions are tables, not cards. |
| `Panel` | One item from a list, opened beside the list: it slides over from the right, up to three quarters of the screen, with previous and next to step through the list. Every list opens a message in the same panel (`views/message-panel.tsx`). |
| `Dialog` | A form or a question: adding a label or a rule. Centred. `footer` for the actions that finish it. Looking at one of many things is a `Panel`, not a `Dialog`. |
| `Note` | Said to the reader outside the flow: `plain`, `look` (needs them), `failure`. No box. |
| `Empty`, `Loading` | What a sheet shows with nothing in it, and while rows are on their way. |
| `Stamp` | A short verdict. Weight is meaning: `outline`, `tint`, `ink`; `look` for what is left to the reader. |
| `Highlight`, `Marked` | A stroke of highlighter; a search term marked in text. |
| `Code`, `Copyable` | Something typed, inline; a value carried somewhere else whole, with a copy button where the browser allows one. |
| `Disclosure` | What most readers never need, folded under the question that leads to it. |
| `Wordmark` | The name. |

`web/src/components/` holds what is particular to sift and built from these: a tier's label, a decision's stamp, the decision table.

## Narrow screens

Every part has an answer for a phone, and a new part needs one before it is added.

| Part | On a narrow screen |
| --- | --- |
| `Masthead` | The sections, the synced line and the account (its address and what its menu holds, as buttons) move into a panel that covers the screen, opened from a menu button. The bar shows the current section's name; a dot on the button means something is waiting in another section. |
| `Notice` | A line of its own under the masthead's bar. |
| `SubNav` | A select above the page. |
| `Menu` | Opens under its button, kept inside the screen, with rows 44px tall on a touch screen. The masthead's own is not shown on a narrow screen: its panel lists the same things. |
| `Panel`, `Dialog` | Cover the screen. |
| `ListView` | The filter panel opens above the list. |
| `CardGrid` | One column. |
| `Table` | A table says which columns a phone keeps; what the dropped ones said moves under the first column, and the row opens for the rest (Suggestions does this). Tables that have not been given this still scroll sideways. |
| Rows with a control | The control wraps under the text. |
| Anything pressed | At least 40px tall on a touch screen (`pointer: coarse`), whatever its size on a desktop. |

The page itself never scrolls sideways.

## Rules for adding to it

- A screen that lists something is a `ListView`. Don't lay out a heading, a search box or filters by hand.
- A form that adds or changes something opens in a `Dialog`; it does not unfold inside the list.
- Opening an item of a list opens the `Panel`, and the same panel wherever that kind of item appears, so it behaves the same everywhere.

- Build screens from these parts. If a screen needs something they cannot do, add or extend a part here, with its states (hover, focus, pressed, disabled, busy, empty, failed), and add it to the specimen page in the same change.
- A part says when to use it in its doc comment; that is the line the specimen page shows.
- No inline styles, no colours or radii written into a view. If a value is missing, it is a missing token.
- Behaviour that is hard to get right (a list that opens, a focus trap) comes from an unstyled primitive, today Base UI. Only files in `web/src/system/` import it, so the library can change without a screen changing.
- A part's inline `style` is only for a value computed from data (a bar's height, a series colour).
- Motion is short (80 to 150ms): a press, a dialog opening, rows pulsing while they load. All off under `prefers-reduced-motion`.
