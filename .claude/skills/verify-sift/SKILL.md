---
name: verify-sift
description: Launch a disposable, signed-in sift dashboard seeded with synthetic mail, and drive it in a headless browser to prove a change works the way a user meets it. Use after changing the dashboard, its API, rules, labels, answers or triage output, for AGENTS.md's "looked at the page in a browser with the console open", or whenever a test passing is not proof enough.
---

# Verify sift

sift's surface is the dashboard (`web/`, served by `src/dashboard/server.ts`). Every `/api/` route needs a Google sign-in as a connected account, and there is no Gmail behind a scratch home, so this skill fakes exactly two things: Gmail, at the `GmailApi` and `Mailbox` ports, and the sign-in, by minting the same `sift_session` cookie `/auth/callback` would set. Everything else is the real code path.

`scripts/verify.sh` does all of it. Each run owns one directory; nothing is shared between runs, so several can run at once. Never point it at a real home (`~/.config/sift`) and never drive a dashboard this run did not start: the user's own sift usually listens on 8787 and holds real mail.

## Launch

Prerequisite once per checkout: `pnpm install`.

```bash
V=.claude/skills/verify-sift/scripts/verify.sh
RUN=<scratchpad>/verify-sift/<short-name>   # a new directory per run
$V up "$RUN"
```

`up` seeds `$RUN/home`, picks a free port, starts `sift dashboard` on it (rebuilding `web/dist` first if the page sources are newer, which can take a minute), runs the doctor, and signs the browser session in. It is ready when it prints `ok  pid …` and `browser session … signed in`. It refuses a directory that already has a `home/`.

What the seed leaves (through a real observing pass, `runOnce`, with heuristics on and no model):

| Id | Sender | What places it | Shows as |
| --- | --- | --- | --- |
| `m1`, `m2` | `digest@news.example.com` | label rule → Newsletters | Activity only |
| `m3` | `orders@shop.example.com` | label rule → Receipts and transactions | Activity only |
| `m4` | `deals@promo.example.com` | nothing | Suggestions, `Not sure…` |
| `m5` | `builds@ci.example.org` | action rule → archive | Activity only |
| `m6` | `ada@example.org` | nothing | Suggestions, `Not sure…` |
| `m7` | `grace@example.net` | nothing | Suggestions, `Not sure…` |
| `m8` | `sale@store.example.com` | header heuristics → Marketing | Suggestions, `Marketing` (sure), the only row with a label to agree with |

The connected account is `me@example.org`, observing, no model, default labels, 3 user rules. Every message carries `dmarc=pass`; the three lists (news, promo, store) carry one-click unsubscribe headers. `m8` also has a Mailgun header and Gmail's Promotions category, which is what the heuristics need.

The dashboard does not pick up code changes. After editing `src/` or `web/src`, `down` and `up` a new directory.

## Doctor

```bash
$V doctor "$RUN"
```

Read-only. Passes only if this run's process is alive, the port answers as `me@example.org` with this home's signing key (so it is this instance and not another sift), and `/api/` still refuses a request without the cookie. Its line ends with the commit and `+changes` when `src` or `web/src` differ from it. Run it first whenever anything looks off.

## Drive

```bash
$V ab "$RUN" open "http://127.0.0.1:$(cat "$RUN/port")/suggestions"
$V ab "$RUN" snapshot -i          # interactive elements with refs (@e12)
$V ab "$RUN" find role button click --name "Save answer"
$V ab "$RUN" press j               # page keys work: J/K move, A agrees, 1–9 pick a label
```

`ab` is agent-browser (`npx agent-browser@0.39.2`) in this run's own browser session; any agent-browser command works after it (`agent-browser skills get core` for the full set). Use `127.0.0.1`, which is where the cookie was set, not `localhost`.

Find elements by role and accessible name, not refs or CSS: refs change on every snapshot. A control with a shortcut has its keycap in its name (`Save answer ↵`, `Archive E`); `--name` matches part of a name, so the words alone find it. The names the page uses are in [features/](features/README.md). Routes: `/suggestions`, `/activity`, `/labels`, `/rules`, `/settings`, `/sender/<account>/<address>`, `/domain/<account>/<domain>`, and `/system` (the design-system specimen, no sign-in). An open message is `?message=<id>&account=me%40example.org` on any route.

Phone width: `$V ab "$RUN" set viewport 390 844`. AGENTS.md asks what every part does on a phone.

Stored state, read-only: `$V sql "$RUN" "SELECT … FROM rules"`. Tables worth checking: `decisions`, `rules`, `examples`, `actions`, `labels`, `suggestion_bodies`.

## Evidence

Write everything into `$RUN/evidence/`; `down` keeps it. For each feature proved, capture:

1. A snapshot or screenshot before the action and after it (`$V ab "$RUN" screenshot "$RUN/evidence/<feature>-after.png"`, `$V ab "$RUN" snapshot > "$RUN/evidence/<feature>-after.txt"`).
2. `$V ab "$RUN" console` and `$V ab "$RUN" errors`, both empty. A content security policy violation appears only here, never in the build.
3. The stored side effect, from `sql`, and a second view that reads it back (the Rules screen after an answer, the Labels screen after a label edit).
4. `SELECT count(*) FROM actions` is still `0`. This instance observes; a row there means something tried to change a mailbox.

Do the action the way a user does: press the control, not a POST with curl. The API is the page's private contract; calling it directly proves the server, not the screen. Seeding is the only place internals are used, and it uses the daemon's own pass.

## Cleanup

```bash
$V down "$RUN"
```

Closes this run's browser session, stops the process by the pid `up` recorded, deletes `home/`, and keeps `$RUN/evidence/`. Run it after a failed attempt too. Never `pkill -f` a pattern: it matches the shell running it, and other sessions' instances.

## Upkeep

A SessionStart hook (`.claude/settings.json`) runs `scripts/maintain-check.sh`. When `web/src`, `src/dashboard`, `src/cli`, `src/store`, `src/daemon` or `tests/helpers.ts` changed on `origin/main` since the last audit, the session is told to offer `/pstack:maintain-verification-skill`. It speaks at most once a day per machine, and never runs the pass itself. It reads local refs only, so it knows only as much of main as the last fetch.

After a maintenance pass ends clean or changed, record it, or tomorrow's first session asks again:

```bash
.claude/skills/verify-sift/scripts/maintain-check.sh --audited <the origin/main commit the pass covered>
```

State is in `~/.cache/sift-verify-maint/`. Delete `suggested-on` there to see today's prompt again.

## What this cannot show

- Anything that talks to Google: sign-in itself, connecting another account, Pull in (older mail), Gmail filters, undo of a real change. They fail here; that failure is not the change's fault.
- The model tier: there is no model, so nothing reaches it, and an unmatched message is always "Not sure".
- Acting. Settings can be switched to acting, but `sift dashboard` never runs a pass, so nothing is acted on. Prove the executor with tests (`tests/actions.test.ts`, `tests/run.test.ts`).
- `examples` rows stay `pending`: the body is captured on the next pass, which never comes.
