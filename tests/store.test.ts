import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openDb, schemaVersion } from '../src/store/db.ts';
import { listLabels } from '../src/store/labels.ts';
import { listRules } from '../src/store/rules.ts';

const MIGRATIONS = new URL('../src/store/migrations/', import.meta.url);
const files = readdirSync(MIGRATIONS).toSorted();

describe('store', () => {
  it('migrates a fresh database and enforces constraints', async () => {
    const db = await openDb(':memory:');
    // Numbers may skip, so the version is the highest one, not how many there are.
    expect(await schemaVersion(db)).toBe(Number.parseInt(files.at(-1)!, 10));
    expect(await db.get(`SELECT count(*) AS n FROM sqlite_master WHERE name = 'questions'`)).toEqual({ n: 0 });
    await db.run('INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?)', 'acct', 'me@example.org', 0);
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
    const db = await openDb(':memory:');
    expect((await db.all<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')).map((row) => row.name)).toEqual(files);

    // A database that was migrated while a lower-numbered file did not exist yet: it must still get that file.
    const late = files.find((f) => f.startsWith('050_'));
    const path = join(mkdtempSync(join(tmpdir(), 'sift-db-')), 'sift.db');
    (await openDb(path)).close();
    const behind = new DatabaseSync(path);
    behind.exec('DROP TABLE eval_results; DROP TABLE eval_runs;');
    behind.prepare('DELETE FROM schema_migrations WHERE name = ?').run(late!);
    behind.close();
    const caught = await openDb(path);
    expect(await caught.get(`SELECT count(*) AS n FROM sqlite_master WHERE name IN ('eval_runs', 'eval_results')`)).toEqual({ n: 2 });
    expect(await schemaVersion(caught)).toBe(Number.parseInt(files.at(-1)!, 10));
    caught.close();
  });

  it('takes a database from before migrations were named to have had every file up to its version', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'sift-db-')), 'sift.db');
    const old = new DatabaseSync(path);
    for (const file of files.filter((f) => Number.parseInt(f, 10) <= 41)) old.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
    old.exec('PRAGMA user_version = 41');
    old.close();

    const db = await openDb(path);
    const applied = await db.all<{ name: string; applied_at: number }>('SELECT name, applied_at FROM schema_migrations ORDER BY name');
    expect(applied.map((row) => row.name)).toEqual(files);
    // The ones it already had are marked without a time; the rest ran now.
    expect(applied.filter((row) => row.applied_at === 0).map((row) => row.name)).toEqual(files.filter((f) => Number.parseInt(f, 10) <= 41));
    db.close();
  });

  it('refuses a database a newer sift has migrated, and leaves it as it was', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'sift-db-')), 'sift.db');
    (await openDb(path)).close();
    const newer = new DatabaseSync(path);
    newer.exec(`INSERT INTO schema_migrations (name, applied_at) VALUES ('999_from_the_future.sql', 1)`);
    newer.close();
    await expect(openDb(path)).rejects.toThrow(/last opened by a newer sift: it has had 999_from_the_future\.sql/);
  });

  it('turns a rule the model checked into one that waits for its label', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'sift-db-')), 'sift.db');
    const old = new DatabaseSync(path);
    for (const file of files.filter((f) => Number.parseInt(f, 10) <= 62)) old.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
    old.exec('PRAGMA user_version = 62');
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

    const db = await openDb(path);
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
    const path = join(mkdtempSync(join(tmpdir(), 'sift-db-')), 'sift.db');
    const old = new DatabaseSync(path);
    for (const file of files.filter((f) => Number.parseInt(f, 10) <= 6)) old.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
    old.exec('PRAGMA user_version = 6');
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

    const db = await openDb(path);
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
