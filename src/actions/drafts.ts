import type { Mailbox } from './mailbox.ts';
import { buildMessage } from './send.ts';
import { plain } from '../plain.ts';
import { finishAction, insertPendingAction } from '../store/actions.ts';
import { draftsBehind, markPushed } from '../store/drafts.ts';
import { answering } from '../store/reply.ts';
import type { Sql } from '../store/sql.ts';
import { uploaded } from '../store/uploads.ts';
import { reportError } from '../telemetry.ts';

/**
 * How long a draft is left alone before Gmail is given it: the composer saves to Mild at each pause, and Gmail hears only
 * once the writing has stopped, so a draft written over ten minutes is a write or two, not one a pause.
 */
export const DRAFT_QUIET_MS = 2 * 60_000;

/** A Message-ID for a draft Gmail is given, which the press of Send replaces with its own. */
const draftMessageId = (id: string, from: string) => `<draft.${id.replaceAll(/[^\w.-]/g, '')}@${from.slice(from.lastIndexOf('@') + 1) || 'mild.invalid'}>`;

/**
 * Give Gmail's Drafts every draft of the mailbox changed since it last had it and left alone since `DRAFT_QUIET_MS`, as
 * Gmail would hold it: to whoever it is to so far, its subject, its text and its files, in its conversation for a reply.
 * Forwarded files are left to the send. A draft whose addresses or files cannot go yet is given as far as it can.
 * Safe to repeat. Returns how many went.
 */
export async function pushDrafts(db: Sql, mailbox: Mailbox, accountId: string, now: number): Promise<number> {
  let pushed = 0;
  for (const draft of await draftsBehind(db, accountId, now - DRAFT_QUIET_MS)) {
    const writing = plain(draft.writing);
    const parties = (list: typeof writing.to) => list.filter((r) => !r.wrong).map(({ address, name }) => (name ? { address, name } : { address }));
    const answered = writing.of.kind === 'reply' ? await answering(db, accountId, writing.of.messageId) : null;
    const mail = {
      from: { address: writing.from || accountId },
      to: parties(writing.to),
      cc: parties(writing.cc),
      bcc: parties(writing.bcc),
      subject: answered?.subject ?? writing.subject,
      text: writing.text,
      ...(answered?.inReplyTo ? { inReplyTo: answered.inReplyTo } : {}),
      ...(answered ? { references: answered.references } : {}),
    };
    try {
      const files = await uploaded(
        db,
        writing.files.map((f) => f.id),
      ).catch(() => []);
      const raw = buildMessage(mail, draftMessageId(draft.id, mail.from.address), now, files, true);
      const actionId = await insertPendingAction(
        db,
        { accountId, messageId: null, type: 'draft', payload: { add: [], remove: [], draft: { id: draft.id } }, originalLabels: [] },
        now,
      );
      try {
        const gmailId = await mailbox.saveDraft({
          raw,
          ...(answered ? { threadId: answered.threadId } : {}),
          ...(draft.gmailId ? { draftId: draft.gmailId } : {}),
        });
        await finishAction(db, actionId, 'done', ['DRAFT'], null, now);
        await markPushed(db, draft.id, draft.changedAt, gmailId);
        pushed++;
      } catch (error) {
        await finishAction(db, actionId, 'failed', null, error instanceof Error ? error.message : String(error), now);
        throw error;
      }
    } catch (error) {
      // One draft Gmail will not take leaves the others; it is tried again next pass.
      reportError(error);
    }
  }
  return pushed;
}

/** Take a draft out of Gmail's Drafts: it was sent, discarded, or moved to another mailbox. Recorded as the push is. */
export async function dropGmailDraft(db: Sql, mailbox: Mailbox, draft: { id: string; accountId: string; gmailId: string }, now: number): Promise<void> {
  const actionId = await insertPendingAction(
    db,
    {
      accountId: draft.accountId,
      messageId: null,
      type: 'draft',
      payload: { add: [], remove: [], draft: { id: draft.id, gmailId: draft.gmailId, removed: true } },
      originalLabels: ['DRAFT'],
    },
    now,
  );
  try {
    await mailbox.deleteDraft(draft.gmailId);
    await finishAction(db, actionId, 'done', [], null, now);
  } catch (error) {
    await finishAction(db, actionId, 'failed', null, error instanceof Error ? error.message : String(error), now);
    throw error;
  }
}
