import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { sqlite } from '../src/store/sql.ts';

const open = async () => {
  const db = sqlite(new DatabaseSync(':memory:'));
  await db.exec('CREATE TABLE t (n INTEGER)');
  return db;
};
const values = async (db: Awaited<ReturnType<typeof open>>) => (await db.all<{ n: number }>('SELECT n FROM t ORDER BY rowid')).map((r) => r.n);

describe('the database handle', () => {
  it('keeps everything else out while a transaction is open, so nothing lands inside it', async () => {
    const db = await open();
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const tx = db.transaction(async (t) => {
      await t.run('INSERT INTO t VALUES (1)');
      await gate;
      throw new Error('changed my mind');
    });
    const outside = db.run('INSERT INTO t VALUES (2)');
    release();
    await expect(tx).rejects.toThrow('changed my mind');
    await outside;
    expect(await values(db)).toEqual([2]);
  });

  it('refuses the outer handle inside a transaction instead of waiting on itself', async () => {
    const db = await open();
    await expect(db.transaction(async () => await db.run('INSERT INTO t VALUES (1)'))).rejects.toThrow('transaction’s handle');
    expect(await values(db)).toEqual([]);
  });

  it('runs a transaction opened inside one as part of it', async () => {
    const db = await open();
    await db.transaction(async (t) => {
      await t.run('INSERT INTO t VALUES (1)');
      await t.transaction(async (inner) => await inner.run('INSERT INTO t VALUES (2)'));
    });
    expect(await values(db)).toEqual([1, 2]);
  });
});
