import { describe, expect, it } from 'vitest';
import type { SenderPage } from '../src/dashboard/types.ts';
import { nextMail } from '../web/src/lib/next-mail.ts';

type Page = Pick<SenderPage, 'decisions' | 'profile'>;
type Rule = SenderPage['profile']['rules'][number];

const decided = (labelId: string | null, disposition: string, byUser = false) =>
  ({ labelId, labelName: labelId && labelId[0]!.toUpperCase() + labelId.slice(1), disposition, byUser }) as SenderPage['decisions'][number];

// Decisions newest first, as the page gets them: the order Sift decided, not the order mail came.
const page = (decisions: SenderPage['decisions'], labels: [string, number][]): Page =>
  ({ decisions, profile: { labels: labels.map(([id, messages]) => ({ id, name: id, messages })), rules: [] } }) as unknown as Page;

describe("a sender's next mail", () => {
  it('is what a rule for all their mail does', () => {
    const rule = { kind: 'action', labelName: null, disposition: 'archive' } as unknown as Rule;
    expect(nextMail(page([decided('notifications', 'keep')], [['notifications', 1]]), rule)).toEqual({
      labelName: null,
      disposition: 'archive',
      usually: false,
    });
  });

  it('is their latest when their mail is of one kind', () => {
    expect(nextMail(page([decided('newsletter', 'archive'), decided('newsletter', 'keep', true)], [['newsletter', 2]]), null)).toEqual({
      labelName: 'Newsletter',
      disposition: 'archive',
      usually: false,
    });
    expect(nextMail(page([], []), null)).toEqual({ labelName: null, disposition: 'review', usually: false });
  });

  it('is what most of it is when it is of several kinds, whatever Sift decided last', () => {
    const mixed = page(
      [decided(null, 'review'), decided('security', 'keep'), decided('notification', 'keep'), decided('notification', 'keep')],
      [
        ['notification', 2],
        ['security', 1],
      ],
    );
    expect(nextMail(mixed, null)).toEqual({ labelName: 'Notification', disposition: 'keep', usually: true });
    // A rule that waits for a label does not say what all their mail is.
    const waits = { kind: 'when-label', labelName: 'Security', disposition: 'keep' } as unknown as Rule;
    expect(nextMail(mixed, waits)).toMatchObject({ usually: true });
  });
});
