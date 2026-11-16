import { type Keyring, openSecret, openToRekey, sealSecret, staleSecret } from '../secrets.ts';
import { personOf } from './accounts.ts';
import { type CREDENTIAL_KINDS, and, asc, credentials as credentialRows, eq, sql } from './query.ts';
import type { Sql } from './sql.ts';

type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/** One kind of sign-in in a person's database, decrypted on the way out and encrypted on the way in. */
export interface Credentials {
  read(key: string): Promise<string | null>;
  write(key: string, text: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/**
 * Each value is encrypted for its person, kind and key, so one copied into another row, or into
 * another person's database, does not open.
 */
async function nameFor(db: Sql): Promise<(kind: CredentialKind, key: string) => string> {
  const person = await personOf(db);
  return (kind, key) => `person ${person} ${kind} ${key}`;
}

export async function credentials(db: Sql, kind: CredentialKind, keys: Keyring): Promise<Credentials> {
  const name = await nameFor(db);
  return {
    read: async (key) => {
      const [row] = await db
        .select({ value: credentialRows.value })
        .from(credentialRows)
        .where(and(eq(credentialRows.kind, kind), eq(credentialRows.key, key)));
      return row ? openSecret(name(kind, key), row.value, keys) : null;
    },
    write: async (key, text) => {
      await db
        .insert(credentialRows)
        .values({ kind, key, value: sealSecret(name(kind, key), text, keys), updatedAt: Date.now() })
        .onConflictDoUpdate({
          target: [credentialRows.userId, credentialRows.kind, credentialRows.key],
          set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at` },
        });
    },
    remove: async (key) => {
      await db.delete(credentialRows).where(and(eq(credentialRows.kind, kind), eq(credentialRows.key, key)));
    },
    keys: async () =>
      (await db.select({ key: credentialRows.key }).from(credentialRows).where(eq(credentialRows.kind, kind)).orderBy(asc(credentialRows.key))).map(
        (r) => r.key,
      ),
  };
}

/**
 * Bring every credential in `db` under the current key, as `rekeySecrets` does for files. Throws if one
 * does not open with the keys given; nothing is rewritten then. `write: false` only checks. Returns what
 * was brought under the key, by name.
 */
export async function rekeyCredentials(db: Sql, keys: Keyring, write = true): Promise<string[]> {
  const name = await nameFor(db);
  const rows = await db.select({ kind: credentialRows.kind, key: credentialRows.key, value: credentialRows.value }).from(credentialRows);
  const opened = rows.map((row) => ({ ...row, text: openToRekey(name(row.kind, row.key), row.value, keys) }));
  const stale = opened.filter((row) => staleSecret(row.value, keys));
  if (write)
    await db.transaction(async (tx) => {
      for (const row of stale)
        await tx
          .update(credentialRows)
          .set({ value: sealSecret(name(row.kind, row.key), row.text, keys) })
          .where(and(eq(credentialRows.kind, row.kind), eq(credentialRows.key, row.key)));
    });
  return stale.map((row) => `${row.kind === 'gmail' ? 'Gmail access for' : 'Model sign-in for'} ${row.key}`);
}
