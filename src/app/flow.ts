import { getRun, start } from 'workflow/api';
import { HookConflictError } from 'workflow/errors';
import type { Work } from '../work/run.ts';
import type { Beginning } from './sift.ts';

/** @public Workflow's build registers only an exported workflow. */
export async function work(piece: Work): Promise<void> {
  'use workflow';
  await doPiece(piece);
}

/** Runs in the process Workflow delivered the run to, with that process's Sift. */
async function doPiece(piece: Work): Promise<void> {
  'use step';
  // Not a static import: the hosts that instance.ts opens import `begin` from here.
  await (await import('./instance.ts')).work(piece);
}

/** Starts a run for `piece`, holding `key` until it ends; refused while a run holds it already. */
export async function begin(piece: Work, key: string): Promise<Beginning> {
  try {
    // Nothing of the run is kept once it ends: its input names the mailbox, and Vercel bills what it keeps.
    await start(work, [piece], { experimental_hook: { token: key }, experimental_retention: 0 });
    return { begun: true };
  } catch (error) {
    if (!HookConflictError.is(error)) throw error;
    const holder = error.conflictingRunId;
    return holder ? { begun: false, since: (await getRun(holder).createdAt).getTime() } : { begun: false };
  }
}
