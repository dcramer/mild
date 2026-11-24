import { z } from 'zod';
import { ListedDecision } from './activity.ts';
import { Contact, Given, Saved, held, heldMatch, ruleKind } from './parts.ts';

/** What Mild knows about one sender, or about everyone at one domain, to judge their mail by. */
export const SenderProfile = z.object({
  /** An address, or for a domain's profile the domain. */
  address: held,
  contact: Contact,
  /** What the owner's own rule for exactly them says, given on their page. */
  given: Given.nullable(),
  lastSeenAt: z.number().nullable(),
  /** Messages in the last 30 days. */
  recent: z.number(),
  /** Their mail Mild took out of the inbox, ever. */
  saved: Saved,
  /** For a domain: how many addresses have written from it. */
  senders: z.number(),
  /** The owner's answers about their mail. */
  answers: z.object({ right: z.number(), wrong: z.number() }),
  /** The sender's domain. Null for a domain's own profile and for a domain anyone can get an address at. */
  domain: z.object({ name: held, contact: Contact }).nullable(),
  /** Messages recorded from this address. */
  messages: z.number(),
  firstSeenAt: z.number().nullable(),
  /** Whether the account owner has ever written to this address. Null if that has not been checked. */
  userHasWritten: z.boolean().nullable(),
  /** What this sender's mail currently is, by label, most first. */
  labels: z.array(z.object({ id: z.string(), name: z.string(), messages: z.number() })),
  /** Rules that name this sender or their domain. */
  rules: z.array(
    z.object({
      id: z.string(),
      match: heldMatch,
      name: held.nullable(),
      labelId: z.string().nullable(),
      labelName: z.string().nullable(),
      disposition: z.string().nullable(),
      source: z.string(),
      kind: ruleKind,
      when: z.string().nullable(),
    }),
  ),
});
export type SenderProfile = z.infer<typeof SenderProfile>;

/** GET /api/sender and /api/domain. */
export const SenderPage = z.object({
  kind: z.enum(['sender', 'domain']),
  /** The name the sender last used. */
  name: held.nullable(),
  profile: SenderProfile,
  /** For an address that sends under more than one name: each name (null for mail with none), most mail first, with what its mail is by label. */
  names: z.array(
    z.object({
      name: held.nullable(),
      messages: z.number(),
      lastSeenAt: z.number(),
      labels: z.array(z.object({ id: z.string(), name: z.string(), messages: z.number() })),
      /** Mail a rule gave no label, only an action. */
      actions: z.array(z.object({ action: z.string(), messages: z.number() })),
    }),
  ),
  /** For a domain: who writes from it, most mail first. */
  senders: z.array(z.object({ address: held, name: held.nullable(), messages: z.number(), lastSeenAt: z.number(), contact: Contact })),
  /** Their mail, newest first. */
  decisions: z.array(ListedDecision),
});
export type SenderPage = z.infer<typeof SenderPage>;

/**
 * What a contact's next message gets (`nextOf`, src/dashboard/queries/contacts.ts): what the rule for all their
 * mail does (`ruleId`), or else what their mail has been, the reader's answers included; `usually` when it is of several kinds.
 */
export const NextMail = z.object({
  labelId: z.string().nullable(),
  labelName: z.string().nullable(),
  disposition: z.string(),
  usually: z.boolean(),
  ruleId: z.string().nullable(),
});
export type NextMail = z.infer<typeof NextMail>;

/** GET /api/contacts: everyone the person has mail from, newest first, a page of them and how many match in all. */
export const ContactPage = z.object({
  total: z.number(),
  rows: z.array(
    z.object({
      address: held,
      /** The name on their newest message. */
      name: held.nullable(),
      contact: Contact,
      given: Given.nullable(),
      /** Rules that name them or their domain. */
      rules: z.number(),
      next: NextMail,
      /** Messages in the last 30 days. */
      recent: z.number(),
      lastSeenAt: z.number(),
    }),
  ),
});
export type ContactPage = z.infer<typeof ContactPage>;
