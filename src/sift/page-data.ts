import { type DehydratedState, QueryClient, dehydrate } from '@tanstack/react-query';
import type { Confidential } from '../confidential.ts';
import type { ManageState, Session, Usage } from '../dashboard/types.ts';
import { framed, respond } from './instance.ts';

/** Whether `T` holds a `Confidential` anywhere in it. */
type Holds<T> = T extends Confidential ? true : T extends object ? (true extends { [K in keyof T]-?: Holds<T[K]> }[keyof T] ? true : false) : false;

/** What a dashboard page is drawn with on the server, by the key the page loads it under (`useLoaded`). */
interface Drawn {
  session: Session;
  manage: ManageState;
  usage: Usage;
  /** The key this browser's copy of the person's mail is encrypted with (docs/sync.md); null until the page has made one. */
  device: { key: string | null };
}

/**
 * The API path each is read from. A reply that holds what Mild stores encrypted has the type `never` here, so the
 * type checker refuses it: whatever the server draws with is in the page's HTML.
 */
const PATHS: { [K in keyof Drawn]: Holds<Drawn[K]> extends true ? never : string } = {
  session: '/api/session',
  manage: '/api/manage',
  usage: '/api/usage',
  device: '/api/device',
};

/**
 * The queries a dashboard page starts with, for whoever `asked` is, read through the API as the browser would read
 * them: the same session, Host and scope checks (`respond`), in this process. A visitor nobody is signed in as gets
 * only the session, which says so.
 */
export const drawnFor = (asked: Headers): Promise<DehydratedState> => framed(() => drawn(asked));

async function drawn(asked: Headers): Promise<DehydratedState> {
  const client = new QueryClient();
  const base = `${asked.get('x-forwarded-proto') === 'https' ? 'https' : 'http'}://${asked.get('host') ?? 'localhost'}`;
  const read = async <K extends keyof Drawn>(key: K): Promise<Drawn[K] | null> => {
    const reply = await respond(new Request(new URL(PATHS[key], base), { headers: asked }));
    if (!reply.ok) return null;
    const body = (await reply.json()) as Drawn[K];
    client.setQueryData([key], body);
    return body;
  };
  const session = await read('session');
  if (session && !(session.required && session.email === null)) await Promise.all([read('manage'), read('usage'), read('device')]);
  return dehydrate(client);
}
