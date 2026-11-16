import type { Sql } from '../../store/sql.ts';
import { accuracy, pendingSuggestions } from '../../learn/feedback.ts';
import { listLabels } from '../../store/labels.ts';
import type { Label } from '../../triage/types.ts';
import { listProposals } from '../../store/proposals.ts';
import { type Scope, sees, within } from '../scope.ts';
import type { SuggestionDetail, SuggestionItem, Suggestions } from '../types.ts';
import { outcomeOf } from './labels.ts';
import { senderProfile } from './senders.ts';

/** One sender's waiting mail, newest first, with what sift knows about them. */
export async function suggestionDetail(db: Sql, scope: Scope, accountId: string, sender: string): Promise<SuggestionDetail | null> {
  if (!sees(scope, accountId)) return null;
  const names = new Map((await listLabels(db, accountId)).map((l) => [l.id, l.name]));
  const messages = [];
  for (const s of await pendingSuggestions(db, { accountId, sender, limit: 200 })) {
    const received = (await db.get<{ received_at: number }>('SELECT received_at FROM messages WHERE account_id = ? AND id = ?', accountId, s.messageId))!;
    messages.push({
      decisionId: s.decisionId,
      messageId: s.messageId,
      subject: s.subject,
      receivedAt: received.received_at,
      disposition: s.block ? 'block' : s.disposition,
      labelId: s.labelId,
      labelName: (s.labelId && names.get(s.labelId)) ?? null,
      stage: s.stage,
      reason: s.reason,
    });
  }
  return { sender: (await senderProfile(db, scope, accountId, sender))!, messages };
}

const MAX_ITEMS = 500;

/**
 * What is waiting on the user, one group per sender, since an answer is about a sender. A group shows
 * the guess sift made for most of that sender's waiting mail. Biggest groups first: they teach the most.
 */
export async function listSuggestions(db: Sql, scope: Scope, options: { includeKept?: boolean } = {}): Promise<Suggestions> {
  const accounts = scope.accounts.map((id) => ({ id }));
  const labels = new Map<string, Label[]>();
  for (const { id } of accounts) labels.set(id, await listLabels(db, id));
  const names = new Map([...labels].flatMap(([account, list]) => list.map((l) => [`${account}\n${l.id}`, l.name] as const)));
  const waitingNow = (await pendingSuggestions(db, { accounts: scope.accounts })).filter((s) => options.includeKept || s.disposition !== 'keep');
  const shown = waitingNow.slice(0, MAX_ITEMS);
  // What each sender's mail has been labelled, by its current decision, to offer as other likely labels.
  const history = new Map<string, Map<string, number>>();
  const senders = [...new Set(shown.map((s) => `${s.accountId}\n${s.fromAddress}`))];
  for (const key of senders) {
    const [accountId = '', address = ''] = key.split('\n');
    const rows = await db.all<{ label_id: string; n: number }>(
      `SELECT d.label_id, count(*) AS n FROM decisions d JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
       WHERE d.account_id = ? AND m.from_address = ? AND d.label_id IS NOT NULL
         AND d.id = (SELECT max(id) FROM decisions x WHERE x.account_id = d.account_id AND x.message_id = d.message_id)
       GROUP BY d.label_id`,
      accountId,
      address,
    );
    history.set(key, new Map(rows.map((r) => [r.label_id, r.n])));
  }
  const alternatives = (s: (typeof shown)[number]) => {
    const counts = history.get(`${s.accountId}\n${s.fromAddress}`) ?? new Map<string, number>();
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    return [...counts]
      .filter(([id]) => id !== s.labelId)
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 2)
      .flatMap(([id, n]) => {
        const name = names.get(`${s.accountId}\n${id}`);
        return name ? [{ id, name, share: n / total }] : [];
      });
  };
  const items = shown.map((s): SuggestionItem => ({
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
    alternatives: alternatives(s),
  }));
  const { reviewed, right } = await accuracy(db, 0, scope.accounts);
  const examples = (await db.get<{
    captured: number | null;
    pending: number | null;
  }>(`SELECT sum(status = 'captured') AS captured, sum(status = 'pending') AS pending FROM examples WHERE ${within(scope, 'account_id')}`))!;
  return {
    labels: Object.fromEntries([...labels].map(([id, list]) => [id, list.map((l) => ({ id: l.id, name: l.name, disposition: outcomeOf(l) }))])),
    examples: { captured: examples.captured ?? 0, pending: examples.pending ?? 0 },
    proposals: (await listProposals(db))
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
