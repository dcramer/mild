import type { Work } from '../work/run.ts';
import type { Sift } from './sift.ts';

/** A piece begun, or refused while a run holds its key: the one begun at `since`, when Workflow says which. */
export type Beginning = { begun: true } | { begun: false; since?: number };

const SIFT = Symbol.for('sift.sift');
const BEGIN = Symbol.for('sift.begin');

/**
 * What this process offers across copies of src/: `sift run` holds two, its own and the one Next.js bundled
 * with Workflow's transform, and they share nothing but globalThis.
 */
const slots = globalThis as typeof globalThis & {
  [SIFT]?: () => Promise<Pick<Sift, 'work'>>;
  [BEGIN]?: (piece: Work, key: string) => Promise<Beginning>;
};

/** The host's Sift, for the steps of Workflow runs to do their piece with. */
export const offerSift = (open: () => Promise<Pick<Sift, 'work'>>) => void (slots[SIFT] = open);

export const offeredSift = () => slots[SIFT];

/** Workflow's `begin` (`src/app/flow.ts`), from the copy that has its transform. */
export const offerBegin = (begin: (piece: Work, key: string) => Promise<Beginning>) => void (slots[BEGIN] = begin);

export async function begin(piece: Work, key: string): Promise<Beginning> {
  const offered = slots[BEGIN];
  if (!offered) throw new Error('Workflow has not started in this process.');
  return await offered(piece, key);
}
