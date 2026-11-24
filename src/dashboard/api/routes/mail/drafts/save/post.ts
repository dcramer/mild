import { Refusal } from '../../../../../../refusal.ts';
import { canSend } from '../../../../../../store/accounts.ts';
import { saveDraft } from '../../../../../../store/drafts.ts';
import { preferences } from '../../../../../../store/preferences.ts';
import { reportError } from '../../../../../../telemetry.ts';
import { DraftSave } from '../../../../../types.ts';
import { done, named, write } from '../../../../route.ts';
import { DAY_MS } from '../../../../../../time.ts';

/** How far ahead mail may be scheduled, as Gmail allows. */
const FURTHEST_MS = 49 * 365 * DAY_MS;

/**
 * Keep what the composer holds, as the person pauses: on every device at once, and in Gmail's Drafts once they stop. With
 * `sendAt`, scheduled: checked now as Send would check it, so what cannot go is said while the person is here.
 */
export default write({
  path: '/api/mail/drafts/save',
  body: DraftSave,
  // Its text may be long: 200,000 characters, each up to a few bytes as JSON writes it.
  largest: 1_000_000,
  reply: done,
  touches: named,
  run: async ({ db, controls, now }, draft) => {
    if (draft.sendAt !== undefined) {
      const { writing } = draft;
      if (!(await preferences(db)).mail) throw new Refusal('Turn Inbox on to send mail from Mild.');
      if (!(await canSend(db, draft.accountId))) throw new Refusal(`Google has not let Mild send from ${draft.accountId}.`);
      const everyone = [...writing.to, ...writing.cc, ...writing.bcc];
      if (everyone.length === 0) throw new Refusal('Say who the mail is to.');
      if (everyone.some((r) => r.wrong)) throw new Refusal('An address is wrong.');
      if (writing.id === null) throw new Refusal('Schedule it again.');
      if (draft.sendAt < now() - 60_000 || draft.sendAt > now() + FURTHEST_MS) throw new Refusal('Choose a time from now on.');
    }
    const moved = await saveDraft(db, draft, now());
    // Written from another mailbox now: Gmail's copy in the one before goes, and the pass gives the new one its own.
    if (moved && controls) await controls.dropDraft(db, { id: draft.id, ...moved }).catch(reportError);
    return { ok: true as const };
  },
});
