import { createHash } from 'node:crypto';
import { unsubscribe } from '../actions/unsubscribe.ts';
import type { Config } from '../config.ts';
import { type PassResult, type RunOptions, type Work, dueWork, runWork, tick } from '../daemon/run.ts';
import { createDashboard } from '../dashboard/server.ts';
import type { Ephemeral } from '../ephemeral/ephemeral.ts';
import { listAccounts, personOf } from '../store/accounts.ts';
import { people } from '../store/people.ts';
import type { Sql } from '../store/sql.ts';
import type { Store } from '../store/store.ts';
import { buildControls, gmailFor, openModelTier } from './controls.ts';
import { buildSignIn } from './google-sign-in.ts';
import { site } from './site.ts';

/** What a host gives sift: `sift run` on a machine, or a function on Vercel (docs/RUNTIME.md). */
export interface Host {
  config: Config;
  store: Store;
  ephemeral: Ephemeral;
  /** Signs session cookies; ChatGPT also knows this install by an id derived from it. */
  sessionSecret: string;
  /** Names besides localhost the dashboard answers to. */
  allowedHosts: readonly string[];
  /** Addresses Google can sign someone in at, suggested when the dashboard is opened at one it cannot. */
  signInAddresses: readonly string[];
  /** The built page (`web/dist`), when sift serves it; absent where the host does (Vercel's CDN). */
  pageDir?: string;
  log: (line: string) => void;
  /**
   * Gets what is due for these people (or everyone) done, without the caller waiting: `sift run` in this
   * process, Vercel each piece in a call of its own. Absent where nothing classifies mail (`sift dashboard`).
   */
  start?: (sift: Sift, people?: readonly number[]) => void;
  /** How long one piece of work may start work, short of what the host would cut a call off at. */
  limitMs: number;
}

export interface Sift {
  /** Any request to the site: the page, the API, sign-in. */
  respond: (request: Request) => Promise<Response>;
  /** What is due, for these people or everyone. */
  due: (people?: readonly number[]) => Promise<Work[]>;
  /** Do one piece of it, within the host's limit. */
  work: (work: Work) => Promise<PassResult | null>;
  /** Do all of it here, a few pieces at a time. */
  tick: (people?: readonly number[]) => Promise<PassResult[]>;
}

/** The id ChatGPT registers this install's sign-ins under: a UUID, the same on every instance. */
const deviceId = (secret: string) => {
  const hex = createHash('sha256').update(`sift chatgpt device:${secret}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** sift, put together from what the host gives it. Holds nothing between calls but what `host` does. */
export async function createSift(host: Host): Promise<Sift> {
  const { config, store, ephemeral, log } = host;
  // Why each person's model could not be reached, so a log says it once rather than every pass. Only the log forgets it.
  const unreachable = new Map<number, string>();
  const options: RunOptions = {
    ephemeral,
    log,
    model: async (db: Sql) => {
      const person = await personOf(db);
      try {
        const tier = await openModelTier(config, ephemeral, db);
        unreachable.delete(person);
        return tier && { judge: tier.judge, model: tier.spec };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (unreachable.get(person) !== message) log(`${(await listAccounts(db)).map((a) => a.email).join(', ')}: ${message}`);
        unreachable.set(person, message);
        return null;
      }
    },
    unsubscribe: (db, accountId, messageId) => unsubscribe({ db }, accountId, messageId),
    connect: async (db, account) => {
      const { api, mailbox } = await gmailFor(config, ephemeral, db, account.email);
      return { api, mailbox };
    },
  };
  // Bound below, before any request can reach `kick`.
  let sift: Sift | undefined;
  const { start } = host;
  // What a person starts in the dashboard (check now, a test run, older mail) begins now, not at the next tick.
  const kick = start && ((person?: number) => start(sift!, person === undefined ? undefined : [person]));
  const controls = await buildControls(config, store, {
    ephemeral,
    deviceId: deviceId(host.sessionSecret),
    running: Boolean(start),
    ...(kick ? { kick } : {}),
  });
  const dashboard = createDashboard(people(store), {
    allowedHosts: host.allowedHosts,
    controls,
    signIn: buildSignIn(config, store),
    sessionSecret: host.sessionSecret,
    signInAddresses: host.signInAddresses,
    ephemeral,
  });
  sift = {
    respond: host.pageDir ? site(dashboard, host.pageDir) : dashboard.handle,
    due: (who) => dueWork(store, options, who),
    work: (piece) => runWork(store, piece, options, Date.now() + host.limitMs),
    tick: (who) => tick(store, options, host.limitMs, who),
  };
  return sift;
}
