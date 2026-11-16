#!/usr/bin/env bash
# Daily upkeep of verify-sift, run from cron. Skips the day unless something a user sees changed on
# origin/main since the last audited commit; otherwise a headless Claude runs pstack's
# maintain-verification-skill in its own clone and reports through GitHub (a PR, or an issue).
#
#   maintain-daily.sh            gate, then run
#   maintain-daily.sh --check    gate only: print what would be audited, run nothing
#   maintain-daily.sh --force    run even with no churn
#
# State and logs: ~/.cache/sift-verify-maint/ (repo/, last-audited, logs/).
set -euo pipefail

STATE="$HOME/.cache/sift-verify-maint"
REPO="$STATE/repo"
REMOTE=https://github.com/dcramer/sift.git
# What a user meets, and the skill's own scripts' dependencies (the seed imports the store, daemon and test fakes).
WATCH=(web/src src/dashboard src/cli src/store src/daemon tests/helpers.ts .claude/skills/verify-sift)
mode="${1:-}"

# cron has no profile: put node 24, pnpm and claude on PATH.
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" > /dev/null
nvm use 24 > /dev/null
export PATH="$HOME/.local/bin:$HOME/.local/share/pnpm/bin:$PATH"

mkdir -p "$STATE/logs"
exec 9> "$STATE/lock"
flock -n 9 || { echo "another run holds $STATE/lock"; exit 0; }

[ -d "$REPO/.git" ] || git clone -q "$REMOTE" "$REPO"
cd "$REPO"
git fetch -q origin
git checkout -q --detach origin/main
git reset -q --hard origin/main
git clean -qfd
head="$(git rev-parse HEAD)"
last="$(cat "$STATE/last-audited" 2>/dev/null || true)"

if [ "$mode" != --force ] && [ -n "$last" ]; then
  churn="$(git log --oneline "$last..$head" -- "${WATCH[@]}")"
  if [ -z "$churn" ]; then
    echo "$(date -Is) nothing user-facing since ${last:0:7}; skipped" | tee -a "$STATE/logs/skips.log"
    exit 0
  fi
else
  churn="$(git log --oneline -20 -- "${WATCH[@]}")"
fi
echo "audit ${last:0:7}..${head:0:7}:"
echo "$churn"
[ "$mode" = --check ] && exit 0

pnpm install --frozen-lockfile > /dev/null
day="$(date +%F)"
skill="$(ls -d "$HOME"/.claude/plugins/cache/cursor-plugins/pstack/*/skills/maintain-verification-skill | sort -V | tail -1)"

prompt="$(cat <<EOF
Unattended daily maintenance of the verify-sift skill. Nobody is watching this session: never ask a question, decide and say what you decided in the report.

Read $skill/SKILL.md and the adapter it links to (resolve the link against that file), then follow it on the target .claude/skills/verify-sift in this checkout ($REPO, detached at origin/main ${head:0:7}).

User-facing commits since the last audit (${last:0:7}):
$churn

Use these for step 3's churn sweep.

How this run differs from the skill's defaults:
- Working directory for runs: $STATE/runs/$day/<name>. Clean up every instance you start with verify.sh down.
- Outcome changed: commit on a new branch verify-sift/maintain-$day, push it, and open one PR against main with gh. The body lists the features covered, the drift fixed, and anything unreachable.
- Product gaps (the app is broken, not the map), and outcome blocked: look for an open issue titled "verify-sift maintenance" (gh issue list --search 'in:title "verify-sift maintenance"' --state open). Comment on it if there is one, open it if not. Never one issue per day.
- Outcome clean with no product gaps: change nothing on GitHub.
- Only synthetic data from the seed goes into GitHub. Nothing from ~/.config/sift.
- End with one line: OUTCOME: clean|changed|blocked, and the PR or issue URL if there is one.
EOF
)"

log="$STATE/logs/$day.log"
# Nobody reads cron's output, so a run that did not finish says so where the user will see it.
failed() {
  local note="Daily run on $(hostname) for ${head:0:7} did not finish: $1. Log: \`$log\`."
  local issue
  issue="$(gh issue list --repo dcramer/sift --state open --search 'in:title "verify-sift maintenance"' --json number --jq '.[0].number')"
  if [ -n "$issue" ]; then gh issue comment "$issue" --repo dcramer/sift --body "$note"
  else gh issue create --repo dcramer/sift --title "verify-sift maintenance" --body "$note"; fi
  exit 1
}
# auto, not bypassPermissions: unattended, the classifier is the only check on what it runs.
claude -p --permission-mode auto -n "verify-sift maintenance $day" "$prompt" > "$log" 2>&1 || failed "claude exited $? ($(grep -m1 -i 'sign\|auth\|login' "$log" || tail -1 "$log"))"
tail -1 "$log"
# Advance only after a run that finished, so a failed day is audited again tomorrow.
grep -q '^OUTCOME: ' "$log" || failed "no OUTCOME line"
echo "$head" > "$STATE/last-audited"
