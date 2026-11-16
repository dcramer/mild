import type { DatabaseSync } from 'node:sqlite';
import { accuracy, pendingSuggestions } from '../../learn/feedback.ts';
import { listLabels } from '../../store/labels.ts';
import { listProposals } from '../../store/proposals.ts';
import { type Scope, sees, within } from '../scope.ts';
import type { SuggestionDetail, SuggestionItem, Suggestions } from '../types.ts';
import { outcomeOf } from './labels.ts';
import { senderProfile } from './senders.ts';

/** One sender's waiting mail, newest first, with what sift knows about them. */
export function suggestionDetail(db: DatabaseSync, scope: Scope, accountId: string, sender: string): SuggestionDetail | null {
  if (!sees(scope, accountId)) return null;
  const names = new Map(listLabels(db, accountId).map((l) => [l.id, l.name]));
  const received = db.prepare('SELECT received_at FROM messages WHERE account_id = ? AND id = ?');
  return {
    sender: senderProfile(db, scope, accountId, sender)!,
    messages: pendingSuggestions(db, { accountId, sender, limit: 200 }).map((s) => ({
      decisionId: s.decisionId,
      messageId: s.messageId,
      subject: s.subject,
      receivedAt: (received.get(accountId, s.messageId) as { received_at: number }).received_at,
      disposition: s.block ? 'block' : s.disposition,
      labelId: s.labelId,
      labelName: (s.labelId && names.get(s.labelId)) ?? null,
      stage: s.stage,
      reason: s.reason,
    })),
  };
}

const MAX_ITEMS = 500;

/**
 * What is waiting on the user, one group per sender, since an answer is about a sender. A group shows
 * the guess sift made for most of that sender's waiting mail. Biggest groups first: they teach the most.
 */
export function listSuggestions(db: DatabaseSync, scope: Scope, options: { includeKept?: boolean } = {}): Suggestions {
  const accounts = scope.accounts.map((id) => ({ id }));
  const labels = new Map(accounts.map(({ id }) => [id, listLabels(db, id)] as const));
  const names = new Map([...labels].flatMap(([account, list]) => list.map((l) => [`${account}\n${l.id}`, l.name] as const)));
  const waitingNow = pendingSuggestions(db, { accounts: scope.accounts }).filter((s) => options.includeKept || s.disposition !== 'keep');
  const items = waitingNow.slice(0, MAX_ITEMS).map((s): SuggestionItem => ({
    accountId: s.accountId,
    messageId: s.messageId,
    decisionId: s.decisionId,
    sender: s.fromAddress,
    senderName: s.fromName,
    subject: s.subject,
    receivedAt: s.receivedAt,
    disposition: s.block ? 'block' : s.disposition,
    labelId: s.labelId,
    labelName: (s.labelId && names.get(`${s.accountId}\n${s.labelId}`)) ?? null,
    unsubscribe: s.unsubscribe,
    stage: s.stage,
    confidence: s.confidence,
  }));
  const { reviewed, right } = accuracy(db, 0, scope.accounts);
  const examples = db
    .prepare(`SELECT sum(status = 'captured') AS captured, sum(status = 'pending') AS pending FROM examples WHERE ${within(scope, 'account_id')}`)
    .get() as {
    captured: number | null;
    pending: number | null;
  };
  return {
    labels: Object.fromEntries([...labels].map(([id, list]) => [id, list.map((l) => ({ id: l.id, name: l.name, disposition: outcomeOf(l) }))])),
    examples: { captured: examples.captured ?? 0, pending: examples.pending ?? 0 },
    proposals: listProposals(db)
      .filter((p) => sees(scope, p.accountId))
      .flatMap((p) => {
        const label = labels.get(p.accountId)?.find((l) => l.id === p.labelId);
        // A proposal whose label has been removed has nothing to offer.
        if (!label) return [];
        return [
          {
            id: p.id,
            accountId: p.accountId,
            kind: p.kind,
            match: p.match as Record<string, string>,
            labelId: p.labelId,
            labelName: label.name,
            disposition: outcomeOf(label),
            agreed: p.agreed,
          },
        ];
      }),
    items,
    waiting: waitingNow.length,
    accuracy: { reviewed, right },
  };
}
