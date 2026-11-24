import { ADDRESS_PREFIX, openAddress } from '../../store/addresses.ts';
import { addresses, and, desc, sql } from '../../store/query.ts';
import { mayHold, wordsOf } from '../../store/search.ts';
import type { Sql } from '../../store/sql.ts';
import { plain, seal } from '../../plain.ts';
import { type Scope, within } from '../scope.ts';
import type { AddressSuggestion } from '../types.ts';

/** How many the filter lets through are opened and checked, best first: past the few shown, the rest are rarely better. */
const READ_AT_MOST = 200;

/** Whether every word typed starts a word of theirs. */
const startsEach = (typed: readonly string[], theirs: readonly string[]) => typed.every((t) => theirs.some((w) => w.startsWith(t)));

/**
 * Whom to suggest for what is typed in an address box: everyone in the person's address book, in the scope's mailboxes,
 * each word typed the start of a word of whose name or address, whom they have written to first and most recently, then
 * who has written to them. Found by each address's filter of the starts of its words (`addressTerms`), then checked.
 */
export async function suggestAddresses(db: Sql, scope: Scope, typed: string, most: number): Promise<AddressSuggestion[]> {
  const words = wordsOf(typed);
  if (words.length === 0 || scope.accounts.length === 0) return [];
  const terms = [...new Set(words.map((w) => `@${w.slice(0, ADDRESS_PREFIX)}`))];
  const rows = await db
    .select({ accountId: addresses.accountId, hash: addresses.addressHash, who: addresses.who })
    .from(addresses)
    .where(and(within(scope, addresses.accountId), mayHold(db, addresses.search, terms)))
    .orderBy(sql`${addresses.wroteAt} DESC NULLS LAST`, sql`${addresses.heardAt} DESC NULLS LAST`, desc(addresses.addressHash))
    .limit(READ_AT_MOST);
  const shown = new Set<string>();
  const found: AddressSuggestion[] = [];
  for (const row of rows) {
    if (found.length === most) break;
    if (shown.has(row.hash)) continue;
    const who = plain(openAddress(db, row.accountId, row.hash, row.who));
    if (!startsEach(words, wordsOf(`${who.name ?? ''} ${who.address}`))) continue;
    shown.add(row.hash);
    found.push({ address: seal(who.address), name: seal(who.name) });
  }
  return found;
}
