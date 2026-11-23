# Contacts

Everyone the person gets mail from, newest first, each with what Mild does with their next mail (their answers counted), their standing or how many rules name them, their mail in 30 days and when they last wrote; and each one's page, which is a sender's or a domain's.

## Sub-features

- `contacts-list`: the directory at `/contacts`, under `Contacts` in the sections.
- `contacts-search`: `Search contacts` (a `searchbox`), by name or address, kept in the address (`?q=`).
- `contacts-filters`: `Filters`: `Standing` (`Trusted`, `Unwanted`, `Blocked`) and `How you know them` (`New`, `You write to them`, `Never written back`), each with `Any`/`Anyone` too; the button becomes `Filters, 1 on`, and once it is closed a chip `Clear <choice>` clears it.
- `contact-page`: a row opens `/sender/<address>`; `Contacts` above the name leads back (the rail's link has the same name). A domain's page lists `People here`.
- `contact-write`: `Write to them`, only with Inbox on, opens `New message` to them.

## How to get to it (user POV)

Press `Contacts` in the rail (an icon, named when pointed at; on a phone, in the tab bar along the foot), or open a sender or domain from anywhere they are named.

## Driving it with verify.sh

Preconditions: a fresh `up "$RUN"` (add `--inbox` for `contact-write`).

- **The list.** `ab open "$B/contacts"`: 10 rows, `Weekly Digest` first (`Archive as Newsletters`, `1 rule`), `Utility` says `Keep as Receipts` (answered so, though Mild left it Unlabelled), `Dependabot` `Usually Archive as Notifications`; no row for `me@example.org`.
- **Search.** `ab find role searchbox fill --name "Search contacts" "lovelace"`: one row, Ada Lovelace; the address has `?q=lovelace`.
- **Filters.** `Filters`, then `ab find role radio click --name "You write to them"`: Ada alone. `Blocked`: `Nothing matches.` until a standing is given.
- **A contact.** `ab find role link click --name "Ada Lovelace" --exact`: `/sender/ada%40example.org?name=Ada%20Lovelace` (a press on the row outside its links opens `/sender/ada%40example.org`, the same page for a sender of one name), the rail's `Contacts` current (`aria-current`), `You have written to them` once, under her name. `ab find role button click --name "Block" --exact`: a toast headed `Rule added` says `Mail from ada@example.org: send it to spam`, with `Undo Z` and `Apply to inbox…`; back on `Contacts`, her row says `Spam` and `Blocked`.
- **Write to them.** With `--inbox`, `ab find role button click --name "Write to them"`: `New message` with To `ada@example.org`.
- **Their card.** `ab find role link hover --name "Dependabot"`: a card (`About Dependabot`) with `notifications@code.example.com`, how much it sent (`8 messages since …`), `Mostly Notifications`, and `Also writes as` the other names that address uses. The name in the card links to their page. Inbox's names (with `--inbox`) open the same card, and a press on one opens the conversation.
- **Phone.** `ab set viewport 390 844`: each row is the name, the address and what Mild does; nothing scrolls sideways. A touch screen draws no card, but the browser here is a mouse (SKILL.md), so it still shows one.

## Gotchas

- A sender's page no longer says what their next mail gets: it lists the rules that name them, and only when there are some. What a row says Mild does is the list's alone.
- People only written to, who never wrote, are not listed: Mild does not keep who the person writes to.
