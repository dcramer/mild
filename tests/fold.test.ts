import { describe, expect, it } from 'vitest';
import { held } from '../src/plain.ts';
import { fold } from '../web/src/lib/fold.ts';

const mail = (id: string, sender: string, labelId: string | null, senderName: string | null = null, accountId = 'me@example.org') => ({
  id,
  accountId,
  sender: held(sender),
  senderName: held(senderName),
  labelId,
});
const rows = (items: ReturnType<typeof mail>[]) => fold(items).map(({ item, rest }) => [item.id, ...rest.map((r) => r.id)]);

describe("For review's rows", () => {
  it("fold a sender's waiting mail of one label into the row of the first of it, in the list's order", () => {
    expect(
      rows([
        mail('a', 'bot@example.com', 'notification'),
        mail('b', 'ada@example.org', null),
        mail('c', 'bot@example.com', 'notification'),
        mail('d', 'bot@example.com', 'notification'),
      ]),
    ).toEqual([['a', 'c', 'd'], ['b']]);
  });

  it('keep apart what was given another label or came under another name, but not what came to another mailbox', () => {
    expect(
      rows([
        mail('a', 'bot@example.com', 'notification', 'Dependabot'),
        mail('b', 'bot@example.com', 'notification', 'github-actions'),
        mail('c', 'bot@example.com', 'security', 'Dependabot'),
        mail('d', 'bot@example.com', 'notification', 'Dependabot', 'me@work.example.org'),
        mail('e', 'bot@example.com', 'notification', 'Dependabot'),
      ]),
    ).toEqual([['a', 'd', 'e'], ['b'], ['c']]);
  });

  it('never fold mail Mild could not place: each needs its own answer', () => {
    expect(rows([mail('a', 'ada@example.org', null), mail('b', 'ada@example.org', null)])).toEqual([['a'], ['b']]);
  });
});
