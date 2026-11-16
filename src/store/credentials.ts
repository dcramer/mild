import { type Keyring, openSecret, sealSecret, staleSecret } from '../secrets.ts';
import { personOf } from './accounts.ts';
import type { Sql } from './sql.ts';

export type CredentialKind = 'gmail' | 'model';

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
      const row = await db.get<{ value: string }>('SELECT value FROM credentials WHERE kind = ? AND key = ?', kind, key);
      return row ? openSecret(name(kind, key), row.value, keys) : null;
    },
    write: async (key, text) => {
      await db.run(
        `INSERT INTO credentials (kind, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (kind, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        kind,
        key,
        sealSecret(name(kind, key), text, keys),
        Date.now(),
      );
    },
    remove: async (key) => {
      await db.run('DELETE FROM credentials WHERE kind = ? AND key = ?', kind, key);
    },
    keys: async () => (await db.all<{ key: string }>('SELECT key FROM credentials WHERE kind = ? ORDER BY key', kind)).map((r) => r.key),
  };
}

/**
 * Bring every credential in `db` under the current key, as `rekeySecrets` does for files. Throws if one
 * does not open with the keys given; nothing is rewritten then. `write: false` only checks. Returns what
 * was brought under the key, by name.
 */
export async function rekeyCredentials(db: Sql, keys: Keyring, write = true): Promise<string[]> {
  const name = await nameFor(db);
  const rows = await db.all<{ kind: CredentialKind; key: string; value: string }>('SELECT kind, key, value FROM credentials');
  const opened = rows.map((row) => ({ ...row, text: openSecret(name(row.kind, row.key), row.value, keys) }));
  const stale = opened.filter((row) => staleSecret(row.value, keys));
  if (write)
    await db.transaction(async (tx) => {
      for (const row of stale)
        await tx.run('UPDATE credentials SET value = ? WHERE kind = ? AND key = ?', sealSecret(name(row.kind, row.key), row.text, keys), row.kind, row.key);
    });
  return stale.map((row) => `${row.kind === 'gmail' ? 'Gmail access for' : 'Model sign-in for'} ${row.key}`);
}
