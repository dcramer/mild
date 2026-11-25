import { ownOf } from './answering.ts';
import type { Draft, Writing } from './compose.ts';

/** Words that say a file goes with the mail. */
const SAYS_ATTACHED = /\b(attach(ed|ing|ment|ments)?|enclosed)\b/i;

/**
 * What Send asks first, as Gmail does, each in turn: about mail with no subject, and mail whose own words say a file is
 * attached when none is. A reply's subject is its message's.
 */
export function doubtsAbout(what: Writing, draft: Draft, files: number): string[] {
  const own = ownOf(draft.text);
  return [
    ...(what.kind !== 'reply' && draft.subject.trim() === '' ? ['Send without a subject?'] : []),
    ...(files === 0 && SAYS_ATTACHED.test(own) ? ['You mention a file, but none is attached. Send anyway?'] : []),
  ];
}

/**
 * Nothing in it the person put there: no words of their own (a forward's or a reply's quote is not), no files, and the subject and
 * recipients it started with. Such a draft is neither kept nor saved, and one saved that comes to this is forgotten.
 * `subject` is a reply's, which Edit subject starts on.
 */
export function blank(draft: Draft, start: Draft, subject: string | undefined): boolean {
  const own = ownOf(draft.text);
  const recipients = (d: Draft) => [d.to, d.cc, d.bcc].map((line) => line.map((r) => r.address.toLowerCase()).join(',')).join(';');
  return (
    own.trim() === '' &&
    draft.files.length === 0 &&
    draft.subject.trim() === (draft.editSubject ? (subject ?? '') : start.subject).trim() &&
    recipients(draft) === recipients(start)
  );
}
