const MINUTE = 60_000;
/** The timed tick comes each minute, so no look comes sooner. */
export const TICK_MS = MINUTE;
/** David's choice: the longest new mail waits to be seen, however quiet the mailbox has been. */
const CEILING = 10 * MINUTE;
/**
 * The gap is this share of how long the mailbox has been quiet. A tenth is the tick over the ceiling: mail that waited the
 * whole ceiling is ten minutes old once a pass records it, which makes the gap a minute again.
 */
const SHARE = TICK_MS / CEILING;

/**
 * How long the timed tick leaves a mailbox's Gmail between looks, from how long ago its latest recorded mail arrived
 * (null: none has). Busy mail is looked at every tick and lands in a batch per pass; the longer the quiet, the longer the gap.
 */
export const lookGap = (quietFor: number | null): number => (quietFor === null ? CEILING : Math.min(CEILING, Math.max(TICK_MS, quietFor * SHARE)));
