/** What a waiting message is folded by: whose it is, the name it came under, and the label Sift gave it. */
interface Foldable {
  accountId: string;
  sender: string;
  senderName: string | null;
  labelId: string | null;
}

/**
 * For review's rows: each message, except that a sender's waiting mail Sift gave the same label, under the
 * same name, is one row standing at the first of it, so one answer covers it all. One address often writes
 * as several names, each a different kind of mail, so a name is a row of its own. Mail Sift could not place
 * is never folded: each needs its own answer.
 */
export function fold<T extends Foldable>(items: readonly T[]): { item: T; rest: T[] }[] {
  const rows: { item: T; rest: T[] }[] = [];
  const open = new Map<string, T[]>();
  for (const item of items) {
    const key = item.labelId === null ? null : JSON.stringify([item.accountId, item.sender, item.senderName, item.labelId]);
    const rest = key === null ? undefined : open.get(key);
    if (rest) {
      rest.push(item);
      continue;
    }
    const row = { item, rest: [] as T[] };
    if (key !== null) open.set(key, row.rest);
    rows.push(row);
  }
  return rows;
}
