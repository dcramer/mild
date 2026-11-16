import type { ExistingFilter, FilterProposal } from '../src/actions/filters.ts';
import type { Mailbox } from '../src/actions/mailbox.ts';
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
