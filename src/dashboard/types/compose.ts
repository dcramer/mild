import { z } from 'zod';
import type { Sealed } from '../../confidential.ts';
import { held, text } from './parts.ts';

const party = z.strictObject({ address: text(320), name: text().optional() });
const sending = {
  /** The mailbox that sends it. */
  accountId: text(),
  /** Its Message-ID, made by the page once for the press of Send and given again when that press is tried again, so it goes once. */
  id: text(),
  /** That mailbox's address or one of its aliases. */
  from: party,
  to: z.array(party).max(100),
  cc: z.array(party).max(100),
  bcc: z.array(party).max(100),
  text: z.string().max(200_000),
  /** Files uploaded for it (`/api/mail/upload`), in the order they go. */
  uploads: z.array(text(64)).max(50),
  /** The draft it was written as (`/api/mail/drafts/save`), which goes once it has, with Gmail's copy. */
  draft: text(100).optional(),
};

/**
 * The body of POST /api/mail/send: what the person wrote. A reply names the message it answers, in the same mailbox; its
 * subject, conversation and the Message-IDs it follows are read from the record, not sent.
 */
export const SendRequest = z.union([
  z.strictObject({
    ...sending,
    subject: z.string().max(900),
    /** A forward: the message's files that go with it, by their parts. */
    forwarding: z.strictObject({ messageId: text(), parts: z.array(text(64)).max(50) }).optional(),
  }),
  z.strictObject({
    ...sending,
    replyTo: z.strictObject({ messageId: text() }),
    /** Edited, as Gmail lets a reply's be: it then goes as a conversation of its own. Left out, the message's with "Re: ". */
    subject: z.string().max(900).optional(),
    /** The files of the message answered that go with it, by their parts (Gmail's Include original attachments). */
    forwarding: z.strictObject({ messageId: text(), parts: z.array(text(64)).max(50) }).optional(),
  }),
]);
export type SendRequest = z.infer<typeof SendRequest>;

/** Someone the composer suggests as an address is typed: whom the person has written to first, then who wrote to them. */
export const AddressSuggestion = z.object({ address: held, name: held.nullable() });
export type AddressSuggestion = z.infer<typeof AddressSuggestion>;

const recipient = z.strictObject({ address: text(320), name: text().optional(), wrong: z.literal(true).optional() });

/** What a draft answers: nothing (new mail), a message replied to, or one forwarded. */
const DraftOf = z.union([
  z.strictObject({ kind: z.literal('new') }),
  z.strictObject({ kind: z.literal('reply'), messageId: text(), all: z.boolean() }),
  z.strictObject({ kind: z.literal('forward'), messageId: text() }),
]);

/** Mail being written, as the composer holds it (`Draft`, web/src/lib/compose.ts), saved as the person pauses. */
export const DraftWriting = z.strictObject({
  of: DraftOf,
  from: z.string().max(320),
  to: z.array(recipient).max(100),
  cc: z.array(recipient).max(100),
  bcc: z.array(recipient).max(100),
  showCc: z.boolean(),
  showBcc: z.boolean(),
  subject: z.string().max(900),
  text: z.string().max(200_000),
  files: z.array(z.strictObject({ id: text(64), name: text(255), size: z.int().nonnegative(), added: z.number() })).max(50),
  dropped: z.array(text(64)).max(50),
  /** A reply that carries the files of the message it answers. */
  withFiles: z.boolean().optional(),
  /** A reply whose subject was opened to edit. */
  editSubject: z.boolean().optional(),
  /** A reply whose quote of the message it answers is in its text. */
  quoted: z.boolean().optional(),
  /** The Message-ID of a press of Send that may not have gone. */
  id: text().nullable(),
  /** When it was last changed, by the page's clock: of two copies of it, the newer is kept. */
  at: z.number(),
});
export type DraftWriting = z.infer<typeof DraftWriting>;

/** The body of POST /api/mail/drafts/save. `id` names the draft: one for each new message, one for a reply or forward of each message. */
export const DraftSave = z.strictObject({
  id: text(100),
  accountId: text(),
  writing: DraftWriting,
  /** Send it then (schedule send). Left out, a draft is not scheduled, and one that was is no longer. */
  sendAt: z.number().optional(),
});
export type DraftSave = z.infer<typeof DraftSave>;

/** A draft saved, as GET /api/mail/drafts lists it: all of it, so the composer can open it. */
export const SavedDraft = z.object({
  id: z.string(),
  accountId: z.string(),
  writing: z.custom<Sealed<DraftWriting>>((value) => typeof value === 'object' && value !== null),
  changedAt: z.number(),
  /** In Gmail's Drafts too. */
  inGmail: z.boolean(),
  sendAt: z.number().nullable(),
  /** Why it did not go when it was scheduled to, which the person puts right. */
  sendError: z.string().nullable(),
});
export type SavedDraft = z.infer<typeof SavedDraft>;
