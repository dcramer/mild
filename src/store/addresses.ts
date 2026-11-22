import { wordsOf } from '../search.ts';
import { type Facts, sentInBulk } from '../triage/facts.ts';
import { envelopeOf, parseAddressList } from '../triage/features.ts';
import type { Address, MessageFacts } from '../triage/types.ts';
import { addressName, hashOf, openJson, openPart, sealJson } from './content.ts';
import { addresses, and, asc, eq, mailboxes, messages, sql } from './query.ts';
import { bloomOf } from './search.ts';
import type { Sql } from './sql.ts';
import { plain } from '../plain.ts';

/** The index holds each word's starts up to this long; a longer one typed is looked up by these letters, and the words checked. */
export const ADDRESS_PREFIX = 6;

/** An address as a message shows it: someone the owner wrote to, or who wrote to them. */
interface Seen {
  address: string;
  name: string | null;
  at: number;
  wrote: boolean;
}

/** The starts of each word of a name and address, from one letter: what the composer is typed with. */
function addressTerms(who: { address: string; name: string | null }): Set<string> {
  const terms = new Set<string>();
  for (const word of wordsOf(`${who.name ?? ''} ${who.address}`))
    for (let length = 1; length <= Math.min(word.length, ADDRESS_PREFIX); length++) terms.add(`@${word.slice(0, length)}`);
  return terms;
}

/**
 * Who a message says the owner knows: those they sent it to (Bcc too, which only their own copy carries), or its sender
 * when it was not sent in bulk or marked spam. Never the owner's own addresses.
 */
function seenIn(m: Pick<MessageFacts, 'from' | 'to' | 'cc' | 'headers' | 'labelIds' | 'receivedAt'>, facts: Facts, own: ReadonlySet<string>): Seen[] {
  const theirs = (a: Address) => !own.has(a.address);
  if (facts.origin === 'owner')
    return [...m.to, ...m.cc, ...parseAddressList(m.headers['bcc'])]
      .filter(theirs)
      .map((a) => ({ address: a.address, name: a.name ?? null, at: m.receivedAt, wrote: true }));
  if (m.labelIds.includes('SPAM') || sentInBulk(facts) || !theirs(m.from)) return [];
  return [{ address: m.from.address, name: m.from.name ?? null, at: m.receivedAt, wrote: false }];
}

/** Of two sightings of an address, the one whose name to keep: one with a name over one without, else the newer. */
const better = (a: Seen, b: Seen) => ((a.name !== null) !== (b.name !== null) ? (a.name !== null ? a : b) : a.at >= b.at ? a : b);

/** Add what messages showed to the address book. Safe to repeat: it keeps the newest of each time, and the best name. */
async function rememberAddresses(db: Sql, accountId: string, seen: readonly Seen[]): Promise<void> {
  const each = new Map<string, { kept: Seen; wroteAt: number | null; heardAt: number | null }>();
  for (const s of seen) {
    const last = each.get(s.address);
    const latest = (was: number | null, now: boolean) => (now ? Math.max(was ?? 0, s.at) : was);
    each.set(s.address, {
      kept: last ? better(last.kept, s) : s,
      wroteAt: latest(last?.wroteAt ?? null, s.wrote),
      heardAt: latest(last?.heardAt ?? null, !s.wrote),
    });
  }
  if (each.size === 0) return;
  const rows = [...each.values()].map(({ kept, wroteAt, heardAt }) => {
    const addressHash = hashOf(db, kept.address);
    return {
      accountId,
      addressHash,
      who: sealJson(db, addressName(db, accountId, addressHash), { address: kept.address, name: kept.name }),
      named: kept.name !== null,
      search: bloomOf(db, addressTerms(kept)),
      seenAt: kept.at,
      wroteAt,
      heardAt,
    };
  });
  // What was kept gives way to a name where it had none, or to a newer sighting as well named.
  const replaces = sql`((excluded.named AND NOT ${addresses.named}) OR (excluded.named = ${addresses.named} AND excluded.seen_at >= ${addresses.seenAt}))`;
  await db
    .insert(addresses)
    .values(rows)
    .onConflictDoUpdate({
      target: [addresses.userId, addresses.accountId, addresses.addressHash],
      set: {
        who: sql`CASE WHEN ${replaces} THEN excluded.who ELSE ${addresses.who} END`,
        search: sql`CASE WHEN ${replaces} THEN excluded.search ELSE ${addresses.search} END`,
        named: sql`CASE WHEN ${replaces} THEN excluded.named ELSE ${addresses.named} END`,
        seenAt: sql`CASE WHEN ${replaces} THEN excluded.seen_at ELSE ${addresses.seenAt} END`,
        wroteAt: sql`GREATEST(${addresses.wroteAt}, excluded.wrote_at)`,
        heardAt: sql`GREATEST(${addresses.heardAt}, excluded.heard_at)`,
      },
    });
}

/** Add recorded messages to the address book, with the facts they were recorded with. */
export async function rememberMail(
  db: Sql,
  accountId: string,
  mail: readonly { message: Pick<MessageFacts, 'from' | 'to' | 'cc' | 'headers' | 'labelIds' | 'receivedAt'>; facts: Facts }[],
  aliases: readonly string[],
): Promise<void> {
  const own = new Set([accountId, ...aliases].map((a) => a.toLowerCase()));
  await rememberAddresses(
    db,
    accountId,
    mail.flatMap(({ message, facts }) => seenIn(message, facts, own)),
  );
}

/** A stored address, opened. */
export const openAddress = (db: Sql, accountId: string, hash: string, who: string) =>
  openJson<{ address: string; name: string | null }>(db, addressName(db, accountId, hash), who);

const FILL_BATCH = 500;

/** Whether mail recorded before the address book waits to be added to it. */
export async function addressesDue(db: Sql, accountId: string): Promise<boolean> {
  const [row] = await db.select({ from: mailboxes.addressesFrom }).from(mailboxes).where(eq(mailboxes.id, accountId));
  return row?.from != null;
}

/**
 * Add mail recorded before the address book to it, oldest first, up to `most` messages or until `over`, from where the
 * last pass got to. Safe to repeat. Returns how many it went through.
 */
export async function fillAddresses(db: Sql, accountId: string, most: number, over: () => boolean): Promise<number> {
  const [mailbox] = await db.select({ from: mailboxes.addressesFrom, aliases: mailboxes.aliases }).from(mailboxes).where(eq(mailboxes.id, accountId));
  let from = mailbox?.from ?? null;
  let done = 0;
  while (from !== null && done < most && !over()) {
    const at = from === '' ? null : Number(from.slice(0, from.indexOf(':')));
    const after = from.slice(from.indexOf(':') + 1);
    const rows = await db
      .select({ id: messages.id, receivedAt: messages.receivedAt, headers: messages.headers, labelIds: messages.labelIds, facts: messages.facts })
      .from(messages)
      .where(and(eq(messages.accountId, accountId), at === null ? undefined : sql`(${messages.receivedAt}, ${messages.id}) > (${at}, ${after})`))
      .orderBy(asc(messages.receivedAt), asc(messages.id))
      .limit(Math.min(FILL_BATCH, most - done));
    const mail = rows.flatMap((r) => {
      const headers = JSON.parse(plain(openPart(db, accountId, r.id, 'headers', r.headers))!) as Record<string, string>;
      const envelope = envelopeOf(headers);
      return envelope ? [{ message: { ...envelope, headers, labelIds: r.labelIds, receivedAt: r.receivedAt }, facts: r.facts }] : [];
    });
    const last = rows.at(-1);
    from = last && rows.length === Math.min(FILL_BATCH, most - done) ? `${last.receivedAt}:${last.id}` : null;
    await db.transaction(async (tx) => {
      await rememberMail(tx, accountId, mail, mailbox?.aliases ?? []);
      await tx.update(mailboxes).set({ addressesFrom: from }).where(eq(mailboxes.id, accountId));
    });
    done += rows.length;
  }
  return done;
}
