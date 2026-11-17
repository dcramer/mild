import {
  alias,
  and,
  count,
  decisions,
  eq,
  examples as exampleRows,
  isNotNull,
  max,
  messages as messageRows,
  not,
  notExists,
  sql,
  suggestionBodies,
} from '../../store/query.ts';
import { outOfTries } from '../../store/runs.ts';
import type { Sql } from '../../store/sql.ts';
import { accuracy, pendingSuggestions } from '../../learn/feedback.ts';
import { listLabels } from '../../store/labels.ts';
import { preferences } from '../../store/preferences.ts';
import { hashOf, openPart } from '../../store/content.ts';
import type { Label } from '../../triage/types.ts';
import { listProposals, settledAction } from '../../store/proposals.ts';
import { listRules } from '../../store/rules.ts';
import { contacts } from '../../store/senders.ts';
import { type Scope, sees, within } from '../scope.ts';
import { FACT_FILTERS, type FactFilter, type SuggestionDetail, type SuggestionItem, type Suggestions } from '../types.ts';
import { outcomeOf } from './labels.ts';
import { senderProfile } from './senders.ts';

/** One sender's waiting mail, newest first, with what sift knows about them. */
export async function suggestionDetail(db: Sql, scope: Scope, accountId: string, sender: string): Promise<SuggestionDetail | null> {
  if (!sees(scope, accountId)) return null;
  const names = new Map((await listLabels(db, accountId)).map((l) => [l.id, l.name]));
  const messages = [];
  for (const s of await pendingSuggestions(db, { accountId, sender, limit: 200 })) {
    const [received] = (await db
      .select({ receivedAt: messageRows.receivedAt })
      .from(messageRows)
      .where(and(eq(messageRows.accountId, accountId), eq(messageRows.id, s.messageId)))) as [{ receivedAt: number }];
    messages.push({
      decisionId: s.decisionId,
      messageId: s.messageId,
      subject: s.subject,
      receivedAt: received.receivedAt,
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
 * Mail pulled in from before Sift was connected that the model has yet to decide. Each becomes a suggestion
 * on a later pass, unless the model keeps failing on it.
 */
async function pulledInWaiting(db: Sql, scope: Scope): Promise<boolean> {
  const [row] = await db
    .select({ id: messageRows.id })
    .from(messageRows)
    .where(
      and(
        within(scope, messageRows.accountId),
        eq(messageRows.suggestOnly, true),
        notExists(
          db
            .select({ id: decisions.id })
            .from(decisions)
            .where(and(eq(decisions.accountId, messageRows.accountId), eq(decisions.messageId, messageRows.id))),
        ),
        not(outOfTries(db, messageRows.accountId, messageRows.id)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** `pullingIn`: whether older mail asked for in these mailboxes is not yet all in. */
export async function listSuggestions(
  db: Sql,
  scope: Scope,
  options: { includeKept?: boolean; fact?: FactFilter; pullingIn?: boolean } = {},
): Promise<Suggestions> {
  const accounts = scope.accounts.map((id) => ({ id }));
  const labels = new Map<string, Label[]>();
  for (const { id } of accounts) labels.set(id, await listLabels(db, id));
  const names = new Map([...labels].flatMap(([account, list]) => list.map((l) => [`${account}\n${l.id}`, l.name] as const)));
  const waitingNow = (await pendingSuggestions(db, { accounts: scope.accounts, ...(options.fact ? { facts: FACT_FILTERS[options.fact] } : {}) })).filter(
    (s) => options.includeKept || s.disposition !== 'keep',
  );
  const shown = waitingNow.slice(0, MAX_ITEMS);
  // What each sender's mail has been labelled, by its current decision, to offer as other likely labels.
  const history = new Map<string, Map<string, number>>();
  const senders = [...new Set(shown.map((s) => `${s.accountId}\n${s.fromAddress}`))];
  const later = alias(decisions, 'later');
  for (const key of senders) {
    const [accountId = '', address = ''] = key.split('\n');
    const rows = await db
      .select({ labelId: decisions.labelId, n: count() })
      .from(decisions)
      .innerJoin(messageRows, and(eq(messageRows.accountId, decisions.accountId), eq(messageRows.id, decisions.messageId)))
      .where(
        and(
          eq(decisions.accountId, accountId),
          eq(messageRows.senderHash, hashOf(db, address)),
          isNotNull(decisions.labelId),
          eq(
            decisions.id,
            db
              .select({ id: max(later.id) })
              .from(later)
              .where(and(eq(later.accountId, decisions.accountId), eq(later.messageId, decisions.messageId))),
          ),
        ),
      )
      .groupBy(decisions.labelId);
    history.set(key, new Map(rows.map((r) => [r.labelId!, r.n])));
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
  // The text is held only while a message waits on the user, which every one shown here does.
  const previews = new Map(
    (
      await db
        .select({
          accountId: suggestionBodies.accountId,
          messageId: suggestionBodies.messageId,
          text: suggestionBodies.bodyText,
        })
        .from(suggestionBodies)
        .where(within(scope, suggestionBodies.accountId))
    ).map(
      (r) => [`${r.accountId}\n${r.messageId}`, openPart(db, r.accountId, r.messageId, 'text', r.text)!.slice(0, 400).replace(/\s+/g, ' ').trim()] as const,
    ),
  );
  const known = await contacts(
    db,
    shown.map((s) => ({ accountId: s.accountId, address: s.fromAddress })),
  );
  const items = shown.map((s): SuggestionItem => ({
    accountId: s.accountId,
    messageId: s.messageId,
    decisionId: s.decisionId,
    sender: s.fromAddress,
    senderName: s.fromName,
    contact: known.get(`${s.accountId}\n${s.fromAddress}`) ?? null,
    subject: s.subject,
    receivedAt: s.receivedAt,
    disposition: s.block ? 'block' : s.disposition,
    labelId: s.labelId,
    labelName: (s.labelId && names.get(`${s.accountId}\n${s.labelId}`)) ?? null,
    unsubscribe: s.unsubscribe,
    stage: s.stage,
    confidence: s.confidence,
    alternatives: alternatives(s),
    preview: previews.get(`${s.accountId}\n${s.messageId}`) || null,
  }));
  const { reviewed, right } = await accuracy(db, 0, scope.accounts);
  const [examples] = (await db
    .select({
      captured: sql<number>`count(*) FILTER (WHERE ${exampleRows.status} = 'captured')`.mapWith(Number),
      pending: sql<number>`count(*) FILTER (WHERE ${exampleRows.status} = 'pending')`.mapWith(Number),
    })
    .from(exampleRows)
    .where(within(scope, exampleRows.accountId))) as [{ captured: number | null; pending: number | null }];
  return {
    labels: Object.fromEntries([...labels].map(([id, list]) => [id, list.map((l) => ({ id: l.id, name: l.name, disposition: outcomeOf(l) }))])),
    examples: { captured: examples.captured ?? 0, pending: examples.pending ?? 0 },
    proposals: await proposalSummaries(db, scope, labels),
    items,
    waiting: waitingNow.length,
    accuracy: { reviewed, right },
    active: (await preferences(db)).active,
    importing: options.pullingIn === true || (await pulledInWaiting(db, scope)),
  };
}

async function proposalSummaries(db: Sql, scope: Scope, labels: Map<string, Label[]>): Promise<Suggestions['proposals']> {
  const summaries: Suggestions['proposals'] = [];
  for (const p of await listProposals(db)) {
    const label = labels.get(p.accountId)?.find((l) => l.id === p.labelId);
    // A proposal whose label has been removed has nothing to offer.
    if (!sees(scope, p.accountId) || !label) continue;
    const rule = p.ruleId === null ? undefined : (await listRules(db, p.accountId)).find((r) => r.id === p.ruleId)!;
    summaries.push({
      id: p.id,
      accountId: p.accountId,
      kind: p.kind,
      match: p.match,
      labelId: p.labelId,
      labelName: label.name,
      disposition: rule ? settledAction(rule, label) : p.disposition!,
      labelDisposition: outcomeOf(label),
      agreed: p.agreed,
    });
  }
  return summaries;
}
