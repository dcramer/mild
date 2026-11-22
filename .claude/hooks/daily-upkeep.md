Daily upkeep for sift (the session-start hook gives this to one new session a day, to no other):

The `david-mode` skill has not been checked against David's recent sessions today. This must not delay or change what the user asked for.

1. Start one background subagent (`general-purpose`, `isolation: "worktree"`, model and effort from the `judgment and prose` line of `~/.claude/rules/pstack-models.md`) with the brief below, the transcript folders listed at the end pasted into it, and carry on with the user's task.
2. Only once it has started, tell the user in one line that today's refresh of `david-mode` is running in the background. If it is refused or cannot start, say so in one line and do not try again.
3. When it reports:
   - `unchanged`: one line.
   - `changed`: what changed in the skill (rules added, revised or dropped) in a few lines, its worktree, and ask whether to land it. On yes, commit in that worktree on its branch and land it as `AGENTS.md` says. On no, leave the worktree for the user.
   - `blocked`: what blocked it.
   - Pass on any `AGENTS.md` rows it suggests; add them only if the user says so.

If the user says not now, drop it. It is offered again tomorrow.

Brief for the subagent:

> Keep `.claude/skills/david-mode/SKILL.md` true to how David works. Read the newest `~/.claude/plugins/cache/cursor-plugins/pstack/*/skills/automate-me/SKILL.md` and, beside it, `../../docs/harness/claude-code.md`, and follow that skill for David. What differs here:
>
> - Nobody is there to answer you. Skip step 2 and the user's review in step 5, and make step 0's choice yourself: update the skill if it exists, write it if not.
> - Mine only the transcript folders below. With no skill yet, take the last three weeks; otherwise only sessions since `git log -1 --format=%cI origin/main -- .claude/skills/david-mode`. If you cannot start subagents, mine the slices yourself one after another.
> - Cursor's `create-skill` is not here: step 4's frontmatter rules and the **unslop** skill are enough.
> - Every session already loads `AGENTS.md`, which holds David's rules for this repository. The skill holds only how he works that it does not say (replies, delegation, review, process), and never restates or contradicts it. A correction that is a rule about sift goes in your report as a suggested `AGENTS.md` row, not in the skill.
> - The skill is committed: nothing from mail, no addresses, no other person's name, nothing a transcript shows of anyone's data (`AGENTS.md`, Privacy).
> - Edit only files in `.claude/skills/david-mode`. No commit, push or pull request: step 6 is the sending session's, once David agrees.
> - Report `unchanged`, `changed` (each rule added, revised or dropped, with how many sessions showed it) or `blocked` (with what blocked it), and any suggested `AGENTS.md` rows, in a few lines.
