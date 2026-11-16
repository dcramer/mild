import { connectedAddresses, owner, userOf } from './accounts.ts';
import type { Sql } from './sql.ts';
import type { Store } from './store.ts';

/** Someone a request is from. */
interface Person {
  id: number;
  owner: boolean;
  /** Their mailboxes, by address. */
  accounts: string[];
  /**
   * The only way a request opens a person's database. Refuses any id this person may not read, which
   * today is everyone's but their own. A view that needs several opens each.
   */
  open: (id: number) => Promise<Sql>;
}

/**
 * What the dashboard may ask of the store. It finds a person by the address they signed in as, never by
 * id, and reaches databases only through that person's `open`.
 */
export interface People {
  /** Whoever has the mailbox `email`, or null if no one does. */
  signedIn(email: string): Promise<Person | null>;
  /** The install's owner, for a dashboard with no sign-in set up (tests, tools). */
  owner(): Promise<Person | null>;
  /** Sees no one's rows, for a request with nobody behind it. */
  nobody: Sql;
}

export function people(store: Store): People {
  const person = async (user: { id: number; owner: boolean } | null): Promise<Person | null> => {
    if (!user) return null;
    const readable = new Set([user.id]);
    return {
      id: user.id,
      owner: user.owner,
      accounts: await connectedAddresses(store.central, user.id),
      open: async (id) => {
        if (!readable.has(id)) throw new Error(`Person ${user.id} may not open person ${id}'s database.`);
        return await store.user(id);
      },
    };
  };
  return {
    signedIn: async (email) => await person(await userOf(store.central, email)),
    owner: async () => await person(await owner(store.central)),
    nobody: store.nobody,
  };
}
