import { listAccounts } from '../store/accounts.ts';
import { listLabels } from '../store/labels.ts';
import { finishRuleDraft, startRuleDraft } from '../store/rules.ts';
import { senderDirectory } from '../store/senders.ts';
import type { Sql } from '../store/sql.ts';
import { type FoundSender, type RuleDraft, type RuleDrafter, searchSenders } from '../prompts/rule-draft.ts';
import { recordedAsk } from './recorded.ts';

/**
 * The senders of all the person's mailboxes whose name, address, list or newest subject has the words looked up: the
 * model's one look-up, which changes nothing. Read once, on the first look-up: most of what is asked names no sender.
 */
export function senderLookup(db: Sql): (query: string) => Promise<FoundSender[]> {
  let senders: Promise<FoundSender[]> | undefined;
  return async (query) =>
    searchSenders(
      await (senders ??= listAccounts(db).then((accounts) =>
        senderDirectory(
          db,
          accounts.map((a) => a.id),
        ),
      )),
      query,
    );
}

/**
 * Ask the model to fill in a rule from what the person said, looking up their senders as it needs, recorded
 * before the call and with what it cost, under `accountId`. It looks senders up in all of the person's mailboxes,
 * as their rules apply to all of them. Nothing is made: the dialog shows the rule for them to add.
 * Rejects when the call failed.
 */
export async function draftRule(
  deps: { db: Sql; draft: RuleDrafter; model: string; now?: () => number },
  request: { accountId: string; goal: string },
): Promise<RuleDraft> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const id = await startRuleDraft(db, { ...request, model: deps.model, now: now() });
  const labels = await listLabels(db);
  const find = senderLookup(db);
  const { draft } = await recordedAsk<{ draft: RuleDraft }>({
    agent: 'rules',
    conversation: [db.person, id],
    attributes: { 'sift.rule_draft': id },
    ask: () => deps.draft({ goal: request.goal, labels }, find),
    finish: (outcome, spent) => finishRuleDraft(db, request.accountId, id, { ...outcome, ...spent }),
    report: 'Rule drafting failed',
    refusal: (failed) => `The model could not fill in a rule (${failed}). Try again, or fill it in yourself.`,
    now,
  });
  return draft;
}
