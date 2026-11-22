#!/usr/bin/env bash
# Drives one disposable sift dashboard. Everything for a run lives in <dir>:
#   home/       the sift home (seeded, synthetic)     removed by `down`
#   evidence/   screenshots, snapshots, query output   kept by `down`
#   pid port cookie dashboard.log google.json (the fake Google, tests/google.ts: every mailbox, its mail, labels and filters, and what was sent)
# Usage: verify.sh up <dir> [--bare | --on | --chatgpt | --inbox] [--listing] [--scale <n>] | doctor <dir> | ab <dir> <agent-browser args...> | sql <dir> <query> | down <dir>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
AB_VERSION=0.39.2
cmd="${1:-}"
dir="${2:-}"
[ -n "$cmd" ] && [ -n "$dir" ] || { echo "usage: verify.sh up|doctor|ab|sql|down <dir> [...]" >&2; exit 2; }
dir="$(mkdir -p "$dir" && cd "$dir" && pwd)"
session="verify-sift-$(basename "$dir")"

# Chrome's own sandbox needs unprivileged user namespaces, which Ubuntu's AppArmor refuses here. The page is synthetic and local.
# Headless Chrome reports no pointer at all, (hover: none), so whatever the page shows only under a resting pointer (a row's
# presses) never appears: the Blink settings make it a mouse. Newline-separated, as the settings hold commas.
AB_ARGS=$'--no-sandbox\n--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'
ab() { npx -y "agent-browser@$AB_VERSION" --session "$session" --args "$AB_ARGS" "$@"; }

doctor() {
  local pid port cookie session_json
  pid="$(cat "$dir/pid" 2>/dev/null)" || { echo "doctor: no instance in $dir (run up)"; return 1; }
  port="$(cat "$dir/port")"
  cookie="$(cat "$dir/cookie")"
  kill -0 "$pid" 2>/dev/null || { echo "doctor: pid $pid is not running; see $dir/dashboard.log"; return 1; }
  # Only this home's key signed the cookie, so a signed-in answer proves the port is this run's instance.
  session_json="$(curl -sf -H "cookie: sift_session=$cookie" "http://127.0.0.1:$port/api/session")" || { echo "doctor: nothing answering on $port"; return 1; }
  case "$session_json" in
    *'"email":"me@example.org"'*) ;;
    *) echo "doctor: port $port is not this run's sift (or the cookie no longer signs in): $session_json"; return 1 ;;
  esac
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/suggestions")" = 401 ] || { echo "doctor: /api/ answers without a session"; return 1; }
  # Each build has an id of its own, in the page and in the server started on it; a page of another build draws only the wordmark.
  local build
  build="$(printf '%s' "$session_json" | sed -n 's/.*"build":"\([^"]*\)".*/\1/p')"
  grep -rqF "$build" "$ROOT/.next/static/chunks" || { echo "doctor: .next was rebuilt after this instance started, so its page is another build's; down and up again"; return 1; }
  echo "ok  pid $pid  http://127.0.0.1:$port  home $dir/home  build $(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet HEAD -- src web/src || echo '+changes')"
}

case "$cmd" in
  up)
    [ ! -e "$dir/home" ] || { echo "up: $dir/home exists. Use a new directory per run." >&2; exit 1; }
    mkdir -p "$dir/evidence"
    variant='' listing='' scale=''
    set -- "${@:3}"
    while [ $# -gt 0 ]; do
      flag="$1"
      shift
      case "$flag" in
        --listing) listing=--listing ;;
        --scale) scale="--scale $1"; shift ;;
        --bare | --on | --chatgpt | --inbox) variant="$flag" ;;
        *) echo "up: unknown option $flag" >&2; exit 2 ;;
      esac
    done
    node --disable-warning=ExperimentalWarning "$ROOT/.claude/skills/verify-sift/scripts/seed.ts" "$dir/home" "$dir/google.json" $variant $scale > "$dir/cookie"
    port="$(node -e 'const s=require("node:net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
    echo "$port" > "$dir/port"
    # The real app on this home, as `mild run` starts it, with the fake Google and a stand-in model (stand-ins.ts says
    # what they answer) and no minute's tick, on a build of the code as it is now: Next.js's cache makes that seconds.
    cd "$ROOT"
    # A rebuild gives the page a new build id, which every instance already running then no longer serves: build only
    # when something the build reads changed, so runs started on the same code share one build.
    if [ ! -f .next/BUILD_ID ] || [ -n "$(find app web src public next.config.js package.json pnpm-lock.yaml tsconfig.json -newer .next/BUILD_ID -print -quit)" ]; then
      pnpm -s build:web > "$dir/build.log" 2>&1 || { tail -20 "$dir/build.log" >&2; exit 1; }
    fi
    nohup node --disable-warning=ExperimentalWarning "$ROOT/.claude/skills/verify-sift/scripts/serve.ts" "$dir/home" "$port" "$dir/google.json" $listing > "$dir/dashboard.log" 2>&1 &
    echo $! > "$dir/pid"
    for _ in $(seq 1 240); do
      grep -q 'Mild is running on the seeded home' "$dir/dashboard.log" 2>/dev/null && break
      kill -0 "$(cat "$dir/pid")" 2>/dev/null || { cat "$dir/dashboard.log" >&2; exit 1; }
      sleep 0.5
    done
    doctor
    ab cookies set sift_session "$(cat "$dir/cookie")" --url "http://127.0.0.1:$port" --httpOnly > /dev/null
    echo "browser session $session signed in as me@example.org"
    ;;
  doctor) doctor ;;
  ab) shift 2; ab "$@" ;;
  sql)
    # The running dashboard holds the database (PGlite is one process's alone), so read a copy of it.
    copy="$(mktemp -d)"
    cp -r "$dir/home/database/." "$copy"
    (cd "$ROOT" && node --input-type=module -e '
      import { PGlite } from "@electric-sql/pglite";
      const db = new PGlite(process.argv[1]);
      try {
        console.log(JSON.stringify((await db.query(process.argv[2])).rows, null, 1));
      } catch (e) {
        // An uncaught PGlite error prints its whole minified bundle before the message.
        console.error(`sql: ${e.message}${e.hint ? ` (${e.hint})` : ""}`);
        process.exitCode = 1;
      } finally {
        await db.close();
      }
    ' "$copy" "$3")
    rm -r -- "$copy"
    ;;
  down)
    ab close > /dev/null 2>&1 || true
    if [ -f "$dir/pid" ]; then
      pid="$(cat "$dir/pid")"
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
    fi
    rm -rf "$dir/home" "$dir/pid" "$dir/port" "$dir/cookie" "$dir/google.json"
    echo "stopped; evidence kept in $dir/evidence"
    ;;
  *) echo "unknown command: $cmd" >&2; exit 2 ;;
esac
