import { gmail, type gmail_v1 } from '@googleapis/gmail';
import type { OAuth2Client } from 'google-auth-library';
import { type MessageContent, readContent } from './body.ts';

/** Headers fetched for triage. Bodies are never requested here. */
export const METADATA_HEADERS = [
  'From',
  'To',
  'Cc',
  'Reply-To',
  'Subject',
  'List-Id',
  'List-Unsubscribe',
  'List-Unsubscribe-Post',
  'Precedence',
  'Auto-Submitted',
  'Authentication-Results',
  'In-Reply-To',
  'References',
  // Which service sent it (see `bulkService` in src/triage/facts.ts).
  'Return-Path',
  'X-Mailer',
  'Feedback-ID',
  'X-MC-User',
  'X-SG-EID',
  'X-Mailgun-Sid',
  'X-SES-Outgoing',
  'X-PM-Message-Id',
] as const;

export interface RawMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  /** Epoch milliseconds, from Gmail's `internalDate`. */
  internalDate: number;
  headers: { name: string; value: string }[];
}

/** One message that a history record says was added, with its labels at that time. */
interface HistoryAddition {
  id: string;
  labelIds: string[];
}

/** Labels put on or taken off one message, by anyone: the user, another client, or sift itself. */
export interface HistoryLabelChange {
  messageId: string;
  added: string[];
  removed: string[];
}

export interface HistoryPage {
  additions: HistoryAddition[];
  labelChanges?: HistoryLabelChange[];
  /** The mailbox's current history id; the next cursor once the last page is read. */
  historyId: string;
  nextPageToken?: string;
}

interface MessageIdPage {
  ids: string[];
  nextPageToken?: string;
}

/** Thrown when Gmail no longer holds history back to the stored cursor. */
export class HistoryExpiredError extends Error {
  constructor() {
    super('Gmail history cursor expired');
    this.name = 'HistoryExpiredError';
  }
}

/** The read-only slice of Gmail that sync needs. Narrow so tests can fake it. */
export interface GmailApi {
  getProfile(): Promise<{ emailAddress: string; historyId: string }>;
  /** Throws HistoryExpiredError when `startHistoryId` is too old. */
  listHistory(startHistoryId: string, pageToken?: string): Promise<HistoryPage>;
  searchInbox(query: string, pageToken?: string): Promise<MessageIdPage>;
  /** Null when the message no longer exists. Does not mark it read. */
  getMetadata(messageId: string): Promise<RawMessage | null>;
  /** The message's labels now, or null when it no longer exists. Does not mark it read. */
  getLabelIds(messageId: string): Promise<string[] | null>;
  /** Every label in the account with its name, to tell which label an id in history is. */
  listLabels(): Promise<{ id: string; name: string }[]>;
  /** The message's readable text, truncated; null when the message no longer exists. Does not mark it read. Never stored. */
  getBodyText(messageId: string): Promise<string | null>;
  /** The same text with the facts only the whole message shows (attachments, tracking); null when the message no longer exists. Does not mark it read. */
  getContent(messageId: string): Promise<MessageContent | null>;
  /** A thread's messages, oldest first, with their labels and nothing else. Null when the thread no longer exists. */
  getThread(threadId: string): Promise<{ id: string; labelIds: string[] }[] | null>;
  /** The whole message as received (RFC 822); null when it no longer exists. Does not mark it read. */
  getRaw(messageId: string): Promise<Buffer | null>;
}

export const isNotFound = (error: unknown) => {
  const e = error as { status?: unknown; code?: unknown };
  return e?.status === 404 || e?.code === 404 || e?.code === '404';
};

export function createGmailApi(auth: OAuth2Client): GmailApi {
  const client: gmail_v1.Gmail = gmail({ version: 'v1', auth });
  const userId = 'me';

  return {
    async getProfile() {
      const { data } = await client.users.getProfile({ userId });
      if (!data.emailAddress || !data.historyId) throw new Error('Gmail profile is missing emailAddress or historyId');
      return { emailAddress: data.emailAddress.toLowerCase(), historyId: data.historyId };
    },

    async listHistory(startHistoryId, pageToken) {
      try {
        const { data } = await client.users.history.list({
          userId,
          startHistoryId,
          // Not narrowed to the inbox: mail the user takes out of the inbox or out of spam must show up too.
          historyTypes: ['messageAdded', 'labelAdded', 'labelRemoved'],
          maxResults: 500,
          ...(pageToken ? { pageToken } : {}),
        });
        const additions: HistoryAddition[] = [];
        const labelChanges: HistoryLabelChange[] = [];
        for (const record of data.history ?? []) {
          for (const added of record.messagesAdded ?? []) {
            if (added.message?.id) additions.push({ id: added.message.id, labelIds: added.message.labelIds ?? [] });
          }
          for (const change of record.labelsAdded ?? []) {
            if (change.message?.id) labelChanges.push({ messageId: change.message.id, added: change.labelIds ?? [], removed: [] });
          }
          for (const change of record.labelsRemoved ?? []) {
            if (change.message?.id) labelChanges.push({ messageId: change.message.id, added: [], removed: change.labelIds ?? [] });
          }
        }
        return { additions, labelChanges, historyId: data.historyId ?? startHistoryId, ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}) };
      } catch (error) {
        if (isNotFound(error)) throw new HistoryExpiredError();
        throw error;
      }
    },

    async searchInbox(query, pageToken) {
      const { data } = await client.users.messages.list({ userId, q: query, labelIds: ['INBOX'], maxResults: 500, ...(pageToken ? { pageToken } : {}) });
      const ids = (data.messages ?? []).map((m) => m.id).filter((id) => typeof id === 'string');
      return { ids, ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}) };
    },

    async getLabelIds(messageId) {
      try {
        const { data } = await client.users.messages.get({ userId, id: messageId, format: 'minimal' });
        return data.labelIds ?? [];
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async listLabels() {
      const { data } = await client.users.labels.list({ userId });
      return (data.labels ?? []).flatMap((l) => (l.id && l.name ? [{ id: l.id, name: l.name }] : []));
    },

    async getBodyText(messageId) {
      return (await this.getContent(messageId))?.text ?? null;
    },

    async getContent(messageId) {
      try {
        const { data } = await client.users.messages.get({ userId, id: messageId, format: 'full' });
        return readContent(data.payload);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async getThread(threadId) {
      try {
        const { data } = await client.users.threads.get({ userId, id: threadId, format: 'minimal' });
        return (data.messages ?? [])
          .filter((m) => typeof m.id === 'string')
          .toSorted((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0))
          .map((m) => ({ id: m.id as string, labelIds: m.labelIds ?? [] }));
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async getRaw(messageId) {
      try {
        const { data } = await client.users.messages.get({ userId, id: messageId, format: 'raw' });
        return data.raw ? Buffer.from(data.raw, 'base64url') : null;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async getMetadata(messageId) {
      try {
        const { data } = await client.users.messages.get({ userId, id: messageId, format: 'metadata', metadataHeaders: [...METADATA_HEADERS] });
        if (!data.id || !data.threadId) return null;
        const headers: RawMessage['headers'] = [];
        for (const h of data.payload?.headers ?? []) if (h.name && typeof h.value === 'string') headers.push({ name: h.name, value: h.value });
        return { id: data.id, threadId: data.threadId, labelIds: data.labelIds ?? [], internalDate: Number(data.internalDate ?? 0), headers };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
  };
}
