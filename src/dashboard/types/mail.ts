import { z } from 'zod';
import { MAIL_WINDOWS } from '../../mail-window.ts';
import { held, heldValues } from './parts.ts';
import { Thinks } from './suggestions.ts';

/** Which conversations Inbox lists: all, those Mild would leave in the inbox or could not place, or those it would move out. */
export const MAIL_VIEWS = ['all', 'needs', 'sorted'] as const;
export type MailView = (typeof MAIL_VIEWS)[number];

/** What Mild thinks of a conversation: of its newest message in the inbox, the one keeping it there, or its newest where none is. */
const ThreadThinks = Thinks.extend({ messageId: z.string() });

/** GET /api/mail/threads: one conversation with mail in the inbox now. */
export const MailThread = z.object({
  accountId: z.string(),
  threadId: z.string(),
  /** Its newest message's. */
  subject: held,
  /** Its newest message's sender's address, which an answer about it names. */
  from: held,
  /** Who wrote the messages Mild has of it, oldest first, each address once: its name, or the address of a sender without one; the reader's own mailboxes as "me", with no address. */
  who: z.array(z.object({ name: held, address: held.nullable() })),
  /** The messages Mild has recorded of it, oldest first; the newest is the one the reader opens. Sync records mail that arrives, not what the person sent. */
  messageIds: z.array(z.string()),
  unread: z.boolean(),
  newestAt: z.number(),
  /** Where it is, for a search that looks past the inbox: in it, out of it, or only what the person sent. */
  place: z.enum(['inbox', 'archived', 'sent']),
  /** The start of its newest message's text, on one line, where Mild holds it. */
  preview: held.nullable(),
  /** Null when Mild has not decided it. */
  thinks: ThreadThinks.nullable(),
});
export type MailThread = z.infer<typeof MailThread>;

export const MailThreads = z.object({
  /** Newest first. */
  threads: z.array(MailThread),
  /** Where the next page starts, for `before`; null at the end. A search may give fewer than a page and still have more. */
  next: z.string().nullable(),
});
export type MailThreads = z.infer<typeof MailThreads>;

/** GET /api/mail/thread: the messages Mild has of one conversation, oldest first, each as its folded row shows it. A message's text is `/api/message`'s. */
export const MailConversation = z.object({
  accountId: z.string(),
  threadId: z.string(),
  messages: z.array(
    z.object({
      messageId: z.string(),
      fromAddress: held,
      fromName: held.nullable(),
      receivedAt: z.number(),
      unread: z.boolean(),
      preview: held.nullable(),
    }),
  ),
});
export type MailConversation = z.infer<typeof MailConversation>;

/** A conversation as the page's copy holds it (docs/sync.md): its recorded messages, oldest first, and what Mild thinks of it. */
export const SyncedConversation = z.object({
  accountId: z.string(),
  threadId: z.string(),
  messages: z.array(
    z.object({
      messageId: z.string(),
      fromAddress: held,
      fromName: held.nullable(),
      subject: held,
      receivedAt: z.number(),
      /** Gmail's, as sync last read them: `INBOX`, `UNREAD`, `SENT` and the rest. */
      labelIds: z.array(z.string()),
      preview: held.nullable(),
    }),
  ),
  /** As Inbox's list says it; the label by id alone, named from the person's labels. Null when Mild has not decided it. */
  thinks: ThreadThinks.omit({ labelName: true }).nullable(),
});
export type SyncedConversation = z.infer<typeof SyncedConversation>;

/** GET /api/sync: what changed in the page's copy since `since` (docs/sync.md). */
export const SyncPage = z.object({
  /** Where to ask from next. */
  cursor: z.string(),
  /** Drop everything held first: what follows, with the pages after it, is the whole copy. */
  reset: z.boolean(),
  /** There is more: ask again at once from `cursor`. */
  more: z.boolean(),
  /** The person's counter the copy holds every change up to once this page, and with `more` every page after it, is applied: a write is held once it reaches the write's `x-sift-seq`. */
  seq: z.number(),
  /** The person's mailboxes: a conversation of any other is gone, since removing a mailbox marks none of its own. */
  mailboxes: z.array(z.string()),
  /** Each changed conversation as it is now; null when it is gone or out of the copy. */
  conversations: z.array(z.object({ accountId: z.string(), threadId: z.string(), conversation: SyncedConversation.nullable() })),
});
export type SyncPage = z.infer<typeof SyncPage>;

/** The body of POST /api/mail/change: the person's own press on messages in their inbox. */
export const MailChange = z.strictObject({
  accountId: z.string(),
  messageIds: z.array(z.string().min(1).max(200)).min(1).max(200),
  change: z.enum(['archive', 'spam', 'read', 'unread']),
});
export type MailChange = z.infer<typeof MailChange>;

/** POST /api/mail/ask: the person's words as a filter on Inbox's list, each part of it one the list takes, or why there is none. Held as it is stored. */
export const MailAsk = z.union([
  z.object({
    filter: z.object({
      from: heldValues,
      domain: heldValues,
      label: held.optional(),
      view: z.enum(MAIL_VIEWS).exclude(['all']).optional(),
      unread: z.literal(true).optional(),
      /** `YYYY-MM-DD`, in the reader's days. */
      since: held.optional(),
      /** Words for Inbox's search, which the page puts in it. */
      words: heldValues,
    }),
    /** What of their words it leaves out. */
    note: held.optional(),
  }),
  z.object({ cannot: held }),
]);
export type MailAsk = z.infer<typeof MailAsk>;

/** How far back Inbox keeps the viewer's mail. */
export const MailWindow = z.enum(MAIL_WINDOWS);

/** GET /api/mail/reach: for each window, about how many messages copying it reads from Gmail, what they take to keep, in bytes, and how long reading them takes. */
const Reach = z.object({ messages: z.number(), bytes: z.number(), minutes: z.number() });
export const MailReach = z.object({ year: Reach, three_years: Reach, all: Reach });
export type MailReach = z.infer<typeof MailReach>;
