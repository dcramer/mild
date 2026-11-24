import { searchHash } from '../secrets.ts';
import { type AnyColumn, type SQL, and, sql } from './query.ts';
import type { Sql } from './sql.ts';

/**
 * What Inbox's search reads in mail, and how it matches: whole words, the last also as the start of one, case and accents
 * aside. The index, below, is built from the same words, so it finds what this would match and more,
 * never less.
 */

/** Longer runs are kept to their start: a word that long is a link's or a code's, and matched by its start. */
const MAX_WORD = 40;
/**
 * Starts shorter than this are not indexed: one would let through most of the mail. Such a last word is checked in the
 * text of what the words before it let through, and typed alone is matched whole.
 */
const MIN_PREFIX = 3;
/** The index holds the starts of each word up to this long; a longer start typed is looked up by its first letters, and the text checked. */
const MAX_PREFIX = 6;

/** The words of `text`: runs of letters and digits, lowercased, with accents taken off ("Café" is "cafe"). */
export function wordsOf(text: string): string[] {
  return (
    text
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).map((word) => word.slice(0, MAX_WORD));
}

/** What the index holds for these words: each whole, and each start of each from `MIN_PREFIX` letters to `MAX_PREFIX`. */
export function indexTerms(words: Iterable<string>): Set<string> {
  const terms = new Set<string>();
  for (const word of words) {
    terms.add(`=${word}`);
    for (let length = MIN_PREFIX; length <= Math.min(word.length, MAX_PREFIX); length++) terms.add(`^${word.slice(0, length)}`);
  }
  return terms;
}

/** A search as typed: words every match has whole, and the last, which may be the start of one. */
export interface Search {
  whole: string[];
  /** Null when the last word is a short one typed alone, so it is among `whole`. */
  start: string | null;
}

/** Null when nothing typed is a word. */
export function searchOf(typed: string): Search | null {
  const words = wordsOf(typed);
  const last = words.at(-1);
  if (last === undefined) return null;
  return last.length >= MIN_PREFIX || words.length > 1 ? { whole: words.slice(0, -1), start: last } : { whole: words, start: null };
}

/** The terms a message's index must hold for it to match `search`. */
const searchTerms = (search: Search): string[] => [
  ...new Set([
    ...search.whole.map((w) => `=${w}`),
    ...(search.start !== null && search.start.length >= MIN_PREFIX ? [`^${search.start.slice(0, MAX_PREFIX)}`] : []),
  ]),
];

/** Whether a message with these words matches. */
export function matches(words: ReadonlySet<string>, search: Search): boolean {
  if (!search.whole.every((w) => words.has(w))) return false;
  const { start } = search;
  if (start === null || words.has(start)) return true;
  for (const word of words) if (word.startsWith(start)) return true;
  return false;
}

/**
 * A message's search index is a Bloom filter: each term (`indexTerms`) sets the bits its keyed hash names, so the database
 * can tell a message that may have a word from one that has not, and learns no word. Its size is the power of two that
 * gives each term about `BITS_PER_TERM` bits, so one in a few hundred to one in tens of thousands of messages a term
 * would not find passes for it, and the text is read to drop those (docs/security.md, docs/inbox.md).
 */
const HASHES = 7;
const BITS_PER_TERM = 12;
const MIN_BITS = 1024;
/** 4 KB: past about 2,700 terms (a long newsletter) more of them pass by chance, and their text is read to drop them. */
const MAX_BITS = 32_768;

/** What a message is found by: its text, its sender's name and address, and its subject. */
export interface Searched {
  text: string;
  fromName: string | null;
  fromAddress: string;
  subject: string;
}

export const searchedWords = (m: Searched): Set<string> => new Set(wordsOf([m.fromName ?? '', m.fromAddress, m.subject, m.text].join('\n')));

/** The bits a term sets, before they are folded into a filter's size: the low bits of each, so one hash serves every size. */
function hashesOf(db: Sql, term: string): number[] {
  if (db.person === null) throw new Error('Only a person’s handle indexes their mail.');
  const hash = searchHash(db.keys, db.person, term);
  return Array.from({ length: HASHES }, (_, i) => hash.readUInt32BE(i * 4));
}

/** The index of one message, as `mail_bodies.search` holds it. */
export const searchIndex = (db: Sql, message: Searched): Uint8Array => bloomOf(db, indexTerms(searchedWords(message)));

/** A filter holding `terms`. Bit n is bit n % 8 of byte n / 8, as Postgres's `get_bit` reads it. */
export function bloomOf(db: Sql, terms: ReadonlySet<string>): Uint8Array {
  let bits = MIN_BITS;
  while (bits < terms.size * BITS_PER_TERM && bits < MAX_BITS) bits *= 2;
  const index = new Uint8Array(bits / 8);
  for (const term of terms)
    for (const hash of hashesOf(db, term)) {
      const bit = hash & (bits - 1);
      index[bit >> 3]! |= 1 << (bit & 7);
    }
  return index;
}

/** True of every message whose index `column` says may match `search`, and of some that do not; false of a null one. */
export const mayMatch = (db: Sql, column: AnyColumn, search: Search): SQL => mayHold(db, column, searchTerms(search));

/** True of every filter in `column` that holds all of `terms`, and of some that do not; false of a null one. */
export function mayHold(db: Sql, column: AnyColumn, terms: readonly string[]): SQL {
  return and(
    ...terms.flatMap((term) => hashesOf(db, term).map((hash) => sql`get_bit(${column}, (${hash}::bigint & (octet_length(${column}) * 8 - 1))::integer) = 1`)),
  )!;
}
