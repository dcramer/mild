import { and, asc, count, desc, eq, isNotNull, max, messages } from '../../store/query.ts';
import type { Sql } from '../../store/sql.ts';
import { pendingSuggestions } from '../../learn/feedback.ts';
import { contacts, domainFacts, senderFacts } from '../../store/senders.ts';
import { listLabels } from '../../store/labels.ts';
import { type Scope, narrow } from '../scope.ts';
import type { SenderPage, SenderProfile } from '../types.ts';
import { listDecisions } from './decisions.ts';
import { listRuleSummaries } from './rules.ts';

/** What sift knows about one sender. */
async function profileOf(db: Sql, scope: Scope, accountId: string, who: { address: string } | { domain: string }, now: number): Promise<SenderProfile | null> {
  const here = narrow(scope, accountId);
  if (!here) return null;
  const known = 'address' in who ? await senderFacts(db, accountId, who.address, now) : await domainFacts(db, accountId, who.domain, now);
  if (!known) return null;
  const names = new Map((await listLabels(db, accountId)).map((l) => [l.id, l.name]));
  const domainName = 'address' in who ? (who.address.split('@')[1] ?? '') : who.domain;
  const ofDomain = 'address' in who ? await domainFacts(db, accountId, domainName, now) : null;
  const rules = (await listRuleSummaries(db, here))
    .filter(
      (r) =>
        r.accountId === accountId &&
        ('address' in who
          ? r.match['from'] === who.address || (r.match['fromDomain'] === domainName && r.match['from'] === undefined)
          : r.match['fromDomain'] === domainName || r.match['from']?.endsWith(`@${domainName}`)),
    )
    .map((r) => ({ id: r.id, match: r.match, labelName: r.labelName, disposition: r.disposition, source: r.source, kind: r.kind, when: r.when }));
  return {
    address: 'address' in who ? who.address : who.domain,
    contact: known.contact,
    given: known.standing === 'trusted' || known.standing === 'unwanted' || known.standing === 'blocked' ? known.standing : null,
    messages: known.messages,
    firstSeenAt: known.firstSeenAt,
    lastSeenAt: known.lastSeenAt,
    recent: known.recent,
    senders: known.senders,
    consistency: known.consistency,
    answers: known.answers,
    userHasWritten: known.userHasWritten,
    labels: known.labels.map((l) => ({ id: l.id, name: names.get(l.id) ?? l.id, messages: l.messages })),
    domain: ofDomain ? { name: domainName, contact: ofDomain.contact } : null,
    rules,
  };
}

/** What sift knows about a sender, the rules that apply to them and where they stand. */
export async function senderProfile(db: Sql, scope: Scope, accountId: string, address: string, now: number = Date.now()): Promise<SenderProfile | null> {
  return await profileOf(db, scope, accountId, { address }, now);
}

/** A sender's page, or a domain's. Null for a domain anyone can get an address at. */
export async function senderPage(
  db: Sql,
  scope: Scope,
  accountId: string,
  who: { address: string } | { domain: string },
  now: number = Date.now(),
): Promise<SenderPage | null> {
  const profile = await profileOf(db, scope, accountId, who, now);
  if (!profile) return null;
  const filter = 'address' in who ? { sender: who.address } : { domain: who.domain };
  const name =
    'address' in who
      ? ((
          await db
            .select({ fromName: messages.fromName })
            .from(messages)
            .where(and(eq(messages.accountId, accountId), eq(messages.fromAddress, who.address), isNotNull(messages.fromName)))
            .orderBy(desc(messages.receivedAt))
            .limit(1)
        )[0]?.fromName ?? null)
      : null;
  const writing =
    'domain' in who
      ? await db
          .select({ address: messages.fromAddress, name: max(messages.fromName), messages: count(), lastSeenAt: max(messages.receivedAt) })
          .from(messages)
          .where(and(eq(messages.accountId, accountId), eq(messages.fromDomain, who.domain)))
          .groupBy(messages.fromAddress)
          .orderBy(desc(count()), asc(messages.fromAddress))
          .limit(100)
      : [];
  const known = await contacts(
    db,
    writing.map((s) => ({ accountId, address: s.address })),
  );
  const senders = writing.map((s) => ({ ...s, lastSeenAt: s.lastSeenAt!, contact: known.get(`${accountId}\n${s.address}`) ?? null }));
  return {
    accountId,
    kind: 'address' in who ? 'sender' : 'domain',
    name,
    profile,
    senders,
    decisions: (await listDecisions(db, scope, { days: 36_500, limit: 50, accountId, ...filter }, now)).rows,
    waiting: (await pendingSuggestions(db, { accountId, ...filter })).length,
  };
}
