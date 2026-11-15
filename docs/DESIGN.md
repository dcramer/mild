# Design system

The dashboard is built from one small set of parts, in `web/src/system/`. Every part, in every state, is on the specimen page: open the dashboard at `/#system`.

![The specimen page](images/design-system.png)

## What it is going for

A proof sheet on a dark desk: ink on near-black, one highlighter pen, hard edges. Calm. Weight and size do the work.

- **Dark only.**
- **Two colours mean something.** Yellow (`highlight`) means "look here": the name, the current section, the headline figure, what is waiting on the reader, a search match. Red (`destructive`) means a failure. Nothing else is coloured; everything else is the ink colour at some strength.
- **As little chrome as it takes.** A list sits straight on the page with no surface behind it. A sheet has a frame, and is for a group of settings or a figure, not for a table. Inside either, space and type separate things before any line does. Controls are filled (`--fill`), not outlined. Notes and headings have no box and no rule. The only lines inside a sheet are faint dashes between rows (`--rule`).
- **Lines are ink, thinned.** `--frame` for a sheet's edge, `--rule` between rows. Never a separate grey.
- **One shadow.** `--edge`: hard, offset down and right, the edge of the sheet beneath. A `mark` button is raised by the same edge and pressing pushes it down.
- **Things you press have hand-cut corners** (`--cut-control`); the highlighter stroke has its own (`--cut`). Surfaces are square.
- **Type is by role, and legible first.** The text face (Geist) carries everything read: body, names, headings. The display face (Bricolage Grotesque) is only for what is large: the wordmark, a figure, a page title or the line a screen opens with (`.statement`); at reading sizes its shapes cost legibility. Mono small capitals (`.slug`) label things; mono is for anything typed or pasted. Nothing is set smaller than 11px.
- **One height for controls.** Everything pressed or typed into in a row or a toolbar is `--control` high (32px), so buttons, selects and inputs line up. `lg` is for the one action a screen is about. Controls are filled at a strength that reads as pressable (`--fill`), and stronger on hover.
- No app bar, no gradients, no pills, no icons as decoration.

Tokens and the role classes are in `web/src/index.css`.

## Parts

| Part | Use |
| --- | --- |
| `Button` | `mark`: what the screen is waiting on, one per screen at most. `ink`: the main action of a sheet or row. `plain`: everything else, filled not outlined. `quiet`: repeated down a list, and ways out. With `href` it is a link. `busy` while a press is being acted on. |
| `Select`, `Input`, `TextArea`, `Check` | Controls. Filled, with the hand-cut corners. `Select` is for a short list. |
| `Masthead` | The top of every screen: the name, the sections (highlighted when current) and who is signed in. No bar. |
| `SubNav` | The pages within a section, beside the page, the current one marked with a stroke. Like the sections, they are links to an address fragment (`#settings/accounts`), read with `useRoute`. |
| `Sheet`, `SheetHead` | The surface everything sits on. Rows inside take the class `row`. |
| `Table`, `Tr`, `Th`, `Td` | Rows of the same kind of thing, one row per item: the default for a list. It has no surface of its own, no background and no frame: on the page it sits flush under the list's heading, divided only by the dashes between rows. `Tr onOpen` makes the whole row pressable. |
| `Figures`, `Figure` | Headline numbers, straight on the page. `look` for the one to see first, `failure` for a count of things gone wrong. |
| `StackedBars` | Counts over time, stacked by series. Its legend reads out the column pointed at or focused. |
| `ListView`, `FilterGroup` | **How every screen shows many of one thing.** A title with the count, a search box, a filter button beside it, then the rows or cards. The filter button opens a panel on the right that pushes the list left. Filters that are on show as a count on the button and, when the panel is closed, as a line of chips that each clear one. |
| `Card`, `CardHead`, `CardFoot`, `CardGrid` | A thing shown whole, where each one is read on its own rather than compared down a column: a label. Head (what it is), body, foot (what can be done to it). Lists of mail, rules and decisions are tables, not cards. |
| `Dialog` | Something opened from the page and read or answered without leaving it: a message, a sender's waiting mail, a form. `wide` for two columns; a `footer` for the actions that finish it. |
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
| `Masthead` | The sections and the signed-in line move into a panel that covers the screen, opened from a menu button. The bar shows the current section's name; a dot on the button means something is waiting in another section. |
| `SubNav` | A select above the page. |
| `Dialog` | Covers the screen. |
| `ListView` | The filter panel opens above the list. |
| `CardGrid` | One column. |
| `Table` | A table says which columns a phone keeps; what the dropped ones said moves under the first column, and the row opens for the rest (Suggestions does this). Tables that have not been given this still scroll sideways. |
| Rows with a control | The control wraps under the text. |
| Anything pressed | At least 40px tall on a touch screen (`pointer: coarse`), whatever its size on a desktop. |

The page itself never scrolls sideways.

## Rules for adding to it

- A screen that lists something is a `ListView`. Don't lay out a heading, a search box or filters by hand.
- A form that adds or changes something opens in a `Dialog`; it does not unfold inside the list.

- Build screens from these parts. If a screen needs something they cannot do, add or extend a part here, with its states (hover, focus, pressed, disabled, busy, empty, failed), and add it to the specimen page in the same change.
- A part says when to use it in its doc comment; that is the line the specimen page shows.
- No inline styles, no colours or radii written into a view. If a value is missing, it is a missing token.
- Behaviour that is hard to get right (a list that opens, a focus trap) comes from an unstyled primitive, today Base UI. Only files in `web/src/system/` import it, so the library can change without a screen changing.
- A part's inline `style` is only for a value computed from data (a bar's height, a series colour).
- Motion is short (80 to 150ms): a press, a dialog opening, rows pulsing while they load. All off under `prefers-reduced-motion`.
