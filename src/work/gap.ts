const MINUTE = 60_000;
/** The timed tick comes each minute, so no look comes sooner. */
export const TICK_MS = MINUTE;
/** David's choice: the longest new mail waits to be seen, however quiet the mailbox has been. */
const CEILING = 10 * MINUTE;
/** While Gmail pushes each change to the mailbox, a look only finds a push that was lost: Google says some are. */
const WATCHED_CEILING = 30 * MINUTE;
/**
 * The gap is this share of how long the mailbox has been quiet. A tenth is the tick over the ceiling: mail that waited the
 * whole ceiling is ten minutes old once a pass records it, which makes the gap a minute again.
 */
const SHARE = TICK_MS / CEILING;

/**
 * How long the timed tick leaves a mailbox's Gmail between looks, from how long ago its latest recorded mail arrived
 * (null: none has) and whether Gmail is pushing its changes. Busy mail is looked at every tick and lands in a batch per
 * pass; the longer the quiet, the longer the gap.
 */
export function lookGap(quietFor: number | null, watched: boolean): number {
  const ceiling = watched ? WATCHED_CEILING : CEILING;
  return quietFor === null ? ceiling : Math.min(ceiling, Math.max(TICK_MS, quietFor * SHARE));
}
