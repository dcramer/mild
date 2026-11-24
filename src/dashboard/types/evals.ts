import { z } from 'zod';
import { EVAL_STATUSES, EXAMPLE_STATUSES } from '../../store/states.ts';
import { held, text } from './parts.ts';

/** Right, wrong, "unsure" and failed calls among some judged examples. Accuracy is `right / (total - failed)`. */
const EvalTally = z.object({
  total: z.number(),
  right: z.number(),
  wrong: z.number(),
  unsure: z.number(),
  /** Calls that returned nothing usable. Not counted for or against. */
  failed: z.number(),
});
type EvalTally = z.infer<typeof EvalTally>;

const EvalScore = EvalTally.extend({
  /** By the label the user gave, most examples first. */
  byLabel: z.array(EvalTally.extend({ labelId: z.string() })),
  /** Which label was taken for which, commonest first. */
  confusion: z.array(z.object({ expected: z.string(), got: z.string(), count: z.number() })),
  costUsd: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  /** Averages over the calls that answered. */
  perMessage: z.object({ costUsd: z.number(), inputTokens: z.number(), outputTokens: z.number() }),
});
type EvalScore = z.infer<typeof EvalScore>;

/** One replay of the model over stored examples. */
const EvalRun = z.object({
  id: z.number(),
  accountId: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  status: z.enum(EVAL_STATUSES),
  error: z.string().nullable(),
  /** What it ran with. Runs that agree on all of these were asked the same question the same way. */
  model: z.string(),
  promptHash: z.string(),
  labelsHash: z.string(),
  labels: z.array(z.object({ id: z.string(), name: z.string(), description: z.string() })),
  fewShot: z.boolean(),
  /** Examples in the run. `score.total` is how many have been judged so far. */
  total: z.number(),
  score: EvalScore,
  /** Of the answers, those given with an example from the same sender in the prompt, which makes them easy. */
  withSenderExample: z.object({ answered: z.number(), right: z.number() }),
});
type EvalRun = z.infer<typeof EvalRun>;

/** GET /api/evals. */
export const Evals = z.object({
  /** Newest first. */
  runs: z.array(EvalRun),
  /** Stored examples a run could use, per account. */
  examples: z.record(z.string(), z.number()),
  defaultLimit: z.number(),
  maxLimit: z.number(),
});
export type Evals = z.infer<typeof Evals>;

/** GET /api/eval?id=. */
export const EvalDetail = z.object({
  run: EvalRun,
  results: z.array(
    z.object({
      messageId: z.string(),
      fromAddress: held,
      subject: held,
      /** The user's label. */
      expected: z.string(),
      /** A label id, `unsure`, or null when the call failed. */
      got: z.string().nullable(),
      /** Why the call failed: its status and kind. */
      error: z.string().nullable(),
      confidence: z.number().nullable(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      costUsd: z.number(),
      durationMs: z.number(),
      /** Examples shown beside it, and how many of those were from the same sender. */
      shots: z.number(),
      senderShots: z.number(),
    }),
  ),
});
export type EvalDetail = z.infer<typeof EvalDetail>;

/** The body of POST /api/evals/run. Answers `{ id }`; the run goes on in the background. */
export const EvalRequest = z.strictObject({
  accountId: text(),
  /** Show the model the other stored examples, as a pass always does. Default: true. */
  fewShot: z.boolean().optional(),
  /** How many examples, newest answers first. At most `Evals.maxLimit`. */
  limit: z.int().min(1).optional(),
});
export type EvalRequest = z.infer<typeof EvalRequest>;

/** GET /api/examples: the messages held whole because the user answered for them. No content. */
export const Examples = z.object({
  /** Newest answers first, at most 500. */
  examples: z.array(
    z.object({
      accountId: z.string(),
      messageId: z.string(),
      fromAddress: held,
      fromName: held.nullable(),
      subject: held,
      /** The user's answer. */
      labelId: z.string().nullable(),
      markedAt: z.number(),
      /** `pending`: not fetched yet. `gone`: the message no longer existed, so only the answer is held. */
      status: z.enum(EXAMPLE_STATUSES),
    }),
  ),
  /** How many are held per account, including any beyond the list. */
  held: z.record(z.string(), z.number()),
});
export type Examples = z.infer<typeof Examples>;
