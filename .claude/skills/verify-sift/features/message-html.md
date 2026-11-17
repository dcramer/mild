# Read a message as its HTML

An opened message shows the text sift holds, or the message as its HTML, fetched from Gmail while it is open. The HTML runs no script and loads nothing from elsewhere. The choice is kept in the browser.

## Sub-features

- `html-toggle`: the `Read it as` choice (`Text`, `HTML`) beside who the message went to. Not shown when Sift holds no HTML for the message: mail held as text alone (`m6`), or not held at all (`m1`, which says `Sift does not hold this message’s text.`).
- `html-frame`: the frame, titled with the subject, white, with `Remote images are blocked.` under it. Links in it open in a new tab.
- `html-none`: for mail sift never read, the frame says `This message has no HTML, or is no longer in Gmail.` when it has none.

## How to get to it (user POV)

- Open any message from For review or Activity, then `HTML`.

## Driving it with verify.sh

Preconditions:

- Fresh seed; `ab console` empty.

- **Toggle to HTML.** `ab open "$B/?message=m4&account=me%40example.org"`, `ab find role radio click --name "HTML"`. The frame shows `30% off everything` on a cream page with a white card, a `Shop the sale` button and an empty box where the hero image would be. `ab network requests` lists `/api/message/html?…id=m4` and nothing on `images.example.com` or `track.example.com`.
- **A link.** `ab snapshot -i` and click the frame's `Shop the sale` by its ref (`find role link` does not reach into the frame): `ab tab` lists a second tab at `https://shop.example.com/sale`. `Preferences` (a `javascript:` link in the source) is plain text.
- **Remembered.** `ab reload`: on m4 `HTML` is still chosen and the frame is back. `?message=m6` and `ab open "$B/activity?show=all&message=m1&account=me%40example.org"` have no `Read it as` at all; m1 says `Sift does not hold this message’s text.`
- **Back to text.** `ab find role radio click --name "Text"`: the frame goes; `ab eval "localStorage.getItem('sift:message-view')"` is `"text"`.
- **Phone.** `ab set viewport 390 844`, open m4, `HTML`: the frame is the panel's width; the message scrolls sideways inside it and `document.documentElement.scrollWidth - document.documentElement.clientWidth` is `0`.

## Gotchas

- Each time the frame is shown it asks Gmail again (the fake here); nothing is kept.
- `ab console` does not report what happens inside the frame. The CSS background in m4 is blocked by the frame's policy, which shows in the network list as no request.
