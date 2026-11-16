import { describe, expect, it } from 'vitest';
import { toPostgres } from '../src/store/sql.ts';
import { freshStore } from './fixtures.ts';

describe('the database handle', () => {
  it('sends ? and :name as $n, leaving quoted text and casts alone', () => {
    expect(toPostgres(`SELECT * FROM t WHERE a = ? AND b = '?' AND c = ?::integer`).text).toBe(`SELECT * FROM t WHERE a = $1 AND b = '?' AND c = $2::integer`);
    expect(toPostgres(`SELECT coalesce((SELECT a FROM t WHERE b = ?1), (SELECT a FROM u WHERE b = ?1 AND c = ?2))`).text).toBe(
      `SELECT coalesce((SELECT a FROM t WHERE b = $1), (SELECT a FROM u WHERE b = $1 AND c = $2))`,
    );
    expect(toPostgres(`SELECT * FROM t WHERE a < :cutoff AND (b >= :cutoff OR c = ':cutoff') AND d = :other`)).toEqual({
      text: `SELECT * FROM t WHERE a < $1 AND (b >= $1 OR c = ':cutoff') AND d = $2`,
      names: ['cutoff', 'other'],
    });
  });

  it('keeps everything else out while a transaction is open, and takes back all of it on failure', async () => {
    const store = await freshStore();
    const { central } = store;
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const tx = central.transaction(async (t) => {
      await t.run('INSERT INTO users (owner, created_at) VALUES (0, 1)');
      await gate;
      throw new Error('changed my mind');
    });
    const outside = central.run('INSERT INTO users (owner, created_at) VALUES (0, 2)');
    release();
    await expect(tx).rejects.toThrow('changed my mind');
    await outside;
    expect(await central.all('SELECT created_at FROM users')).toEqual([{ created_at: 2 }]);
    await store.close();
  });

  it('refuses the outer handle inside a transaction instead of waiting on itself', async () => {
    const { central } = await freshStore();
    await expect(central.transaction(async () => await central.run('INSERT INTO users (owner, created_at) VALUES (0, 1)'))).rejects.toThrow(
      'transaction’s handle',
    );
    expect(await central.all('SELECT id FROM users')).toEqual([]);
  });

  it('runs a transaction opened inside one as part of it', async () => {
    const { central } = await freshStore();
    await central.transaction(async (t) => {
      await t.run('INSERT INTO users (owner, created_at) VALUES (0, 1)');
      await t.transaction(async (inner) => await inner.run('INSERT INTO users (owner, created_at) VALUES (0, 2)'));
    });
    expect(await central.all('SELECT created_at FROM users ORDER BY created_at')).toEqual([{ created_at: 1 }, { created_at: 2 }]);
  });
});
