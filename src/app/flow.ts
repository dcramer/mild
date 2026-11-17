import { start } from 'workflow/api';
import { HookConflictError } from 'workflow/errors';
import type { Work } from '../work/run.ts';
import { offeredSift } from './process.ts';

/** @public Workflow's build registers only an exported workflow. */
export async function work(piece: Work): Promise<void> {
  'use workflow';
  await doPiece(piece);
}

/** Runs in the process Workflow delivered the run to, with the Sift its host offered there. */
async function doPiece(piece: Work): Promise<void> {
  'use step';
  const open = offeredSift();
  if (!open) throw new Error('No Sift was offered in this process.');
  await (await open()).work(piece);
}

/** Starts a run for `piece`, holding `key` until it ends; false when a run holds it already. */
export async function begin(piece: Work, key: string): Promise<boolean> {
  try {
    await start(work, [piece], { experimental_hook: { token: key } });
    return true;
  } catch (error) {
    if (HookConflictError.is(error)) return false;
    throw error;
  }
}
