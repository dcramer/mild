import type { Facts } from '../facts.ts';
import type { Standing } from '../standing.ts';
import { type RuleHit, describeRule, ruleOutcome } from './rules.ts';
import { type Shot, pickShots } from '../fewshot.ts';
import { type Decision, type Label, type MessageFacts, type Stage, type Unfinished, labelled } from '../types.ts';

/** Everything the model is shown about one message. Gathered by deterministic code, never by the model. */
export interface Evidence {
  facts: MessageFacts;
  known: Facts;
  /** Plain text of the message, truncated. Null if it could not be fetched. Untrusted. */
  body: string | null;
  sender: {
    /** Messages sift has recorded from this address, including this one. */
    messagesSeen: number;
    /** Whether the account owner has ever written to this address. Null if that could not be checked. */
    userHasWritten: boolean | null;
    /** How the owner regards them, and why. Absent when it was not worked out. */
    standing?: { standing: Standing; why: string };
    /** What the owner said their earlier mail was, by an answer or a rule, by label id, most first. Never a model's guess. */
    ownerLabels?: { id: string; messages: number }[];
    firstSeenAt?: number | null;
  };
  /** The same for everyone at the sender's domain. Absent for a domain anyone can get an address at. */
  domain?: { messages: number; senders: number; standing: Standing; why: string; ownerLabels: { id: string; messages: number }[] };
  /** What the owner's rule says this sender's mail usually is. The model may find this message is something else. */
  prior?: { labelId: string; labelName: string; when?: string };
}

export const UNSURE = 'unsure';

/**
 * How sure the model must say it is before its label alone is carried out. Below it the user is asked, with
 * the label as the answer to agree with. The dashboard's meter is full from here (`sureness`, web/src/lib/format.ts).
 */
const SURE = 0.9;

/** What a call cost, as the provider reported it. */
export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Verdict {
  /** A label's id, or `unsure`. */
  label: string;
  reason: string;
  /** 0 to 1, as reported by the model. Not calibrated. */
  confidence?: number;
  usage?: Usage;
}

const STATUS: Record<number, string> = {
  400: 'bad request',
  401: 'not signed in',
  402: 'payment required',
  403: 'forbidden',
  404: 'not found',
  408: 'timeout',
  413: 'request too large',
  429: 'rate limited',
  500: 'server error',
  502: 'bad gateway',
  503: 'unavailable',
  504: 'gateway timeout',
  529: 'overloaded',
};

/**
 * What went wrong with a call to the model, as a status and a kind. Never the provider's own words, which
 * are kept out of run records and logs: they can quote the request, and the request is the mail.
 */
export function describeFailure(error: unknown): string {
  const fields = (error ?? {}) as { status?: unknown; statusCode?: unknown };
  const text = error instanceof Error ? error.message : String(error);
  const status =
    [fields.statusCode, fields.status].find((s): s is number => typeof s === 'number') ??
    Number(/^(\d{3})\b|\((\d{3})\)|\bstatus(?: code)?:? (\d{3})\b/i.exec(text)?.slice(1).find(Boolean));
  if (status >= 400 && status < 600) return `HTTP ${status} ${STATUS[status] ?? (status < 500 ? 'refused' : 'server error')}`;
  if (/timed? ?out|ETIMEDOUT/i.test(text)) return 'timeout';
  if (/abort/i.test(text)) return 'aborted';
  if (/ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|network|connection error|socket/i.test(text)) return 'network error';
  if (/content.?filter|sensitive|refus/i.test(text)) return 'refused by the provider';
  return 'provider error';
}

/** The call failed or its answer was unusable. Not the model's `unsure`: the message is asked about again later. */
export interface JudgeFailure {
  /** A status and kind (`describeFailure`), never the provider's text. */
  failed: string;
  /** A call that answered unusably was still billed. */
  usage?: Usage;
  /** The model answered, but with no verdict sift could use: a failure of this message, not of the provider. */
  unusable?: true;
}

/** Port for the model. */
export type Judge = (input: JudgeInput) => Promise<Verdict | JudgeFailure>;

export interface JudgeInput {
  evidence: Evidence;
  labels: readonly Label[];
  /** Mail the owner labelled before, shown to the model as examples. Already chosen and cut to size. */
  examples?: readonly Shot[];
}

interface ModelStageDeps {
  gather: (facts: MessageFacts) => Promise<Evidence>;
  /** The judged rule that speaks for a message, if any. It always has a label. */
  prior?: (facts: MessageFacts) => (RuleHit & { label: Label }) | null;
  judge: Judge;
  labels: readonly Label[];
  /** Port for labelled examples that might help with this message. The stage picks from what it returns. Omitted: none are shown. */
  examples?: (facts: MessageFacts) => readonly Shot[] | Promise<readonly Shot[]>;
}

/**
 * The inference tier. The model has no tools and takes no action: it reads the evidence and names a
 * label. What happens next is that label's action, and two protections apply whatever the model says.
 */
export function modelStage(deps: ModelStageDeps): Stage<Decision | Unfinished> {
  return {
    name: 'model',
    async decide(facts) {
      const prior = deps.prior?.(facts) ?? null;
      const gathered = await deps.gather(facts);
      const evidence: Evidence = prior
        ? { ...gathered, prior: { labelId: prior.label.id, labelName: prior.label.name, ...(prior.rule.when ? { when: prior.rule.when } : {}) } }
        : gathered;
      const examples = deps.examples ? pickShots(await deps.examples(facts), facts, deps.labels) : [];
      const verdict = await deps.judge({ evidence, labels: deps.labels, ...(examples.length > 0 ? { examples } : {}) });
      if ('failed' in verdict) return { unfinished: verdict.failed };

      const base = {
        subscription: 'preserve' as const,
        stage: 'model' as const,
        ...(prior ? { priorRuleId: prior.rule.id } : {}),
        ...(verdict.confidence === undefined ? {} : { confidence: verdict.confidence }),
      };
      // The model found the owner's condition met: the rule's outcome applies. A rule that waits for a label
      // is only a hint here; it is applied once the label is settled, by `settle`.
      if (prior && prior.rule.when !== undefined && verdict.label === prior.label.id && !prior.rule.learned)
        return { ...base, ...ruleOutcome(prior), reason: `rule: ${describeRule(prior)}. ${verdict.reason}` };
      const unusual = prior && verdict.label !== prior.label.id ? `not the usual ${prior.label.name}. ` : '';

      const label = deps.labels.find((l) => l.id === verdict.label);
      // `unsure`, or a label that does not exist: the model could not place it, so the user decides.
      if (!label)
        return {
          ...base,
          disposition: 'review',
          reason: unusual + (verdict.label === UNSURE ? verdict.reason : `model named an unknown label: ${verdict.reason}`),
        };

      const outcome = labelled(label);
      const hides = outcome.disposition === 'archive' || outcome.disposition === 'spam';
      // Mail from someone the user has written to is never hidden on a model's word. Unknown counts as yes.
      if (hides && evidence.sender.userHasWritten !== false) {
        const why = evidence.sender.userHasWritten === null ? 'could not check whether you have written to this sender' : 'you have written to this sender';
        return {
          ...base,
          disposition: 'review',
          labelId: label.id,
          gmailLabel: label.gmailLabel,
          reason: `${unusual}${label.name}, but ${why}: ${verdict.reason}`,
        };
      }

      // Nor is a reply in a conversation the owner has taken part in, whoever sent it.
      if (hides && evidence.known.ownerInThread)
        return {
          ...base,
          disposition: 'review',
          labelId: label.id,
          gmailLabel: label.gmailLabel,
          reason: `${unusual}${label.name}, but you have written in this thread: ${verdict.reason}`,
        };

      if ((verdict.confidence ?? 0) < SURE)
        return {
          ...base,
          disposition: 'review',
          labelId: label.id,
          gmailLabel: label.gmailLabel,
          reason: `${unusual}${label.name}, but not sure enough to act on it: ${verdict.reason}`,
        };

      return { ...base, ...outcome, reason: `${unusual}${label.name}: ${verdict.reason}` };
    },
  };
}
