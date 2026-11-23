# Inbox

With Inbox on, Inbox takes For review's place (`/` is `/inbox`): every conversation in the person's inbox, newest first, one line each, with what Mild thinks it is. The person reads, archives, marks spam, blocks a sender and answers from it, and every press shows at once: an archive or spam waits on the device while its toast shows, so Undo sends nothing, and goes to Gmail once the toast does.

## Sub-features

- `inbox-list`: the rows, a rule Mild proposes first (a row from `Mild`). Each has a check (`Select <subject>`); mail Mild could not place is marked `Unlabelled` before its time.
- `inbox-row-presses`: pointed at, a row puts its label (`What <subject> is`), `Archive`, `Spam` and `Block sender` in place of its time. They act on that row alone.
- `inbox-label`: picking a label on a row answers for it. One that keeps mail is saved in place, no toast; one that moves mail takes the row out at once, with `Archive as <label>` and `Undo Z`. Picking the label it already has does nothing.
- `inbox-read`: a press on the subject opens the conversation (`?message=<newest>&thread=<thread>`): the subject as heading, each message folded to a line or open, `Back to Inbox` (Esc), `Archive` (E), `Mark unread` (Shift+U), and `Reply`, `Reply all`, `Forward` (compose.md). Opening unread mail marks it read, with no toast.
- `inbox-archive`: `Archive` or E: the toast names the subject under `Archived`, with `Undo Z`; from the reader, it goes on to the next conversation. `Spam` is the same under `Marked spam`. `Block sender` gives the sender the Blocked standing (rule-shortcuts.md): `Blocked <address>` under `Rule added`, with Undo.
- `inbox-select`: X on a row, or its check: a toolbar `Selected rows` (`2 selected`) with `Archive` (E), `Spam`, `Block sender`, `Mark read` (Shift+I), `Mark unread` (Shift+U), `Select none`.
- `inbox-search`: `Search mail` (/), a searchbox that searches the text Inbox keeps as it is typed (`?q=`). Enter, or `Ask`, asks the model instead: its filter shows as `Clear From: …` (SKILL.md says what the stand-in finds).
- `inbox-phone`: a short swipe stops on Archive (left) or Label (right), one to the edge does it (Label opens a sheet of every label), and a finger held on a row selects it. Not drivable here (SKILL.md, Drive).

## How to get to it (user POV)

- Settings, `Inbox`, `Turn on`, then `Keep how much of your mail?`. Once on, the rail's first section is Inbox, and `/` opens it.

## Driving it with verify.sh

Preconditions:

- A run started with `verify.sh up "$RUN" --inbox`: 19 rows, the proposal's first, the bills folded into `Utility 3`.

- **List.** `ab open "$B/"`: the address is `/inbox`, and `ab snapshot -i` has 19 checks named `Select …`.
- **Open.** `ab find role cell click --name "Your March bill —"`: `?message=m11&thread=bills`, the heading `Your March bill`, the three bills, now read (Gmail's `m11`–`m13` lose `UNREAD`).
- **Archive, then Undo.** `ab press e`: a toast `Your March bill` under `Archived`, with `Undo Z`, and the reader on the next conversation. `ab find role button click --name "Undo"`: back in the list; Gmail's `m11` still has `INBOX` and `actions` has no `archive`. Without Undo, once the toast goes, the three lose `INBOX` and `actions` gets `archive`, `done`.
- **A row's presses.** `ab open "$B/inbox"`, `ab find role cell hover --name "Widgets, part two —"`: `ab snapshot -i` now has `What Widgets, part two is` (`Sure Newsletters`), `Archive`, `Spam`, `Block sender`.
- **A row's label.** On `Your order has shipped`, hover, then `ab find role combobox click --name "What Your order has shipped is"`, `ab find role option click --name "Personal" --exact`: the row stays. On `Widgets, part two`, pick `Marketing`: the row goes, a toast `Archive as Marketing` with `Undo Z`; `Undo` brings it back.
- **Spam, Block.** Hover `48 hours only: 30% off —`, `ab find role button click --name "Spam" --exact`: `Marked spam`, Undo. Hover `Winter sale starts now —`, `Block sender`: `Blocked sale@store.example.com` under `Rule added`, and what is waiting is re-decided.
- **Search.** `ab find role searchbox fill "1042" --name "Search mail"`: one row, `Your order has shipped`, `?q=1042`.
- **Ask.** `ab find role searchbox fill "utility" --name "Search mail"`, `ab find role button click --name "Ask" --exact`: `?from=billing%40utility.example.net`, the button `Clear From: billing@utility.example.net`, and one row.
- `ab console` and `ab errors` print nothing; `SELECT type, status FROM actions WHERE type NOT IN ('filter', 'unfilter')` holds only what was pressed (`read` rows from opening mail among them).

## Gotchas

- A row's first cell is its check, `Select <subject>`, so `find role cell --name "<subject>"` ticks the row instead of opening it. Name the subject cell by its subject and the dash after it (`"Your March bill —"`), or open the conversation by its address.
- A row's presses exist only while it is pointed at: hover first, and hover again after the list changes.
- A press is sent when its toast goes (8 seconds) or is dismissed; check Gmail and `actions` after that.
- What Mild saw is not drawn on a message opened from Inbox, and its Why is folded.
