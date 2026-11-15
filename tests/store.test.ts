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
  it('migrates a fresh database and enforces constraints', () => {
    const db = openDb(':memory:');
    expect(schemaVersion(db)).toBe(files.length);
    db.prepare('INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?)').run('acct', 'me@example.org', 0);
    const insert = db.prepare(
      `INSERT INTO labels (account_id, id, name, description, disposition, gmail_label, position, updated_at) VALUES (?, ?, 'N', '', ?, 'sift/n', 0, 0)`,
    );
    insert.run('acct', 'n', 'archive');
    expect(() => insert.run('acct', 'x', 'delete')).toThrow();
    expect(() => insert.run('missing', 'y', 'keep')).toThrow();
    db.close();
  });

  it('turns the categories, rules and senders of an older database into labels and rules', () => {
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

    const db = openDb(path);
    expect(listLabels(db, 'a@example.org')).toMatchObject([
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
    expect(db.prepare(`SELECT count(*) AS n FROM labels WHERE account_id = 'b@example.org'`).get()).toEqual({ n: 10 });

    const rules = listRules(db, 'a@example.org').map(({ id: _id, hits: _hits, subscription: _subscription, ...rule }) => rule);
    expect(rules).toEqual([
      { match: { fromDomain: 'example.com' }, labelId: 'newsletter', source: 'user' },
      // No label was named, so the one that does the same thing.
      { match: { from: 'boss@example.net' }, labelId: 'personal', source: 'user' },
      { match: { from: 'auctions@example.com' }, labelId: 'personal', source: 'correction' },
      // The sender was a newsletter the user wanted kept: the label stays, with the exception.
      { match: { from: 'digest@example.com' }, labelId: 'newsletter', disposition: 'keep', source: 'user' },
      { match: { from: 'promo@example.com' }, labelId: 'newsletter', learned: true, source: 'agent' },
    ]);
    expect(listRules(db, 'a@example.org')[0]).toMatchObject({ id: 'r-news', hits: 4 });
    // A spam rule that named no label is Junk, and keeps its own action from before Junk marked spam.
    expect(listRules(db, 'b@example.org')).toMatchObject([{ id: 'r-spam', labelId: 'junk', disposition: 'spam' }]);
    expect(db.prepare('SELECT label_id, gmail_label FROM decisions').get()).toEqual({ label_id: 'newsletter', gmail_label: 'sift/newsletters' });
    expect(() => db.prepare('SELECT 1 FROM senders').get()).toThrow();
    db.close();
  });
});
