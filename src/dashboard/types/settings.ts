import { z } from 'zod';
import { REASONING } from '../../model/reasoning.ts';
import { REACHES } from '../../store/states.ts';
import { LabelSummary } from './labels.ts';
import { MailWindow } from './mail.ts';
import { held } from './parts.ts';

/**
 * A ChatGPT sign-in waiting on the person: where to go, and by device code the code to enter there.
 * Without a code, it is a Sign in with ChatGPT, finished by pasting back the address it ends on.
 */
export const SignInCode = z.object({ code: z.string().optional(), url: z.string(), expiresAt: z.number() });
export type SignInCode = z.infer<typeof SignInCode>;

/** Going through the viewer's inboxes: where it has got, all mailboxes together, or how it went last. */
const InboxProgress = z.object({
  /** `listed` false: still reading what is in the inbox, so `total` is what has been found so far. `spent` in dollars. */
  going: z.object({ listed: z.boolean(), done: z.number(), total: z.number(), spent: z.number(), startedAt: z.number() }).nullable(),
  /** `total`: how many it went through, which is fewer than were there when it was stopped. */
  last: z.object({ finishedAt: z.number(), total: z.number(), spent: z.number(), stopped: z.boolean() }).nullable(),
});

/** GET /api/inbox: what going through the viewer's inboxes would take. */
export const InboxEstimate = z.object({
  messages: z.number(),
  /** Of `messages`, about how many need the model: as many as did lately. */
  model: z.number(),
  /** About what those calls cost, in dollars, through ChatGPT what they would cost through the API; null when the price is not known. */
  cost: z.number().nullable(),
});
export type InboxEstimate = z.infer<typeof InboxEstimate>;

/** Which of the newest messages a press goes through: the whole inbox, or enough to teach with. */
export const InboxReach = z.enum(REACHES);

/** GET /api/manage: everything the Settings view shows. */
export const ManageState = z.object({
  /** Whether the viewer owns the install, and so may change what applies to all of it. */
  owner: z.boolean(),
  /** Whether Mild is on for the viewer. Off, it only suggests for their mail; on, it carries its decisions out in Gmail. */
  active: z.boolean(),
  /** Whether Inbox is on for the viewer: Mild keeps a copy of their mail, and may send as them. */
  mail: z.boolean(),
  mailWindow: MailWindow,
  /** Copying the viewer's mailboxes for Inbox, all of them together: `total` is what counting has found so far until `counted`. Null when none is going. */
  copying: z.object({ counted: z.boolean(), done: z.number(), total: z.number(), startedAt: z.number() }).nullable(),
  /** The viewer's own model: which one they chose, how they can reach one, and a ChatGPT sign-in under way. */
  model: z.object({
    chosen: z.string().nullable(),
    reasoning: z.enum(REASONING),
    choices: z.array(z.object({ provider: z.string(), label: z.string(), how: z.enum(['device-code', 'redirect', 'key']) })),
    signedIn: z.array(z.string()),
    pending: z.union([SignInCode, z.object({ error: z.string() })]).nullable(),
  }),
  activity: z.object({ running: z.boolean(), lastPassAt: z.number().nullable(), problems: z.array(z.string()), expired: z.array(z.string()) }),
  /**
   * `canSend`: Google let Mild send from it (`/auth/login?grant=send&mailbox=…` asks). `aliases`: its other addresses in Gmail,
   * which it may send as. `signatures`: the Gmail signature of each of its addresses that has one, as text.
   */
  accounts: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      lastSyncedAt: z.number().nullable(),
      primary: z.boolean(),
      canSend: z.boolean(),
      aliases: z.array(z.string()),
      signatures: z.record(z.string(), held),
      /** When Google will end its sign-in, known only once one has ended a week after it was given (a client in Testing). */
      signInEnds: z.number().nullable(),
    }),
  ),
  /** In order. */
  labels: z.array(LabelSummary),
  /** How many labels a person may have. */
  labelLimit: z.number(),
  /** Mail waiting on the viewer that Mild would move or could not place: For review's count. */
  waiting: z.number(),
  inbox: InboxProgress,
  /** The hour of the viewer's day a label's digest arrives, and the zone it is read in: null when their browser never said, which is UTC. */
  digest: z.object({ hour: z.number(), timeZone: z.string().nullable() }),
  /** What the model cost over the last 30 days, and how many messages it was asked about. */
  spent: z.object({ costUsd: z.number(), judged: z.number() }),
});
export type ManageState = z.infer<typeof ManageState>;

/** GET /api/models: the models the viewer's sign-ins offer. */
export const Models = z.object({
  models: z.array(z.string()),
  /** Per provider, the few to offer before the full list; the first is the one to suggest. */
  shortlist: z.record(z.string(), z.array(z.string())),
  /** Per model, dollars for 1,000 messages at its catalog price, where the catalog has one. */
  costs: z.record(z.string(), z.number()),
  /** A provider could not be reached. */
  error: z.string().optional(),
});
export type Models = z.infer<typeof Models>;

/** GET /api/session. */
export const Session = z.object({
  /** False when this dashboard does not ask for sign-in. */
  required: z.boolean(),
  /** The signed-in account, or null. */
  email: z.string().nullable(),
  canSignIn: z.boolean(),
  /** Why not: no Google client is set up, or Google cannot return to this address. */
  reason: z.enum(['no-client', 'address']).nullable(),
  /** Addresses sign-in works at. */
  addresses: z.array(z.string()),
  /** `MILD_CLOUD`: this Mild is a service for other people. Someone's own copy has no terms, privacy policy or security page. */
  cloud: z.boolean(),
  /** Where the page sends how long it took and what failed in it: this server's Sentry project. Null when the server sends nothing. */
  telemetry: z.object({ dsn: z.string(), release: z.string().nullable(), environment: z.string().nullable() }).nullable(),
  /** Whether Mild knows this browser's device (`sift_device`): one it does not wipes what it kept, and is made again. */
  device: z.boolean(),
});
export type Session = z.infer<typeof Session>;

/** What POST /api/mailbox/remove and /api/account/delete answer. */
export const Removed = z.object({
  /** Mailboxes whose access Google could not be reached to revoke. Removed all the same. */
  notRevoked: z.array(z.string()),
  /** Their session has ended. */
  signedOut: z.boolean(),
});
export type Removed = z.infer<typeof Removed>;
