import { openToRekey, sealSecret, staleSecret } from '../secrets.ts';
import { and, eq, examples, suggestionBodies } from './query.ts';
import type { Sql } from './sql.ts';

type Part = 'text' | 'html';

/** Each is encrypted for its person, message and part, so one copied into another row does not open. */
const nameOf = (db: Sql, accountId: string, messageId: string, part: Part) => `person ${db.person} ${part} of ${accountId} ${messageId}`;

/** A message's text or HTML as it is stored: encrypted with the install's key (plain without one), and null when there is none. */
export function sealBody(db: Sql, accountId: string, messageId: string, part: Part, value: string | null): string | null {
  return value === null ? null : sealSecret(nameOf(db, accountId, messageId, part), value, db.keys);
}

/**
 * A stored text or HTML, decrypted. One stored plain before there was a key is returned as it is until
 * `rekeyBodies` seals it: unlike a sign-in, a planted one gains nobody anything.
 */
export function openBody(db: Sql, accountId: string, messageId: string, part: Part, stored: string | null): string | null {
  return stored === null ? null : openToRekey(nameOf(db, accountId, messageId, part), stored, db.keys);
}

/**
 * Bring every message body in `db` under the current key, as `rekeyCredentials` does for sign-ins. Throws
 * if one does not open with the handle's keys; nothing is rewritten then. Returns how many were stale.
 */
export async function rekeyBodies(db: Sql, write = true): Promise<number> {
  const tables = [
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
  const stale = (value: string | null) => value !== null && staleSecret(value, db.keys);
  const reseal = tables.flatMap(({ table, rows }) =>
    rows
      .filter((r) => stale(r.text) || stale(r.html))
      .map((r) => ({
        table,
        row: r,
        text: sealBody(db, r.accountId, r.messageId, 'text', openBody(db, r.accountId, r.messageId, 'text', r.text)),
        html: sealBody(db, r.accountId, r.messageId, 'html', openBody(db, r.accountId, r.messageId, 'html', r.html)),
      })),
  );
  if (write)
    await db.transaction(async (tx) => {
      for (const { table, row, text, html } of reseal)
        await tx
          .update(table)
          .set({ bodyText: text, bodyHtml: html })
          .where(and(eq(table.accountId, row.accountId), eq(table.messageId, row.messageId)));
    });
  return reseal.length;
}
