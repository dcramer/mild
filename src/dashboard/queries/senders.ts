import { alias, and, asc, count, decisions, desc, eq, isNotNull, max, messages } from '../../store/query.ts';
import { hashOf, newestOfGroup, openEnvelope, openNewest } from '../../store/content.ts';
import type { Sql } from '../../store/sql.ts';
import { contacts, domainFacts, senderFacts } from '../../store/senders.ts';
import { labelNames } from '../../store/labels.ts';
import { plainName } from '../../triage/stages/rules.ts';
import { type Scope, narrow } from '../scope.ts';
import type { SenderPage, SenderProfile } from '../types.ts';
import { listDecisions } from './decisions.ts';
import { listRuleSummaries } from './rules.ts';

const later = alias(decisions, 'later');

/** How much of an address's mail the names are read from. Each name is in its message's encrypted headers, so each is opened in Sift. */
const NAMES_FROM = 2_000;

/**
 * The names an address sends under, most mail first, each with what its mail currently is; empty unless it
 * uses two or more. Names alike but for case and spacing are one, shown as most recently written. And the
 * newest of them, which is what the address is called.
 */
async function namesOf(
  db: Sql,
  accountId: string,
  address: string,
  labelNames: ReadonlyMap<string, string>,
): Promise<{ names: SenderPage['names']; newest: string | null }> {
  const rows = await db
    .select({ id: messages.id, headers: messages.headers, receivedAt: messages.receivedAt })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.senderHash, hashOf(db, address))))
    .orderBy(desc(messages.receivedAt))
    .limit(NAMES_FROM);
  const labelled = await db
    .select({ messageId: decisions.messageId, labelId: decisions.labelId })
    .from(decisions)
    .innerJoin(messages, and(eq(messages.accountId, decisions.accountId), eq(messages.id, decisions.messageId)))
    .where(
      and(
        eq(decisions.accountId, accountId),
        eq(messages.senderHash, hashOf(db, address)),
        isNotNull(decisions.labelId),
        eq(
          decisions.id,
          db
            .select({ id: max(later.id) })
            .from(later)
            .where(and(eq(later.accountId, decisions.accountId), eq(later.messageId, decisions.messageId))),
        ),
      ),
    );
  const labelOf = new Map(labelled.map((r) => [r.messageId, r.labelId!]));
  const names = new Map<string, { name: string | null; messages: number; lastSeenAt: number; labels: Map<string, number> }>();
  let newest: string | null = null;
  for (const row of rows) {
    const name = openEnvelope(db, accountId, row.id, row).fromName?.trim() || null;
    newest ??= name;
    const key = name === null ? '' : plainName(name);
    const entry = names.get(key) ?? { name, messages: 0, lastSeenAt: row.receivedAt, labels: new Map<string, number>() };
    entry.messages++;
    const label = labelOf.get(row.id);
    if (label !== undefined) entry.labels.set(label, (entry.labels.get(label) ?? 0) + 1);
    names.set(key, entry);
  }
  if ([...names.values()].filter((n) => n.name !== null).length < 2) return { names: [], newest };
  return {
    names: [...names.values()]
      .toSorted((a, b) => b.messages - a.messages || b.lastSeenAt - a.lastSeenAt)
      .map(({ labels, ...n }) => ({
        ...n,
        labels: [...labels].toSorted(([, a], [, b]) => b - a).map(([id, messages]) => ({ id, name: labelNames.get(id) ?? id, messages })),
      })),
    newest,
  };
}

/** What sift knows about one sender. */
async function profileOf(db: Sql, scope: Scope, accountId: string, who: { address: string } | { domain: string }, now: number): Promise<SenderProfile | null> {
  const here = narrow(scope, accountId);
  if (!here) return null;
  const known = 'address' in who ? await senderFacts(db, accountId, who.address, now) : await domainFacts(db, accountId, who.domain, now);
  if (!known) return null;
  const names = await labelNames(db);
  const domainName = 'address' in who ? (who.address.split('@')[1] ?? '') : who.domain;
  const ofDomain = 'address' in who ? await domainFacts(db, accountId, domainName, now) : null;
  const rules = (await listRuleSummaries(db, here, now))
    .filter((r) =>
      'address' in who
        ? (r.match.from ?? []).includes(who.address) || (r.match.fromDomain ?? []).includes(domainName)
        : (r.match.fromDomain ?? []).includes(domainName) || (r.match.from ?? []).some((a) => a.endsWith(`@${domainName}`)),
    )
    .map((r) => ({
      id: r.id,
      match: r.match,
      name: r.name,
      labelId: r.labelId,
      labelName: r.labelName,
      disposition: r.disposition,
      source: r.source,
      kind: r.kind,
      when: r.when,
    }));
  return {
    address: 'address' in who ? who.address : who.domain,
    contact: known.contact,
    given: known.standing === 'trusted' || known.standing === 'unwanted' || known.standing === 'blocked' ? known.standing : null,
    messages: known.messages,
    firstSeenAt: known.firstSeenAt,
    lastSeenAt: known.lastSeenAt,
    recent: known.recent,
    senders: known.senders,
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

/** How many of a sender's newest messages are listed on their page. */
const LISTED = 50;

/**
 * A sender's page, or a domain's. Null for a domain anyone can get an address at. `under` narrows the mail
 * listed to what came under that name, read from as far back as the names are.
 */
export async function senderPage(
  db: Sql,
  scope: Scope,
  accountId: string,
  who: { address: string } | { domain: string },
  now: number = Date.now(),
  under?: string,
): Promise<SenderPage | null> {
  const profile = await profileOf(db, scope, accountId, who, now);
  if (!profile) return null;
  const filter = 'address' in who ? { sender: who.address } : { domain: who.domain };
  const named = 'address' in who ? await namesOf(db, accountId, who.address, await labelNames(db)) : null;
  const writing =
    'domain' in who
      ? (
          await db
            .select({
              newest: newestOfGroup(),
              messages: count(),
              lastSeenAt: max(messages.receivedAt),
            })
            .from(messages)
            .where(and(eq(messages.accountId, accountId), eq(messages.domainHash, hashOf(db, who.domain))))
            .groupBy(messages.accountId, messages.senderHash)
            .orderBy(desc(count()), asc(messages.senderHash))
            .limit(100)
        ).map(({ newest, ...s }) => {
          const { fromAddress, fromName } = openNewest(db, newest);
          return { address: fromAddress, ...s, name: fromName };
        })
      : [];
  const known = await contacts(
    db,
    writing.map((s) => ({ accountId, address: s.address })),
  );
  const senders = writing.map((s) => ({ ...s, lastSeenAt: s.lastSeenAt!, contact: known.get(`${accountId}\n${s.address}`) ?? null }));
  return {
    accountId,
    kind: 'address' in who ? 'sender' : 'domain',
    name: named?.newest ?? null,
    profile,
    names: named?.names ?? [],
    senders,
    decisions:
      under === undefined
        ? (await listDecisions(db, scope, { days: 36_500, limit: LISTED, accountId, ...filter }, now)).rows
        : (await listDecisions(db, scope, { days: 36_500, limit: NAMES_FROM, accountId, ...filter }, now)).rows
            .filter((row) => plainName(row.fromName ?? '') === plainName(under))
            .slice(0, LISTED),
  };
}
