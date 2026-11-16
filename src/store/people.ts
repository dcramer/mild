import { connectedAddresses, owner, userOf } from './accounts.ts';
import { openUserDb } from './db.ts';
import type { Sql } from './sql.ts';
import type { Store } from './store.ts';

/** Someone a request is from, with their database: the only one that request holds. */
export interface Person {
  owner: boolean;
  /** Their mailboxes, by address. */
  accounts: string[];
  db: Sql;
}

/**
 * What the dashboard may ask of the store. It finds a person by the address they signed in as, never by
 * id, so a request can only ever reach the database of whoever made it.
 */
export interface People {
  /** Whoever has the mailbox `email`, or null if no one does. */
  signedIn(email: string): Promise<Person | null>;
  /** The install's owner, for a dashboard with no sign-in set up (tests, tools). */
  owner(): Promise<Person | null>;
  /** A database with no one's mail in it, for a request with nobody behind it. */
  nobody(): Promise<Sql>;
}

export function people(store: Store): People {
  const person = async (user: { id: number; owner: boolean } | null): Promise<Person | null> =>
    user && { owner: user.owner, accounts: await connectedAddresses(store.central, user.id), db: await store.user(user.id) };
  let empty: Promise<Sql> | undefined;
  return {
    signedIn: async (email) => await person(await userOf(store.central, email)),
    owner: async () => await person(await owner(store.central)),
    nobody: () => (empty ??= openUserDb(':memory:')),
  };
}
