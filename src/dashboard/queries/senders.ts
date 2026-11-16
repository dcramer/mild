import type { DatabaseSync } from 'node:sqlite';
import { pendingSuggestions } from '../../learn/feedback.ts';
import { domainFacts, senderFacts } from '../../store/senders.ts';
import { listLabels } from '../../store/labels.ts';
import { type Scope, narrow } from '../scope.ts';
import type { SenderPage, SenderProfile } from '../types.ts';
import { listDecisions } from './decisions.ts';
import { listRuleSummaries } from './rules.ts';

/** What sift knows about one sender. */
function profileOf(db: DatabaseSync, scope: Scope, accountId: string, who: { address: string } | { domain: string }, now: number): SenderProfile | null {
  const here = narrow(scope, accountId);
  if (!here) return null;
  const known = 'address' in who ? senderFacts(db, accountId, who.address, now) : domainFacts(db, accountId, who.domain, now);
  if (!known) return null;
  const names = new Map(listLabels(db, accountId, now).map((l) => [l.id, l.name]));
  const domainName = 'address' in who ? (who.address.split('@')[1] ?? '') : who.domain;
  const ofDomain = 'address' in who ? domainFacts(db, accountId, domainName, now) : null;
  const rules = listRuleSummaries(db, here)
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
    standing: known.standing,
    why: known.why,
    messages: known.messages,
    firstSeenAt: known.firstSeenAt,
    lastSeenAt: known.lastSeenAt,
    recent: known.recent,
    senders: known.senders,
    consistency: known.consistency,
    answers: known.answers,
    userHasWritten: known.userHasWritten,
    labels: known.labels.map((l) => ({ id: l.id, name: names.get(l.id) ?? l.id, messages: l.messages })),
    domain: ofDomain ? { name: domainName, standing: ofDomain.standing, why: ofDomain.why, messages: ofDomain.messages, senders: ofDomain.senders } : null,
    rules,
  };
}

/** What sift knows about a sender, the rules that apply to them and where they stand. */
export function senderProfile(db: DatabaseSync, scope: Scope, accountId: string, address: string, now: number = Date.now()): SenderProfile | null {
  return profileOf(db, scope, accountId, { address }, now);
}

/** A sender's page, or a domain's. Null for a domain anyone can get an address at. */
export function senderPage(
  db: DatabaseSync,
  scope: Scope,
  accountId: string,
  who: { address: string } | { domain: string },
  now: number = Date.now(),
): SenderPage | null {
  const profile = profileOf(db, scope, accountId, who, now);
  if (!profile) return null;
  const filter = 'address' in who ? { sender: who.address } : { domain: who.domain };
  const name =
    'address' in who
      ? ((
          db
            .prepare('SELECT from_name FROM messages WHERE account_id = ? AND from_address = ? AND from_name IS NOT NULL ORDER BY received_at DESC LIMIT 1')
            .get(accountId, who.address) as { from_name: string } | undefined
        )?.from_name ?? null)
      : null;
  const senders =
    'domain' in who
      ? (
          db
            .prepare(
              `SELECT from_address AS address, max(from_name) AS name, count(*) AS messages, max(received_at) AS lastSeenAt
               FROM messages WHERE account_id = ? AND from_domain = ? GROUP BY from_address ORDER BY messages DESC, address LIMIT 100`,
            )
            .all(accountId, who.domain) as unknown as { address: string; name: string | null; messages: number; lastSeenAt: number }[]
        ).map((s) => ({ ...s, standing: senderFacts(db, accountId, s.address, now).standing }))
      : [];
  return {
    accountId,
    kind: 'address' in who ? 'sender' : 'domain',
    name,
    profile,
    senders,
    decisions: listDecisions(db, scope, { days: 36_500, limit: 50, accountId, ...filter }, now).rows,
    waiting: pendingSuggestions(db, { accountId, ...filter }).length,
  };
}
