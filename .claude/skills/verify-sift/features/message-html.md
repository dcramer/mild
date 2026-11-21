# Read a message as its HTML

An opened message Mild holds the HTML of shows it as that HTML, or as its text. The HTML is what Mild stored, not fetched from Gmail; it runs no script and loads nothing from elsewhere. HTML is the default, and the choice is kept in the browser.

## Sub-features

- `html-toggle`: `Show as text` (and back, `Show as HTML`) in the message head's ⋮ menu (`More` outside Inbox, `Reply all, forward and more` in it). `Remote images are blocked` shows above the message while HTML shows and the message asked for images from elsewhere (m4 does, m21 does not). Not shown when Mild holds no HTML for the message: mail held as text alone (`m6`), or not held at all (`m1`, which says `Mild does not hold this message’s text. It keeps it only while the message waits on you, and for good once you have answered for it.`).
- `html-frame`: the frame, titled with the subject, as tall as the message, so the page scrolls as one. A design (m4) is on white paper; a letter (m21, Ada's `Re: Fix the release script (#412)`, written in Gmail) is in the dashboard's ink with no box, and the history it quotes is folded behind `•••` (`Show the quoted text`). Its text folds the same. Links in it open in a new tab.
- `html-none`: the frame's address answers 404 with `Mild does not hold this message’s HTML.` for a message it holds none of. The page hides the toggle then, so no user path reaches it.

## How to get to it (user POV)

- Open any message from For review or Activity; it shows as HTML unless the reader last chose `Text`.

## Driving it with verify.sh

Preconditions:

- Fresh seed and a fresh browser session (`up` gives one); `ab console` empty.

- **HTML by default.** `ab open "$B/?message=m4"`. `Remote images are blocked` shows above it, and a frame named `48 hours only: 30% off` showing `30% off everything` on a cream page with a white card, a `Shop the sale` button and, where the hero would be, its alt text `48 hours only` (a remote image's address is dropped, so nothing is fetched). `ab network requests` lists `/api/message/html?account=me%40example.org&id=m4` and nothing on `images.example.com` or `track.example.com`.
- **A link.** `ab snapshot -i` and click the frame's `Shop the sale` by its ref (`find role link` does not reach into the frame): `ab tab` lists a second tab at `https://shop.example.com/sale`; `ab tab close t2`. `Preferences` (a `javascript:` link in the source) is plain text, not a link.
- **Text, remembered.** `ab find role button click --name "More"`, then `ab find role menuitem click --name "Show as text"`: the frame and `Remote images are blocked` go, `Everything must go.` shows, and `ab eval "localStorage.getItem('sift:message-view')"` is `"text"`. `ab reload`: still the text. `More`, then `Show as HTML`, brings the frame back.
- **Nothing to choose.** `?message=m6` and `ab open "$B/activity?show=all&message=m1"` have no `More`; m1 says `Mild does not hold this message’s text.`
- **A letter.** `ab open "$B/?message=m21"`: `I pushed a fix for the tag step. Can you try it before Friday?` and `Ada` in the page's own ink, then `•••`; `The release script stops at the tag step.` shows only once `•••` is pressed (by its ref in `ab snapshot -i`), and the frame grows to hold it. No `Remote images are blocked`. Shown as text, the same: `Show the quoted text` opens `> The release script stops at the tag step.`
- **Phone.** `ab set viewport 390 844`, open m4: the frame is the reader's width, the card shrinks to it, and `document.documentElement.scrollWidth - document.documentElement.clientWidth` is `0`.

## Gotchas

- Mild holds a message's HTML while it waits on the user, and for good once answered (in its example), so m4 still shows as HTML after Answer a suggestion. Mail a rule or a label decided has none.
- `ab console` does not report what happens inside the frame. The CSS background in m4 is blocked by the frame's policy, which shows in the network list as no request.
