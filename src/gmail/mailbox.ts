import { gmail } from '@googleapis/gmail';
import type { OAuth2Client } from 'google-auth-library';
import { validateFilter } from '../actions/filters.ts';
import type { Mailbox } from '../actions/mailbox.ts';
import { isNotFound } from './api.ts';
import { pace } from './quota.ts';

/** Gmail implementation of the Mailbox port. Deliberately has no send, forward, trash or delete. Calls are paced as `createGmailApi`'s are. */
export function createGmailMailbox(auth: OAuth2Client, account: string): Mailbox {
  const client = gmail({ version: 'v1', auth });
  const userId = 'me';
  let labelIdsByName: Map<string, string> | null = null;

  return {
    async getLabelIds(messageId) {
      await pace(account, 20);
      try {
        // `minimal` returns labels without headers or body and does not mark the message read.
        const { data } = await client.users.messages.get({ userId, id: messageId, format: 'minimal' });
        return data.labelIds ?? [];
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async modifyLabels(messageId, change) {
      await pace(account, 5);
      await client.users.messages.modify({ userId, id: messageId, requestBody: { addLabelIds: change.add, removeLabelIds: change.remove } });
    },

    async ensureLabel(name) {
      if (!labelIdsByName) {
        await pace(account, 1);
        const { data } = await client.users.labels.list({ userId });
        labelIdsByName = new Map();
        for (const label of data.labels ?? []) if (label.name && label.id) labelIdsByName.set(label.name, label.id);
      }
      const existing = labelIdsByName.get(name);
      if (existing) return existing;
      await pace(account, 5);
      const { data } = await client.users.labels.create({ userId, requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' } });
      if (!data.id) throw new Error(`Gmail did not return an id for label ${name}`);
      labelIdsByName.set(name, data.id);
      return data.id;
    },

    async hasSentTo(address) {
      // The address goes into a search query, so refuse anything that could change the query's meaning.
      if (!/^[^\s"'(){}<>:,]+@[^\s"'(){}<>:,]+$/.test(address)) throw new Error('address cannot be searched safely');
      await pace(account, 5);
      const { data } = await client.users.messages.list({ userId, q: `in:sent to:${address}`, maxResults: 1 });
      return (data.messages ?? []).length > 0;
    },

    async createFilter(filter) {
      // Checked here as well as by callers: nothing reaches Gmail's filter API unvalidated.
      const problems = validateFilter(filter);
      if (problems.length > 0) throw new Error(`Refusing to create filter: ${problems.join('; ')}`);
      await pace(account, 5);
      const { data } = await client.users.settings.filters.create({ userId, requestBody: { criteria: filter.criteria, action: filter.action } });
      if (!data.id) throw new Error('Gmail did not return a filter id');
      return data.id;
    },

    async deleteFilter(filterId) {
      await pace(account, 5);
      try {
        await client.users.settings.filters.delete({ userId, id: filterId });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },

    async listFilters() {
      await pace(account, 1);
      const { data } = await client.users.settings.filters.list({ userId });
      return (data.filter ?? []).flatMap((f) => {
        if (!f.id) return [];
        const criteria: Record<string, string | number | boolean> = {};
        for (const [key, value] of Object.entries(f.criteria ?? {})) {
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') criteria[key] = value;
        }
        return [
          {
            id: f.id,
            criteria,
            action: {
              addLabelIds: f.action?.addLabelIds ?? [],
              removeLabelIds: f.action?.removeLabelIds ?? [],
              ...(f.action?.forward ? { forward: f.action.forward } : {}),
            },
          },
        ];
      });
    },
  };
}
