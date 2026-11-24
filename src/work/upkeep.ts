import type { Sql } from '../store/sql.ts';
import { READ_KEEP_DAYS, purgeRead } from '../store/kept.ts';
import { pruneGone } from '../store/changes.ts';
import { pruneUploads } from '../store/uploads.ts';
import { EXAMPLE_KEEP_DAYS, pruneExamples } from '../store/examples.ts';
import { preferences } from '../store/preferences.ts';
import { dropTextBefore } from '../store/copies.ts';
import { windowStart } from '../mail-window.ts';
import { PRUNE_PER_RUN, RETENTION_DAYS, pruneOld } from './retention.ts';
import { DAY_MS } from '../time.ts';
import type { RunOptions } from './run.ts';

/** One person's upkeep, done by the first tick of each day: old examples, message text and messages go. */
export async function upkeep(db: Sql, options: Pick<RunOptions, 'log' | 'now'>): Promise<void> {
  const now = (options.now ?? Date.now)();
  const dropped = await pruneExamples(db, now);
  if (dropped > 0) options.log(`Deleted ${dropped} example${dropped === 1 ? '' : 's'} older than ${EXAMPLE_KEEP_DAYS} days`);
  await purgeRead(db, now - READ_KEEP_DAYS * DAY_MS);
  let pruned: number;
  do {
    pruned = await pruneOld(db, now);
    if (pruned > 0) options.log(`Forgot ${pruned} message${pruned === 1 ? '' : 's'} with nothing newer than ${RETENTION_DAYS} days`);
  } while (pruned >= PRUNE_PER_RUN);
  // A record that a recent decision or change keeps past Inbox's window keeps no text.
  const { mail, mailWindow } = await preferences(db);
  const since = mail ? windowStart(mailWindow, now) : null;
  if (since !== null) await dropTextBefore(db, since);
  await pruneGone(db, now);
  await pruneUploads(db, now);
}
