import { type Scope, scopeFor } from '../src/dashboard/scope.ts';
import type { Sql } from '../src/store/sql.ts';
import type { ExistingFilter, FilterProposal } from '../src/actions/filters.ts';
import type { Mailbox } from '../src/actions/mailbox.ts';
import { connectAccount, recordSync, listAccounts } from '../src/store/accounts.ts';
import type { Store } from '../src/store/store.ts';
import { freshStore } from './fixtures.ts';
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
export async function storeExample(
  db: Sql,
  accountId: string,
  example: { id: string; from: string; label: string; subject?: string; body?: string; markedAt?: number; name?: string },
): Promise<void> {
  const from = { address: example.from, domain: example.from.split('@')[1] ?? '', ...(example.name ? { name: example.name } : {}) };
  await recordSync(db, accountId, [facts({ accountId, messageId: example.id, from, subject: example.subject ?? `Subject ${example.id}` })], '2');
  await recordDecision(db, accountId, example.id, {
    disposition: 'review',
    subscription: 'preserve',
    stage: 'fallback',
    reason: 'no stage reached a decision',
  });
  await db.run(
    `INSERT INTO examples (account_id, message_id, disposition, label_id, suggested, suggested_by, marked_at, status, body_text, headers_json, captured_at)
     VALUES (?, ?, 'keep', ?, 'review', 'fallback', ?, 'captured', ?, '[]', ?)`,
    accountId,
    example.id,
    example.label,
    example.markedAt ?? 0,
    example.body ?? `Body of ${example.id}`,
    example.markedAt ?? 0,
  );
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

  /** Every label change, as Gmail's history would report it. A test's fake history can hand these out. */
  history: { messageId: string; added: string[]; removed: string[] }[] = [];

  /** A change made in Gmail by the user, not through sift. */
  byUser(id: string, change: { add?: string[]; remove?: string[] }) {
    const current = this.labels.get(id) ?? [];
    const add = (change.add ?? []).filter((l) => !current.includes(l));
    const remove = (change.remove ?? []).filter((l) => current.includes(l));
    this.labels.set(id, [...current.filter((l) => !remove.includes(l)), ...add]);
    if (add.length > 0) this.history.push({ messageId: id, added: add, removed: [] });
    if (remove.length > 0) this.history.push({ messageId: id, added: [], removed: remove });
  }

  async modifyLabels(id: string, change: { add: string[]; remove: string[] }) {
    this.modifyCalls++;
    if (this.failModify === 'before') throw new Error('network down');
    const current = this.labels.get(id) ?? [];
    if (change.add.length > 0) this.history.push({ messageId: id, added: change.add, removed: [] });
    if (change.remove.length > 0) this.history.push({ messageId: id, added: [], removed: change.remove });
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

  filters: ExistingFilter[] = [];
  failFilters = false;

  async createFilter(filter: FilterProposal) {
    if (this.failFilters) throw new Error('network down');
    const id = `f${this.filters.length + 1}-${Object.values(filter.criteria).join('')}`;
    this.filters.push({
      id,
      criteria: { ...filter.criteria },
      action: { addLabelIds: filter.action.addLabelIds ?? [], removeLabelIds: filter.action.removeLabelIds ?? [] },
    });
    return id;
  }

  async deleteFilter(id: string) {
    if (this.failFilters) throw new Error('network down');
    this.filters = this.filters.filter((f) => f.id !== id);
  }

  async listFilters() {
    if (this.failFilters) throw new Error('network down');
    return structuredClone(this.filters);
  }
}

/** A scope that sees every connected account, as the dashboard has when no sign-in is set up. */
export const everything = async (db: Sql): Promise<Scope> =>
  scopeFor(
    (await listAccounts(db)).map((a) => a.id),
    true,
  );

/** A store whose one person, the owner, has `accounts`; and that person's own database. */
export async function onePerson(...accounts: string[]): Promise<{ store: Store; db: Sql }> {
  const store = await freshStore();
  let user: number | undefined;
  for (const account of accounts) user = await connectAccount(store, account, '1', 0, user);
  return { store, db: await store.user(user ?? 1) };
}
