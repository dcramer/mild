import type { DatabaseSync } from 'node:sqlite';
import type { Mailbox } from '../src/actions/mailbox.ts';
import { recordSync } from '../src/store/accounts.ts';
import { recordDecision } from '../src/store/decisions.ts';
import type { MessageFacts } from '../src/triage/types.ts';

/** A synthetic message. Tests never use real mail. */
export function facts(overrides: Partial<MessageFacts> = {}): MessageFacts {
  return {
    accountId: 'acct',
    messageId: 'm1',
    threadId: 't1',
    from: { address: 'news@example.com', domain: 'example.com' },
    to: [{ address: 'me@example.org', domain: 'example.org' }],
    cc: [],
    subject: 'Weekly digest',
    labelIds: ['INBOX', 'UNREAD'],
    headers: {},
    receivedAt: 0,
    ...overrides,
  };
}

/** A message the user answered for, stored whole as `captureExamples` would leave it. */
export function storeExample(
  db: DatabaseSync,
  accountId: string,
  example: { id: string; from: string; label: string; subject?: string; body?: string; markedAt?: number; name?: string },
): void {
  const from = { address: example.from, domain: example.from.split('@')[1] ?? '', ...(example.name ? { name: example.name } : {}) };
  recordSync(db, accountId, [facts({ accountId, messageId: example.id, from, subject: example.subject ?? `Subject ${example.id}` })], '2');
  recordDecision(db, accountId, example.id, { disposition: 'review', subscription: 'preserve', stage: 'fallback', reason: 'no stage reached a decision' });
  db.prepare(
    `INSERT INTO examples (account_id, message_id, disposition, label_id, suggested, suggested_by, marked_at, status, body_text, headers_json, captured_at)
     VALUES (?, ?, 'keep', ?, 'review', 'fallback', ?, 'captured', ?, '[]', ?)`,
  ).run(accountId, example.id, example.label, example.markedAt ?? 0, example.body ?? `Body of ${example.id}`, example.markedAt ?? 0);
}

/** An in-memory mailbox. Label ids are `L:<name>`. */
export class FakeMailbox implements Mailbox {
  labels = new Map<string, string[]>();
  sentTo = new Set<string>();
  modifyCalls = 0;
  /** `before`: fail without changing anything. `after`: change, then fail (a lost response). */
  failModify: 'before' | 'after' | null = null;
  failSentLookup = false;
  /** Makes every label read fail, as a network outage would. */
  failReads = false;

  async getLabelIds(id: string) {
    if (this.failReads) throw new Error('network down');
    const labels = this.labels.get(id);
    return labels ? [...labels] : null;
  }

  async modifyLabels(id: string, change: { add: string[]; remove: string[] }) {
    this.modifyCalls++;
    if (this.failModify === 'before') throw new Error('network down');
    const current = this.labels.get(id) ?? [];
    this.labels.set(id, [...current.filter((l) => !change.remove.includes(l)), ...change.add.filter((l) => !current.includes(l))]);
    if (this.failModify === 'after') throw new Error('timeout');
  }

  async ensureLabel(name: string) {
    return `L:${name}`;
  }

  async hasSentTo(address: string) {
    if (this.failSentLookup) throw new Error('search failed');
    return this.sentTo.has(address);
  }

  async createFilter(): Promise<string> {
    throw new Error('not used');
  }

  async deleteFilter(): Promise<void> {
    throw new Error('not used');
  }
}
