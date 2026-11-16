import { parseAddress, parseAddressList } from '../triage/features.ts';
import type { MessageFacts } from '../triage/types.ts';
import { type GmailApi, HistoryExpiredError, type HistoryLabelChange, type RawMessage } from './api.ts';

export interface PullResult {
  /** Ids of messages that arrived in the inbox since the cursor, oldest first, deduplicated. */
  messageIds: string[];
  /**
   * Label changes to any message since the cursor, sift's own among them. Empty after `recovery`: what
   * changed while the cursor was expired cannot be read back.
   */
  labelChanges: HistoryLabelChange[];
  /** Store this as the new cursor, in the same transaction that records the messages. */
  historyId: string;
  /** How the ids were found. `recovery` means the cursor had expired and a bounded search was used instead. */
  mode: 'start' | 'incremental' | 'recovery';
}

/** How far back to search when the cursor has expired. Gmail keeps history for about a week. */
const RECOVERY_DAYS = 7;

/**
 * Find messages added to the inbox since `cursor`.
 *
 * With no cursor this only records the current position: sift handles mail that arrives after it
 * is connected and never sweeps the existing inbox on its own.
 */
export async function pullChanges(api: GmailApi, cursor: string | null): Promise<PullResult> {
  if (cursor === null) {
    const profile = await api.getProfile();
    return { messageIds: [], labelChanges: [], historyId: profile.historyId, mode: 'start' };
  }

  try {
    const ids = new Set<string>();
    const labelChanges: HistoryLabelChange[] = [];
    let historyId = cursor;
    let pageToken: string | undefined;
    do {
      const page = await api.listHistory(cursor, pageToken);
      // A message can be added outside the inbox (sent, filtered) and still appear; keep only inbox arrivals.
      for (const added of page.additions) if (added.labelIds.includes('INBOX')) ids.add(added.id);
      labelChanges.push(...(page.labelChanges ?? []));
      historyId = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken);
    return { messageIds: [...ids], labelChanges, historyId, mode: 'incremental' };
  } catch (error) {
    if (!(error instanceof HistoryExpiredError)) throw error;
  }

  // Read the new cursor before searching, so anything arriving during the search is seen again next time.
  const profile = await api.getProfile();
  const ids = new Set<string>();
  let pageToken: string | undefined;
  do {
    const page = await api.searchInbox(`newer_than:${RECOVERY_DAYS}d`, pageToken);
    for (const id of page.ids) ids.add(id);
    pageToken = page.nextPageToken;
  } while (pageToken);
  // Search returns newest first.
  return { messageIds: [...ids].toReversed(), labelChanges: [], historyId: profile.historyId, mode: 'recovery' };
}

/** Convert Gmail metadata to triage input. Null when there is no usable From address. */
export function toFacts(accountId: string, raw: RawMessage): MessageFacts | null {
  const headers: Record<string, string> = {};
  // Keep the first occurrence: for repeated trace headers such as Authentication-Results, the topmost is the receiver's own.
  for (const { name, value } of raw.headers) headers[name.toLowerCase()] ??= value;

  const from = parseAddress(headers['from'] ?? '');
  if (!from) return null;

  return {
    accountId,
    messageId: raw.id,
    threadId: raw.threadId,
    from,
    to: parseAddressList(headers['to']),
    cc: parseAddressList(headers['cc']),
    subject: headers['subject'] ?? '',
    labelIds: raw.labelIds,
    headers,
    receivedAt: raw.internalDate,
  };
}
