import { UNSURE } from './stages/model.ts';

/** One judgement set against the owner's answer. */
export interface Judged {
  /** The owner's label. */
  expected: string;
  /** The label the model named, `unsure`, or null when the call failed. */
  got: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface Tally {
  total: number;
  right: number;
  wrong: number;
  unsure: number;
  /** Calls that returned nothing usable. Not counted for or against. */
  failed: number;
}

export interface Scorecard extends Tally {
  /** By the owner's label, most examples first. */
  byLabel: ({ labelId: string } & Tally)[];
  /** Which label was taken for which, commonest first. Wrong answers only. */
  confusion: { expected: string; got: string; count: number }[];
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** Averages over the calls that answered. */
  perMessage: { costUsd: number; inputTokens: number; outputTokens: number };
}

const empty = (): Tally => ({ total: 0, right: 0, wrong: 0, unsure: 0, failed: 0 });

function count(tally: Tally, judged: Judged): void {
  tally.total++;
  if (judged.got === null) tally.failed++;
  else if (judged.got === UNSURE) tally.unsure++;
  else if (judged.got === judged.expected) tally.right++;
  else tally.wrong++;
}

/** Accuracy is `right / (total - failed)`: an "unsure" is not a mistake, but it is not a right answer either. */
export function score(results: readonly Judged[]): Scorecard {
  const overall = empty();
  const labels = new Map<string, Tally>();
  const confusion = new Map<string, { expected: string; got: string; count: number }>();
  const sum = { costUsd: 0, inputTokens: 0, outputTokens: 0 };
  for (const judged of results) {
    count(overall, judged);
    const tally = labels.get(judged.expected) ?? empty();
    labels.set(judged.expected, tally);
    count(tally, judged);
    sum.costUsd += judged.costUsd;
    sum.inputTokens += judged.inputTokens;
    sum.outputTokens += judged.outputTokens;
    if (judged.got !== null && judged.got !== UNSURE && judged.got !== judged.expected) {
      const key = `${judged.expected}\n${judged.got}`;
      const pair = confusion.get(key) ?? { expected: judged.expected, got: judged.got, count: 0 };
      confusion.set(key, pair);
      pair.count++;
    }
  }
  const answered = Math.max(1, overall.total - overall.failed);
  return {
    ...overall,
    byLabel: [...labels].map(([labelId, tally]) => ({ labelId, ...tally })).toSorted((a, b) => b.total - a.total || a.labelId.localeCompare(b.labelId)),
    confusion: [...confusion.values()].toSorted((a, b) => b.count - a.count || a.expected.localeCompare(b.expected) || a.got.localeCompare(b.got)),
    ...sum,
    perMessage: { costUsd: sum.costUsd / answered, inputTokens: sum.inputTokens / answered, outputTokens: sum.outputTokens / answered },
  };
}
