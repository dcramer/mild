# Brand

How Sift sounds and what its drawings look like. How the dashboard is built is [design.md](design.md); this is the part that has a personality.

## Voice

Sift sounds like a friend who is good with email and a little smug about it. Casual, dry, tongue in cheek. It is on your side and against the mail.

- **Plain words, short sentences, contractions.** "Nothing's waiting on you", not "There are currently no items requiring your attention."
- **The joke is on email, never on people.** The follow-up to the follow-up, the newsletter you never signed up for, the sale that ends every day. Not the reader, not whoever sent it, not salespeople or any other kind of person.
- **One joke per screen, at most, and it has to be true.** It goes where nothing is at stake: an empty list, the splash, a finished import, a page that's loading. The rest of the screen says what it means and stops.
- **Straight when it matters.** Anything that failed, costs money, can't be undone, or touches someone's mail in a way they didn't expect is said plainly, with no wink. A failure is never cute.
- **Sift is "Sift", the reader is "you".** It doesn't say "I" or "we", and it doesn't have feelings about your inbox.
- **Never:** exclamation marks, emoji, "Oops", "Uh oh", "Yay", "Hey there", "We're excited", "seamless", "effortless", "supercharge", "AI-powered", "magic", "inbox zero" as a promise.

| Instead of | Say |
| --- | --- |
| You're all caught up! 🎉 | Nothing is waiting on you. |
| Oops! Something went wrong. | Couldn't load your labels. (Then the error.) |
| Our AI-powered engine is analyzing your inbox… | Sift is going through your inbox. What it reads shows here. |
| Unsubscribe successful! | Unsubscribed. |

## Drawings

Margin doodles: what you'd draw in the corner of a proof sheet with the one pen on the desk, while waiting on a meeting. They go where a screen has nothing else to show (an empty list, the splash, an error page) and nowhere else: never in a list, a dialog or a panel, and never beside red.

- **One pen.** A single line in the page's ink (`--foreground`), round ends, about 3px at the size it's shown. Slightly wobbly, as if drawn quickly; no ruler lines, no perfect circles.
- **One highlighter.** Exactly one thing in each drawing is swiped in yellow (`--highlight`), and it is the punchline. The swipe is a flat block laid down first and a little off its outline, with the highlighter's cut corners, so it reads as marked by hand rather than filled.
- **Nothing else.** No other colour, no grey fills, no gradients, no shadows, no shading beyond a few hatch lines. The page is the paper: no background, no frame.
- **The cast is the mail.** Envelopes with stick legs and dot eyes, as themselves: no ties, briefcases or anything else that turns them into a kind of person. Sift's own object is the sieve. No people, no robots, no sparkles.
- **Small.** About 280px wide on a desktop, narrower on a phone, set on the left like the text under it. The words under a drawing say what the screen means; the drawing is hidden from screen readers (`aria-hidden`) because it adds only the joke.
- **SVG, as the page's content security policy needs:** no `<style>`, no script, no fonts (letters are drawn, not set), colours from the theme.
