import { currentPrefix, keyedHash, openSecret, openToRekey, sealSecret, staleSecret } from '../secrets.ts';
import type { Facts } from '../triage/facts.ts';
import { parseListId } from '../triage/features.ts';
import type { Address } from '../triage/types.ts';
import { actions, and, asc, correspondents, decisions, eq, examples, gt, messages, notLike, or, proposals, rules, sql, suggestionBodies } from './query.ts';
import type { RuleMatch } from '../triage/stages/rules.ts';
import type { Sql } from './sql.ts';

/** What Sift holds of a message that came from the message: its body, and the headers its record keeps. */
type Part = 'text' | 'html' | 'subject' | 'from' | 'domain' | 'name' | 'to' | 'cc' | 'headers' | 'reason';

/** Each is encrypted for its person, message and part, so one copied into another row does not open. */
const nameOf = (db: Sql, accountId: string, messageId: string, part: Part) => `person ${db.person} ${part} of ${accountId} ${messageId}`;
const correspondentName = (db: Sql, accountId: string) => `person ${db.person} correspondent of ${accountId}`;
export const ruleName = (db: Sql, ruleId: string, field: 'match' | 'except' | 'filter') => `person ${db.person} rule ${ruleId} ${field}`;
export const proposalName = (db: Sql, accountId: string) => `person ${db.person} proposal of ${accountId}`;
export const actionName = (db: Sql, accountId: string) => `person ${db.person} action of ${accountId}`;

/**
 * Marks a value stored without a key. Content comes from whoever sent the mail, so a subject that only
 * looks like an encrypted value must not be taken for one.
 */
const PLAIN = 'sift-plain:';

const seal = (db: Sql, name: string, value: string) => (db.keys.current ? sealSecret(name, value, db.keys) : PLAIN + value);

function open(db: Sql, name: string, stored: string): string {
  if (!stored.startsWith(PLAIN)) return openSecret(name, stored, db.keys);
  if (db.keys.current) throw new Error(`${name} is stored unencrypted though SIFT_KEY is set.`);
  return stored.slice(PLAIN.length);
}

/** A part as it is stored: encrypted with the install's key (marked plain without one), and null when there is none. */
export function sealPart(db: Sql, accountId: string, messageId: string, part: Part, value: string | null): string | null {
  return value === null ? null : seal(db, nameOf(db, accountId, messageId, part), value);
}

/** A stored part, decrypted. Refuses a plain one once there is a key, as `openSecret` does: every one was encrypted at start. */
export function openPart(db: Sql, accountId: string, messageId: string, part: Part, stored: string | null): string | null {
  return stored === null ? null : open(db, nameOf(db, accountId, messageId, part), stored);
}

/** JSON that names senders without being part of a message: a rule's or proposal's conditions, a change's details. */
export const sealJson = (db: Sql, name: string, value: unknown): string => seal(db, name, JSON.stringify(value));
export const openJson = <T>(db: Sql, name: string, stored: string): T => JSON.parse(open(db, name, stored)) as T;

/** Key order does not matter, as it did not to `jsonb` equality; a missing key and an undefined one are the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return `{${entries
    .toSorted(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(',')}}`;
}

/** What finds a rule, or a proposal, with exactly these conditions: the keyed hash of them. */
export const conditionsHash = (db: Sql, match: RuleMatch, except: readonly RuleMatch[] = []): string => hashOf(db, canonical([match, except]));

/**
 * The keyed hash an address or domain is found by (src/secrets.ts). Equal values hash the same for one
 * person and differently for another; nothing else can be asked of it.
 */
export function hashOf(db: Sql, value: string): string {
  if (db.person === null) throw new Error('Only a person’s handle hashes what came from their mail.');
  return keyedHash(db.keys, db.person, value.toLowerCase());
}

/** A cached correspondent's address as stored: found by its hashes; the encrypted copy is what hashes it again under a new key. */
export function sealCorrespondent(db: Sql, accountId: string, address: string): { address: string; addressHash: string; domainHash: string } {
  return { address: seal(db, correspondentName(db, accountId), address), addressHash: hashOf(db, address), domainHash: hashOf(db, domainOf(address)) };
}

const domainOf = (address: string) => address.slice(address.lastIndexOf('@') + 1);

/** The parts of a message's record that came from its headers. */
interface Envelope {
  fromAddress: string;
  fromDomain: string;
  fromName: string | null;
  subject: string;
  to: Address[];
  cc: Address[];
  headers: Record<string, string>;
}

const ENVELOPE = {
  fromAddress: 'from',
  fromDomain: 'domain',
  fromName: 'name',
  subject: 'subject',
  to: 'to',
  cc: 'cc',
  headers: 'headers',
} as const satisfies Record<keyof Envelope, Part>;
const JSON_PARTS = new Set<keyof Envelope>(['to', 'cc', 'headers']);

/** An envelope's columns as `messages` stores them, with the hashes its sender is found by. */
export function sealEnvelope(db: Sql, accountId: string, messageId: string, envelope: Envelope) {
  const part = (key: keyof Envelope, value: unknown) =>
    sealPart(db, accountId, messageId, ENVELOPE[key], JSON_PARTS.has(key) ? JSON.stringify(value) : (value as string | null));
  return {
    sender: part('fromAddress', envelope.fromAddress)!,
    senderHash: hashOf(db, envelope.fromAddress),
    domain: part('fromDomain', envelope.fromDomain)!,
    domainHash: hashOf(db, envelope.fromDomain),
    fromName: part('fromName', envelope.fromName),
    subject: part('subject', envelope.subject)!,
    to: part('to', envelope.to)!,
    cc: part('cc', envelope.cc)!,
    headers: part('headers', envelope.headers)!,
  };
}

/**
 * Facts as `messages` stores them. A list id says who sent the mail, so it is kept as its hash, which
 * still says whether there is one; `openFacts` puts it back from the headers.
 */
export const sealFacts = (db: Sql, facts: Facts): Facts => ({ ...facts, listId: facts.listId === null ? null : hashOf(db, facts.listId) });

/** Stored facts with their list id, from the message's headers (decrypted). */
export const openFacts = (facts: Facts, headers: Record<string, string>): Facts => ({
  ...facts,
  listId: facts.listId === null ? null : parseListId(headers['list-id']),
});

/** What is read back decrypted, by the name a query gives its column: the envelope, and a decision's reason, which is kept per message too. */
interface Readable extends Envelope {
  reason: string;
}
const READABLE = { ...ENVELOPE, reason: 'reason' } as const satisfies Record<keyof Readable, Part>;

/** Null stays null, as a message missing from a left join reads. */
type Decoded<V, T> = V extends null ? null : T;
type Opened<R> = { [K in keyof R]: K extends keyof Readable ? Decoded<R[K], Readable[K]> : R[K] };

/** `row` with whichever of the message's encrypted columns it read decrypted; its other columns as they are. */
export function openEnvelope<R extends { [K in keyof Readable]?: string | null }>(db: Sql, accountId: string, messageId: string, row: R): Opened<R> {
  const opened: Record<string, unknown> = { ...row };
  for (const key of Object.keys(READABLE) as (keyof Readable)[]) {
    if (!(key in row)) continue;
    const text = openPart(db, accountId, messageId, READABLE[key], row[key] ?? null);
    opened[key] = text !== null && JSON_PARTS.has(key as keyof Envelope) ? JSON.parse(text) : text;
  }
  return opened as Opened<R>;
}

/**
 * For a query grouped by sender: one message of the group, as `[account, message id, encrypted address]`,
 * which `openSender` turns into the address. An address is encrypted for its message, so it cannot be shown without one.
 */
export const oneSender = () =>
  sql<[string, string, string]>`(array_agg(json_build_array(${messages.accountId}, ${messages.id}, ${messages.sender})))[1]`.mapWith((v: unknown) =>
    typeof v === 'string' ? JSON.parse(v) : v,
  );

export const openSender = (db: Sql, [accountId, messageId, stored]: [string, string, string]): string => openPart(db, accountId, messageId, 'from', stored)!;

/** The envelope's columns, for a select that reads them all. */
export const ENVELOPE_COLUMNS = {
  fromAddress: messages.sender,
  fromDomain: messages.domain,
  fromName: messages.fromName,
  subject: messages.subject,
  to: messages.to,
  cc: messages.cc,
  headers: messages.headers,
};

const forRekey = (db: Sql, accountId: string, messageId: string, part: Part, stored: string | null) =>
  stored === null ? null : reopen(db, nameOf(db, accountId, messageId, part), stored);

const reopen = (db: Sql, name: string, stored: string) => (stored.startsWith(PLAIN) ? stored.slice(PLAIN.length) : openToRekey(name, stored, db.keys));

const stale = (db: Sql, stored: string | null) => stored !== null && db.keys.current !== null && (stored.startsWith(PLAIN) || staleSecret(stored, db.keys));

/** Mail records are read this many at a time: a mailbox can have many thousands. */
const BATCH = 500;

/**
 * Bring everything `db` holds of its messages' content under the current key, as `rekeyCredentials` does
 * for sign-ins. Throws if one does not open with the handle's keys. `write: false` only checks. Returns
 * how many messages had something to bring under it.
 */
export async function rekeyContent(db: Sql, write = true): Promise<number> {
  const prefix = currentPrefix(db.keys);
  await rekeyConditions(db, prefix, write);
  if (prefix === null) return 0;
  await rekeyLog(db, prefix, write);
  return await rekeyMail(db, prefix, write);
}

const UNSET = 'unset:';

/**
 * Rules and proposals: few, so read whole. Their conditions are hashed again with the key, and those a
 * migration could not hash (`unset:`) are hashed here even without one.
 */
async function rekeyConditions(db: Sql, prefix: string | null, write: boolean): Promise<void> {
  const behind = (stored: string | null) => stored !== null && prefix !== null && !stored.startsWith(prefix);
  const ruleRows = await db
    .select({ id: rules.id, match: rules.match, except: rules.except, filter: rules.filterWritten, conditions: rules.conditions })
    .from(rules);
  const ruleUpdates = ruleRows
    .filter((r) => r.conditions.startsWith(UNSET) || behind(r.match) || behind(r.except) || behind(r.filter))
    .map((r) => {
      const match = JSON.parse(reopen(db, ruleName(db, r.id, 'match'), r.match)) as RuleMatch;
      const except = JSON.parse(reopen(db, ruleName(db, r.id, 'except'), r.except)) as RuleMatch[];
      const filter = r.filter === null ? null : reopen(db, ruleName(db, r.id, 'filter'), r.filter);
      return {
        id: r.id,
        set: {
          match: sealJson(db, ruleName(db, r.id, 'match'), match),
          except: sealJson(db, ruleName(db, r.id, 'except'), except),
          filterWritten: filter === null ? null : seal(db, ruleName(db, r.id, 'filter'), filter),
          conditions: conditionsHash(db, match, except),
        },
      };
    });
  const proposalRows = await db
    .select({ id: proposals.id, accountId: proposals.accountId, match: proposals.match, conditions: proposals.conditions })
    .from(proposals);
  const proposalUpdates = proposalRows
    .filter((r) => r.conditions.startsWith(UNSET) || behind(r.match))
    .map((r) => {
      const match = JSON.parse(reopen(db, proposalName(db, r.accountId), r.match)) as RuleMatch;
      return { id: r.id, set: { match: sealJson(db, proposalName(db, r.accountId), match), conditions: conditionsHash(db, match) } };
    });
  if (write)
    await db.transaction(async (tx) => {
      for (const { id, set } of ruleUpdates) await tx.update(rules).set(set).where(eq(rules.id, id));
      for (const { id, set } of proposalUpdates) await tx.update(proposals).set(set).where(eq(proposals.id, id));
    });
}

/** Changes made and decisions reached: one row each, so read in batches like mail records. */
async function rekeyLog(db: Sql, prefix: string, write: boolean): Promise<void> {
  for (let after = 0; ;) {
    const rows = await db
      .select({ id: actions.id, accountId: actions.accountId, payload: actions.payload })
      .from(actions)
      .where(and(notLike(actions.payload, `${prefix}%`), gt(actions.id, after)))
      .orderBy(asc(actions.id))
      .limit(BATCH);
    if (rows.length === 0) break;
    const sealed = rows.map((r) => ({ id: r.id, payload: seal(db, actionName(db, r.accountId), reopen(db, actionName(db, r.accountId), r.payload)) }));
    if (write)
      await db.transaction(async (tx) => {
        for (const { id, payload } of sealed) await tx.update(actions).set({ payload }).where(eq(actions.id, id));
      });
    after = rows.at(-1)!.id;
  }
  for (let after = 0; ;) {
    const rows = await db
      .select({ id: decisions.id, accountId: decisions.accountId, messageId: decisions.messageId, reason: decisions.reason })
      .from(decisions)
      .where(and(notLike(decisions.reason, `${prefix}%`), gt(decisions.id, after)))
      .orderBy(asc(decisions.id))
      .limit(BATCH);
    if (rows.length === 0) break;
    const sealed = rows.map((r) => ({
      id: r.id,
      reason: sealPart(db, r.accountId, r.messageId, 'reason', forRekey(db, r.accountId, r.messageId, 'reason', r.reason))!,
    }));
    if (write)
      await db.transaction(async (tx) => {
        for (const { id, reason } of sealed) await tx.update(decisions).set({ reason }).where(eq(decisions.id, id));
      });
    after = rows.at(-1)!.id;
  }
}

/** Mail records, bodies and correspondents. Returns how many messages had something to bring under the key. */
async function rekeyMail(db: Sql, prefix: string, write: boolean): Promise<number> {
  const touched = new Set<string>();
  const bodies = [
    {
      table: suggestionBodies,
      rows: await db
        .select({
          accountId: suggestionBodies.accountId,
          messageId: suggestionBodies.messageId,
          text: suggestionBodies.bodyText,
          html: suggestionBodies.bodyHtml,
        })
        .from(suggestionBodies),
    },
    {
      table: examples,
      rows: await db.select({ accountId: examples.accountId, messageId: examples.messageId, text: examples.bodyText, html: examples.bodyHtml }).from(examples),
    },
  ];
  const reseal = bodies.flatMap(({ table, rows }) =>
    rows
      .filter((r) => stale(db, r.text) || stale(db, r.html))
      .map((r) => ({
        table,
        row: r,
        text: sealPart(db, r.accountId, r.messageId, 'text', forRekey(db, r.accountId, r.messageId, 'text', r.text)),
        html: sealPart(db, r.accountId, r.messageId, 'html', forRekey(db, r.accountId, r.messageId, 'html', r.html)),
      })),
  );
  for (const { row } of reseal) touched.add(`${row.accountId}\n${row.messageId}`);
  if (write)
    await db.transaction(async (tx) => {
      for (const { table, row, text, html } of reseal)
        await tx
          .update(table)
          .set({ bodyText: text, bodyHtml: html })
          .where(and(eq(table.accountId, row.accountId), eq(table.messageId, row.messageId)));
    });

  // Every part of a record is written together, so its subject and sender say whether the rest is under the
  // current key and its hashes made with it. Hashes made before addresses were encrypted are not.
  let after: { accountId: string; id: string } | null = null;
  for (;;) {
    const rows = await db
      .select({ accountId: messages.accountId, id: messages.id, facts: messages.facts, ...ENVELOPE_COLUMNS })
      .from(messages)
      .where(
        and(
          or(notLike(messages.subject, `${prefix}%`), notLike(messages.sender, `${prefix}%`)),
          after ? or(gt(messages.accountId, after.accountId), and(eq(messages.accountId, after.accountId), gt(messages.id, after.id))) : undefined,
        ),
      )
      .orderBy(asc(messages.accountId), asc(messages.id))
      .limit(BATCH);
    if (rows.length === 0) break;
    const records = rows.map((r) => {
      const headers = JSON.parse(forRekey(db, r.accountId, r.id, 'headers', r.headers)!) as Record<string, string>;
      return {
        accountId: r.accountId,
        id: r.id,
        sealed: {
          ...sealEnvelope(db, r.accountId, r.id, {
            fromAddress: forRekey(db, r.accountId, r.id, 'from', r.fromAddress)!,
            fromDomain: forRekey(db, r.accountId, r.id, 'domain', r.fromDomain)!,
            fromName: forRekey(db, r.accountId, r.id, 'name', r.fromName),
            subject: forRekey(db, r.accountId, r.id, 'subject', r.subject)!,
            to: JSON.parse(forRekey(db, r.accountId, r.id, 'to', r.to)!),
            cc: JSON.parse(forRekey(db, r.accountId, r.id, 'cc', r.cc)!),
            headers,
          }),
          facts: sealFacts(db, openFacts(r.facts, headers)),
        },
      };
    });
    for (const r of records) touched.add(`${r.accountId}\n${r.id}`);
    if (write)
      await db.transaction(async (tx) => {
        for (const r of records)
          await tx
            .update(messages)
            .set(r.sealed)
            .where(and(eq(messages.accountId, r.accountId), eq(messages.id, r.id)));
      });
    const last: { accountId: string; id: string } = rows.at(-1)!;
    after = { accountId: last.accountId, id: last.id };
  }

  // A small cache: read whole.
  const cached = (
    await db.select({ accountId: correspondents.accountId, address: correspondents.address, hash: correspondents.addressHash }).from(correspondents)
  ).filter((r) => !r.address.startsWith(prefix));
  const rewritten = cached.map((r) => ({ ...r, sealed: sealCorrespondent(db, r.accountId, reopen(db, correspondentName(db, r.accountId), r.address)) }));
  if (write)
    await db.transaction(async (tx) => {
      for (const r of rewritten)
        await tx
          .update(correspondents)
          .set(r.sealed)
          .where(and(eq(correspondents.accountId, r.accountId), eq(correspondents.addressHash, r.hash)));
    });
  return touched.size;
}
