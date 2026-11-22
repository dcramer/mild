#!/usr/bin/env bash
# SessionStart hook: gives the first new session of the day on this machine, in any of sift's checkouts,
# daily-upkeep.md and the transcript folders it mines. Says nothing in every other session.
# State: daily-upkeep/<date> in the shared .git, so worktrees count as one.
set -euo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

common="$(git rev-parse --path-format=absolute --git-common-dir)"
state="$common/daily-upkeep"
today="$(date +%F)"
mkdir -p "$state"
(set -C; : > "$state/$today") 2>/dev/null || exit 0
find "$state" -type f ! -name "$today" -delete

main="$(dirname "$common")"
slug() { printf '%s' "$1" | tr '/.' '--'; }
folders=("$HOME/.claude/projects/$(slug "$main")")
# The app puts worktrees in folders beside the main checkout, and a removed worktree's transcripts outlive it,
# so take every folder under each worktree parent. Never main's own parent: that is every repository.
# Worktrees outside home are agents' scratch checkouts, not David's sessions.
while read -r parent; do
  [[ "$parent" == "$HOME"/* && "$parent" != "$(dirname "$main")" ]] || continue
  folders+=("$HOME/.claude/projects/$(slug "$parent")-*")
done < <(git worktree list --porcelain | sed -n 's/^worktree //p' | xargs -rd '\n' -n1 dirname | sort -u)

# A SessionStart hook's stdout is added to the session's context.
cat .claude/hooks/daily-upkeep.md
printf '\nTranscript folders for the brief:\n'
printf -- '- `%s`\n' "${folders[@]}"
