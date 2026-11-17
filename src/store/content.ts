import { currentPrefix, openSecret, openToRekey, sealSecret, staleSecret } from '../secrets.ts';
import type { Address } from '../triage/types.ts';
import { and, asc, eq, examples, gt, messages, notLike, or, suggestionBodies } from './query.ts';
import type { Sql } from './sql.ts';

/** What Sift holds of a message that came from the message: its body, and the headers its record keeps. */
type Part = 'text' | 'html' | 'subject' | 'name' | 'to' | 'cc' | 'headers';

/** Each is encrypted for its person, message and part, so one copied into another row does not open. */
const nameOf = (db: Sql, accountId: string, messageId: string, part: Part) => `person ${db.person} ${part} of ${accountId} ${messageId}`;

/**
 * Marks a part stored without a key. Content comes from whoever sent the mail, so a subject that only
 * looks like an encrypted value must not be taken for one.
 */
const PLAIN = 'sift-plain:';

/** A part as it is stored: encrypted with the install's key (marked plain without one), and null when there is none. */
export function sealPart(db: Sql, accountId: string, messageId: string, part: Part, value: string | null): string | null {
  if (value === null) return null;
  return db.keys.current ? sealSecret(nameOf(db, accountId, messageId, part), value, db.keys) : PLAIN + value;
}

/** A stored part, decrypted. Refuses a plain one once there is a key, as `openSecret` does: every one was encrypted at start. */
export function openPart(db: Sql, accountId: string, messageId: string, part: Part, stored: string | null): string | null {
  if (stored === null) return null;
  const name = nameOf(db, accountId, messageId, part);
  if (!stored.startsWith(PLAIN)) return openSecret(name, stored, db.keys);
  if (db.keys.current) throw new Error(`${name} is stored unencrypted though SIFT_KEY is set.`);
  return stored.slice(PLAIN.length);
}

/** The parts of a message's record that came from its headers. */
interface Envelope {
  subject: string;
  fromName: string | null;
  to: Address[];
  cc: Address[];
  headers: Record<string, string>;
}

const ENVELOPE = { subject: 'subject', fromName: 'name', to: 'to', cc: 'cc', headers: 'headers' } as const satisfies Record<keyof Envelope, Part>;
const JSON_PARTS = new Set<keyof Envelope>(['to', 'cc', 'headers']);

interface Stored {
  subject: string;
  fromName: string | null;
  to: string;
  cc: string;
  headers: string;
}

/** An envelope's columns as `messages` stores them. */
export function sealEnvelope(db: Sql, accountId: string, messageId: string, envelope: Envelope): Stored {
  const seal = (key: keyof Envelope, value: unknown) =>
    sealPart(db, accountId, messageId, ENVELOPE[key], JSON_PARTS.has(key) ? JSON.stringify(value) : (value as string | null));
  return {
    subject: seal('subject', envelope.subject)!,
    fromName: seal('fromName', envelope.fromName),
    to: seal('to', envelope.to)!,
    cc: seal('cc', envelope.cc)!,
    headers: seal('headers', envelope.headers)!,
  };
}

/** Null stays null, as a message missing from a left join reads. */
type Decoded<V, T> = V extends null ? null : T;
type Opened<R> = { [K in keyof R]: K extends keyof Envelope ? Decoded<R[K], Envelope[K]> : R[K] };

/** `row` with whichever envelope columns it read from `messages` decrypted; its other columns as they are. */
export function openEnvelope<R extends { [K in keyof Envelope]?: string | null }>(db: Sql, accountId: string, messageId: string, row: R): Opened<R> {
  const opened: Record<string, unknown> = { ...row };
  for (const key of Object.keys(ENVELOPE) as (keyof Envelope)[]) {
    if (!(key in row)) continue;
    const text = openPart(db, accountId, messageId, ENVELOPE[key], row[key] ?? null);
    opened[key] = text !== null && JSON_PARTS.has(key) ? JSON.parse(text) : text;
  }
  return opened as Opened<R>;
}

/** The envelope's columns, for a select that reads them all. */
export const ENVELOPE_COLUMNS = {
  subject: messages.subject,
  fromName: messages.fromName,
  to: messages.to,
  cc: messages.cc,
  headers: messages.headers,
};

const forRekey = (db: Sql, accountId: string, messageId: string, part: Part, stored: string | null) => {
  if (stored === null) return null;
  return stored.startsWith(PLAIN) ? stored.slice(PLAIN.length) : openToRekey(nameOf(db, accountId, messageId, part), stored, db.keys);
};

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
  if (prefix === null) return 0;
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

  // Every part of a record is written together, so its subject says whether the rest is under the current key.
  let after: { accountId: string; id: string } | null = null;
  for (;;) {
    const rows = await db
      .select({ accountId: messages.accountId, id: messages.id, ...ENVELOPE_COLUMNS })
      .from(messages)
      .where(
        and(
          notLike(messages.subject, `${prefix}%`),
          after ? or(gt(messages.accountId, after.accountId), and(eq(messages.accountId, after.accountId), gt(messages.id, after.id))) : undefined,
        ),
      )
      .orderBy(asc(messages.accountId), asc(messages.id))
      .limit(BATCH);
    if (rows.length === 0) break;
    const records = rows.map((r) => ({
      ...r,
      sealed: sealEnvelope(db, r.accountId, r.id, {
        subject: forRekey(db, r.accountId, r.id, 'subject', r.subject)!,
        fromName: forRekey(db, r.accountId, r.id, 'name', r.fromName),
        to: JSON.parse(forRekey(db, r.accountId, r.id, 'to', r.to)!),
        cc: JSON.parse(forRekey(db, r.accountId, r.id, 'cc', r.cc)!),
        headers: JSON.parse(forRekey(db, r.accountId, r.id, 'headers', r.headers)!),
      }),
    }));
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
  return touched.size;
}
