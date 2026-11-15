import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb, schemaVersion } from '../src/store/db.ts';

describe('store', () => {
  it('migrates a fresh database and enforces constraints', () => {
    const db = openDb(':memory:');
    expect(schemaVersion(db)).toBe(readdirSync(new URL('../src/store/migrations/', import.meta.url)).length);
    db.prepare('INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?)').run('acct', 'me@example.org', 0);
    const insertSender = db.prepare('INSERT INTO senders (account_id, address, disposition, source, updated_at) VALUES (?, ?, ?, ?, ?)');
    insertSender.run('acct', 'news@example.com', 'archive', 'user', 0);
    expect(() => insertSender.run('acct', 'x@example.com', 'delete', 'user', 0)).toThrow();
    expect(() => insertSender.run('missing', 'y@example.com', 'keep', 'user', 0)).toThrow();
    db.close();
  });
});
