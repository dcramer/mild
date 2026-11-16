import { createHash } from 'node:crypto';
import { unsubscribe } from '../actions/unsubscribe.ts';
import type { Config } from '../config.ts';
import { type PassResult, type RunOptions, tick } from '../daemon/run.ts';
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
  /** The built page (`web/dist`). */
  pageDir: string;
  log: (line: string) => void;
  /**
   * Keeps work going after the request that started it is answered: in `sift run` it just runs on, on
   * Vercel `waitUntil`. Absent where nothing classifies mail (`sift dashboard` on its own).
   */
  background?: (work: Promise<unknown>) => void;
  /** How long a tick may start work, short of what the host would cut a call off at. */
  tickMs: number;
}

export interface Sift {
  /** Any request to the site: the page, the API, sign-in. */
  respond: (request: Request) => Promise<Response>;
  /** Do what is due, for these people or everyone, until the host's limit. */
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
  const ticking = (who?: readonly number[]) => tick(store, options, Date.now() + host.tickMs, who);
  const { background } = host;
  // What a person starts in the dashboard (check now, a test run, older mail) runs now, not at the next tick.
  const kick = background && ((person?: number) => background(ticking(person === undefined ? undefined : [person])));
  const controls = await buildControls(config, store, {
    ephemeral,
    deviceId: deviceId(host.sessionSecret),
    running: Boolean(background),
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
  return { respond: site(dashboard, host.pageDir), tick: ticking };
}
