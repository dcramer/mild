import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrate, openUserDb } from '../src/store/db.ts';
import { listLabels } from '../src/store/labels.ts';
import { listRules } from '../src/store/rules.ts';
import { openSingle } from '../src/store/split.ts';
import { sqlite } from '../src/store/sql.ts';
import { openStore } from '../src/store/store.ts';

const LEGACY = new URL('../src/store/migrations/legacy/', import.meta.url);
const files = readdirSync(LEGACY).toSorted();
const scratch = () => mkdtempSync(join(tmpdir(), 'sift-db-'));

describe('migrations', () => {
  it("migrates a fresh person's database and enforces constraints", async () => {
    const db = await openUserDb(':memory:');
    await db.run('INSERT INTO mailboxes (id, created_at) VALUES (?, ?)', 'acct', 0);
    const insert = (account: string, id: string, disposition: string) =>
      db.run(
        `INSERT INTO labels (account_id, id, name, description, disposition, gmail_label, position, updated_at) VALUES (?, ?, 'N', '', ?, 'sift/n', 0, 0)`,
        account,
        id,
        disposition,
      );
    await insert('acct', 'n', 'archive');
    await expect(insert('acct', 'x', 'delete')).rejects.toThrow();
    await expect(insert('missing', 'y', 'keep')).rejects.toThrow();
    db.close();
  });

  it('records each migration by name, and applies one that arrives with a lower number than those already applied', async () => {
    const db = sqlite(new DatabaseSync(':memory:'));
    const table = (name: string) => ({ name, sql: `CREATE TABLE t_${name.slice(0, 3)} (x)` });
    await migrate(db, [table('010_a.sql'), table('020_b.sql')]);
    await migrate(db, [table('010_a.sql'), table('015_late.sql'), table('020_b.sql')]);
    expect((await db.all<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')).map((row) => row.name)).toEqual([
      '010_a.sql',
      '015_late.sql',
      '020_b.sql',
    ]);
    expect(await db.get(`SELECT 1 AS yes FROM sqlite_master WHERE name = 't_015'`)).toEqual({ yes: 1 });
  });

  it('refuses a database a newer sift has migrated, and leaves it as it was', async () => {
    const path = join(scratch(), '1.db');
    (await openUserDb(path)).close();
    const newer = new DatabaseSync(path);
    newer.exec(`INSERT INTO schema_migrations (name, applied_at) VALUES ('999_from_the_future.sql', 1)`);
    newer.close();
    await expect(openUserDb(path)).rejects.toThrow(/last opened by a newer sift: it has had 999_from_the_future\.sql/);
  });
});

/** A home's single database from before there was one per person, migrated as far as `upTo`. */
function single(path: string, upTo = Infinity): DatabaseSync {
  const old = new DatabaseSync(path, { defensive: false });
  for (const file of files.filter((f) => Number.parseInt(f, 10) <= upTo)) old.exec(readFileSync(new URL(file, LEGACY), 'utf8'));
  if (upTo !== Infinity) old.exec(`PRAGMA user_version = ${upTo}`);
  else {
    old.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT');
    for (const file of files) old.prepare('INSERT INTO schema_migrations VALUES (?, 0)').run(file);
  }
  return old;
}

describe('a database from before there was one per person', () => {
  it('takes a database from before migrations were named to have had every file up to its version', async () => {
    const path = join(scratch(), 'sift.db');
    single(path, 41).close();

    const db = await openSingle(path);
    const applied = await db.all<{ name: string; applied_at: number }>('SELECT name, applied_at FROM schema_migrations ORDER BY name');
    expect(applied.map((row) => row.name)).toEqual(files);
    // The ones it already had are marked without a time; the rest ran now.
    expect(applied.filter((row) => row.applied_at === 0).map((row) => row.name)).toEqual(files.filter((f) => Number.parseInt(f, 10) <= 41));
    db.close();
  });

  it('turns a rule the model checked into one that waits for its label', async () => {
    const path = join(scratch(), 'sift.db');
    const old = single(path, 62);
    old.exec(`
      INSERT INTO accounts (id, email, created_at) VALUES ('a@example.org', 'a@example.org', 0);
      INSERT INTO labels (account_id, id, name, description, disposition, gmail_label, position, updated_at) VALUES
        ('a@example.org', 'newsletter', 'Newsletters', 'Lists.', 'archive', 'sift/newsletters', 0, 1),
        ('a@example.org', 'personal', 'Personal', 'People.', 'keep', 'sift/personal', 1, 1);
      INSERT INTO rules (id, account_id, position, match_json, label_id, disposition, source, hits, tier, condition, filter_id, created_at) VALUES
        ('r-usual', 'a@example.org', 1, '{"from":"news@example.com"}', 'newsletter', NULL, 'user', 3, 'usually', NULL, NULL, 1),
        ('r-always', 'a@example.org', 2, '{"from":"ada@example.org"}', 'personal', 'keep', 'user', 0, 'always', NULL, 'f1', 2),
        ('r-words', 'a@example.org', 3, '{"from":"bids@example.com"}', 'newsletter', NULL, 'user', 0, 'usually', 'a lot I did not bid on', NULL, 3);
    `);
    old.close();

    const db = await openSingle(path);
    expect((await listRules(db, 'a@example.org')).map(({ source: _source, subscription: _subscription, ...rule }) => rule)).toEqual([
      { id: 'r-usual', match: { from: 'news@example.com' }, whenLabel: 'newsletter', hits: 3 },
      { id: 'r-always', match: { from: 'ada@example.org' }, labelId: 'personal', disposition: 'keep', hits: 0 },
      // A condition in the user's words still needs its label to answer with.
      { id: 'r-words', match: { from: 'bids@example.com' }, labelId: 'newsletter', when: 'a lot I did not bid on', hits: 0 },
    ]);
    expect(await db.get(`SELECT filter_id FROM rules WHERE id = 'r-always'`)).toEqual({ filter_id: 'f1' });
    db.close();
  });

  it('turns the categories, rules and senders of an older database into labels and rules', async () => {
    const path = join(scratch(), 'sift.db');
    const old = single(path, 6);
    old.exec(`
      INSERT INTO accounts (id, email, created_at) VALUES ('a@example.org', 'a@example.org', 0), ('b@example.org', 'b@example.org', 0);
      INSERT INTO categories (account_id, key, name, description, disposition, label, position, updated_at) VALUES
        ('a@example.org', 'personal', 'Personal', 'People.', 'keep', NULL, 0, 5),
        ('a@example.org', 'newsletter', 'Newsletters', 'Lists.', 'archive', 'sift/newsletters', 1, 5),
        ('a@example.org', 'cold_outreach', 'Cold outreach', 'Pitches.', 'review', 'sift/cold-outreach', 2, 5),
        ('a@example.org', 'vip', 'VIP', 'Mine.', 'review', 'sift/vip', 3, 5);
      INSERT INTO rules (id, account_id, position, match_json, disposition, label, source, hits, created_at) VALUES
        ('r-news', 'a@example.org', 1, '{"fromDomain":"example.com"}', 'archive', 'sift/newsletters', 'user', 4, 1),
        ('r-keep', 'a@example.org', 2, '{"from":"boss@example.net"}', 'keep', NULL, 'user', 0, 2),
        ('r-spam', 'b@example.org', 1, '{"fromDomain":"example.net"}', 'spam', NULL, 'user', 0, 3);
      INSERT INTO senders (account_id, address, disposition, label, category, source, updated_at) VALUES
        ('a@example.org', 'auctions@example.com', 'keep', NULL, 'personal', 'correction', 10),
        ('a@example.org', 'digest@example.com', 'keep', 'sift/newsletters', 'newsletter', 'user', 11),
        ('a@example.org', 'promo@example.com', 'archive', NULL, NULL, 'agent', 12);
      INSERT INTO messages (account_id, id, thread_id, from_address, from_domain, received_at) VALUES ('a@example.org', 'm', 't', 'x@example.com', 'example.com', 0);
      INSERT INTO decisions (account_id, message_id, stage, disposition, subscription, label, reason, decided_at, category)
        VALUES ('a@example.org', 'm', 'agent', 'archive', 'preserve', 'sift/newsletters', 'r', 0, 'newsletter');
    `);
    old.close();

    const db = await openSingle(path);
    expect(await listLabels(db, 'a@example.org')).toMatchObject([
      { id: 'personal', disposition: 'keep', gmailLabel: 'sift/personal' },
      { id: 'newsletter', disposition: 'archive', gmailLabel: 'sift/newsletters' },
      // Was still at its old default, "leave it for me", which labels no longer do.
      { id: 'cold_outreach', disposition: 'archive', gmailLabel: 'sift/cold-outreach' },
      // The user's own label set to "leave it for me" is kept in the inbox.
      { id: 'vip', disposition: 'keep', gmailLabel: 'sift/vip' },
      { id: 'junk', disposition: 'spam', gmailLabel: 'sift/junk' },
      { id: 'phishing', disposition: 'spam', block: true, gmailLabel: 'sift/phishing' },
    ]);
    // An account that had never been given its categories gets the defaults.
    expect(await db.get(`SELECT count(*) AS n FROM labels WHERE account_id = 'b@example.org'`)).toEqual({ n: 10 });

    const rules = (await listRules(db, 'a@example.org')).map(({ id: _id, hits: _hits, subscription: _subscription, ...rule }) => rule);
    expect(rules).toEqual([
      { match: { fromDomain: 'example.com' }, labelId: 'newsletter', source: 'user' },
      // No label was named, so the one that does the same thing.
      { match: { from: 'boss@example.net' }, labelId: 'personal', source: 'user' },
      { match: { from: 'auctions@example.com' }, labelId: 'personal', source: 'correction' },
      // The sender was a newsletter the user wanted kept: the label stays, with the exception.
      { match: { from: 'digest@example.com' }, labelId: 'newsletter', disposition: 'keep', source: 'user' },
      { match: { from: 'promo@example.com' }, labelId: 'newsletter', learned: true, source: 'agent' },
    ]);
    expect((await listRules(db, 'a@example.org'))[0]).toMatchObject({ id: 'r-news', hits: 4 });
    // A spam rule that named no label is Junk, and keeps its own action from before Junk marked spam.
    expect(await listRules(db, 'b@example.org')).toMatchObject([{ id: 'r-spam', labelId: 'junk', disposition: 'spam' }]);
    expect(await db.get('SELECT label_id, gmail_label FROM decisions')).toEqual({ label_id: 'newsletter', gmail_label: 'sift/newsletters' });
    await expect(db.get('SELECT 1 FROM senders')).rejects.toThrow();
    db.close();
  });
});

describe('splitting a database from before there was one per person', () => {
  const ALPHA = 'alpha@example.org';
  const ALPHA_WORK = 'alpha@example.com';
  const BETA = 'beta@example.net';

  /** A home whose single database has two people's mail in it. */
  function home() {
    const dir = scratch();
    const paths = { dbPath: join(dir, 'sift.db'), usersDir: join(dir, 'users') };
    const old = single(paths.dbPath);
    old.exec(`
      INSERT INTO users (id, owner, created_at) VALUES (1, 1, 1), (2, 0, 2);
      INSERT INTO accounts (id, email, history_id, created_at, last_synced_at, filters_checked_at, user_id) VALUES
        ('${ALPHA}', '${ALPHA}', '11', 1, 100, 50, 1), ('${ALPHA_WORK}', '${ALPHA_WORK}', '12', 3, 101, NULL, 1), ('${BETA}', '${BETA}', '21', 2, 102, NULL, 2);
    `);
    for (const [account, id] of [
      [ALPHA, 'a1'],
      [ALPHA_WORK, 'a2'],
      [BETA, 'b1'],
    ] as const) {
      old.exec(`
        INSERT INTO messages (account_id, id, thread_id, from_address, from_domain, received_at, subject) VALUES ('${account}', '${id}', 't', 'news@example.com', 'example.com', 5, 'About ${id}');
        INSERT INTO decisions (account_id, message_id, stage, disposition, subscription, reason, decided_at, label_id) VALUES ('${account}', '${id}', 'agent', 'archive', 'preserve', 'r', 6, 'newsletter');
        INSERT INTO actions (account_id, message_id, type, payload_json, status, created_at, decision_id) VALUES ('${account}', '${id}', 'archive', '{}', 'done', 7, last_insert_rowid());
        INSERT INTO rules (id, account_id, position, match_json, disposition, source, created_at) VALUES ('r-${id}', '${account}', 1, '{"from":"news@example.com"}', 'archive', 'user', 8);
        INSERT INTO examples (account_id, message_id, disposition, suggested, suggested_by, marked_at, status, body_text) VALUES ('${account}', '${id}', 'archive', 'archive', 'agent', 9, 'captured', 'Body ${id}');
        INSERT INTO eval_runs (account_id, started_at, status, model, prompt_hash, guidelines_hash, labels_hash, labels_json, few_shot, total) VALUES ('${account}', 10, 'done', 'p/m', 'h', 'h', 'h', '[]', 0, 1);
        INSERT INTO eval_results (run_id, message_id, expected, duration_ms, shots, sender_shots) VALUES (last_insert_rowid(), '${id}', 'newsletter', 1, 0, 0);
      `);
    }
    old.close();
    return paths;
  }

  it('gives each person a database holding only their own mail, and keeps the old one beside them', async () => {
    const paths = home();
    const store = await openStore(paths);
    expect(await store.central.all('SELECT id, owner FROM users ORDER BY id')).toEqual([
      { id: 1, owner: 1 },
      { id: 2, owner: 0 },
    ]);
    expect(await store.central.all('SELECT id, user_id FROM accounts ORDER BY id')).toEqual([
      { id: ALPHA_WORK, user_id: 1 },
      { id: ALPHA, user_id: 1 },
      { id: BETA, user_id: 2 },
    ]);
    const alpha = await store.user(1);
    const beta = await store.user(2);
    expect(await alpha.all('SELECT id, history_id, last_synced_at, filters_checked_at FROM mailboxes ORDER BY id')).toEqual([
      { id: ALPHA_WORK, history_id: '12', last_synced_at: 101, filters_checked_at: null },
      { id: ALPHA, history_id: '11', last_synced_at: 100, filters_checked_at: 50 },
    ]);
    for (const [db, ids] of [
      [alpha, ['a1', 'a2']],
      [beta, ['b1']],
    ] as const) {
      for (const table of ['messages', 'decisions', 'actions', 'examples', 'eval_results'])
        expect((await db.all<{ id: string }>(`SELECT ${table === 'messages' ? 'id' : 'message_id'} AS id FROM ${table} ORDER BY 1`)).map((r) => r.id)).toEqual(
          ids,
        );
      expect((await db.all<{ id: string }>('SELECT id FROM rules ORDER BY id')).map((r) => r.id)).toEqual(ids.map((id) => `r-${id}`));
    }
    // An action still points at the decision it carried out, and a result at its run.
    expect(await beta.get(`SELECT d.message_id FROM actions a JOIN decisions d ON d.id = a.decision_id`)).toEqual({ message_id: 'b1' });
    expect(await beta.get(`SELECT r.account_id FROM eval_results e JOIN eval_runs r ON r.id = e.run_id`)).toEqual({ account_id: BETA });
    expect(await alpha.get(`SELECT body_text FROM examples WHERE message_id = 'a2'`)).toEqual({ body_text: 'Body a2' });
    await store.close();

    expect(existsSync(`${paths.dbPath}.before-split`)).toBe(true);
    expect(
      readdirSync(paths.usersDir)
        .filter((f) => f.endsWith('.db'))
        .toSorted(),
    ).toEqual(['1.db', '2.db']);
    // Opening again finds it split and changes nothing.
    const again = await openStore(paths);
    expect(await (await again.user(2)).get('SELECT count(*) AS n FROM messages')).toEqual({ n: 1 });
    await again.close();
  });

  it('carries every column the old tables had', async () => {
    const dir = scratch();
    single(join(dir, 'old.db')).close();
    const old = new DatabaseSync(join(dir, 'old.db'));
    const user = await openUserDb(join(dir, 'user.db'));
    const columns = async (table: string) => (await user.all<{ name: string }>('SELECT name FROM pragma_table_info(?)', table)).map((c) => c.name);
    const tables = old.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('accounts', 'users', 'schema_migrations')`).all() as {
      name: string;
    }[];
    for (const { name } of tables) {
      const had = (old.prepare('SELECT name FROM pragma_table_info(?)').all(name) as { name: string }[]).map((c) => c.name);
      expect(await columns(name)).toEqual(expect.arrayContaining(had));
    }
    old.close();
    user.close();
  });

  it("refuses a person's database that is someone else's, or holds a mailbox that is not theirs", async () => {
    const paths = home();
    const first = await openStore(paths);
    await first.user(1);
    await first.user(2);
    await first.close();
    // Swapped, as a restore to the wrong place would leave them.
    renameSync(join(paths.usersDir, '1.db'), join(paths.usersDir, 'swap.db'));
    renameSync(join(paths.usersDir, '2.db'), join(paths.usersDir, '1.db'));
    renameSync(join(paths.usersDir, 'swap.db'), join(paths.usersDir, '2.db'));
    const swapped = await openStore(paths);
    await expect(swapped.user(1)).rejects.toThrow("is person 2's database, not person 1's");
    await expect(swapped.user(2)).rejects.toThrow("is person 1's database, not person 2's");
    // Refused once, refused for as long as this store is open.
    await expect(swapped.user(1)).rejects.toThrow();
    await swapped.close();

    const again = home();
    const before = await openStore(again);
    await before.user(1);
    await before.close();
    const file = new DatabaseSync(join(again.usersDir, '1.db'));
    file.prepare('INSERT INTO mailboxes (id, created_at) VALUES (?, 0)').run(BETA);
    file.close();
    const stray = await openStore(again);
    await expect(stray.user(1)).rejects.toThrow(`holds ${BETA}, which person 1 does not have`);
    await stray.close();
  });

  it('finishes a split that stopped while moving the new databases into place', async () => {
    const paths = home();
    await (await openStore(paths)).close();
    // As if it had stopped after setting the old database aside and before moving the new ones in.
    const work = join(paths.dbPath, '..', 'split-in-progress');
    mkdirSync(work);
    renameSync(paths.usersDir, join(work, 'users'));
    renameSync(paths.dbPath, join(work, 'sift.db'));
    writeFileSync(join(work, 'marker'), '');
    const store = await openStore(paths);
    expect(await (await store.user(1)).get('SELECT count(*) AS n FROM messages')).toEqual({ n: 2 });
    expect(existsSync(work)).toBe(false);
    await store.close();
  });
});
