import { beforeEach, describe, expect, it } from 'vitest';
import { suggestAddresses } from '../src/dashboard/queries/addresses.ts';
import { recordSync } from '../src/store/messages.ts';
import { addressesDue, fillAddresses } from '../src/store/addresses.ts';
import type { Sql } from '../src/store/sql.ts';
import { openUserDb, raw } from './fixtures.ts';
import { ACCOUNT, everything, facts } from './helpers.ts';

const ada = (name: string | undefined, at: number, id: string) =>
  facts({ messageId: id, from: { address: 'ada@example.com', domain: 'example.com', ...(name ? { name } : {}) }, receivedAt: at, headers: {} });

describe('the address book', () => {
  let db: Sql;
  const suggested = async (q: string) => (await suggestAddresses(db, await everything(db), q, 8)).map((a) => [a.address, a.name]);

  beforeEach(async () => {
    db = await openUserDb(ACCOUNT);
  });

  it('keeps the newest name seen with an address, and never gives a name up for none', async () => {
    await recordSync(db, ACCOUNT, [ada('Ada L', 1, 'm1')], '1', 0);
    await recordSync(db, ACCOUNT, [ada('Ada Lovelace', 3, 'm3')], '2', 0);
    await recordSync(db, ACCOUNT, [ada('Ada', 2, 'm2'), ada(undefined, 4, 'm4')], '3', 0);
    expect(await suggested('ada')).toEqual([['ada@example.com', 'Ada Lovelace']]);
  });

  it('adds the mail recorded before it, a batch at a time, from where the last pass got to', async () => {
    await recordSync(
      db,
      ACCOUNT,
      [
        facts({ messageId: 'm1', from: { address: 'ada@example.com', domain: 'example.com', name: 'Ada' }, receivedAt: 1, headers: {} }),
        facts({ messageId: 'm2', from: { address: 'bo@example.com', domain: 'example.com', name: 'Bo' }, receivedAt: 2, headers: {} }),
        facts({ messageId: 'm3', from: { address: 'cy@example.com', domain: 'example.com', name: 'Cy' }, receivedAt: 3, headers: {} }),
      ],
      '1',
      0,
    );
    // As a mailbox was before there was an address book.
    await raw(db).run('DELETE FROM addresses');
    await raw(db).run(`UPDATE mailboxes SET addresses_from = ''`);
    expect(await addressesDue(db, ACCOUNT)).toBe(true);

    expect(await fillAddresses(db, ACCOUNT, 2, () => false)).toBe(2);
    expect(await suggested('example')).toEqual([
      ['bo@example.com', 'Bo'],
      ['ada@example.com', 'Ada'],
    ]);
    expect(await addressesDue(db, ACCOUNT)).toBe(true);
    expect(await fillAddresses(db, ACCOUNT, 2, () => false)).toBe(1);
    expect(await addressesDue(db, ACCOUNT)).toBe(false);
    expect((await suggested('c'))[0]).toEqual(['cy@example.com', 'Cy']);
  });
});
