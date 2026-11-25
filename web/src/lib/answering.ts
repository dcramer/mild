import { type Party, readAddresses, typed } from './addresses.ts';
import type { ManageState, MessageDetail } from './api/endpoints.ts';
import { type Draft, type Writing, emptyDraft } from './compose.ts';
import { dateTime } from './format.ts';
import { reveal } from './reveal.ts';

/** How a reply or a forward starts, from the message it answers, and the addresses it can be sent from. */

/** An address mail can be from: a mailbox's own, or one of its aliases, and whether Google lets Mild send from that mailbox. */
export interface From {
  address: string;
  accountId: string;
  canSend: boolean;
}

export const addressesOf = (account: ManageState['accounts'][number]): From[] =>
  [account.email, ...account.aliases].map((address) => ({ address, accountId: account.id, canSend: account.canSend }));

/** "Re: " once, as Gmail and the server put it. */
export const answering = (subject: string) => (/^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`);
/** "Fwd: " once. */
const forwarding = (subject: string) => (/^fwd?:/i.test(subject.trim()) ? subject.trim() : `Fwd: ${subject.trim()}`);

const QUOTE = '---------- Forwarded message ---------';
/** Where Gmail's quote under a reply starts: its "On …, … wrote:" line, then the message, each line after "> ". */
const REPLY_QUOTE = /^On .+ wrote:\n\n>/m;

/** What the person wrote of `text`, without the message a forward or a reply quotes under it. */
export function ownOf(text: string): string {
  const forwarded = text.indexOf(QUOTE);
  const replied = text.search(REPLY_QUOTE);
  const at = Math.min(...[forwarded, replied].filter((i) => i !== -1), text.length);
  return text.slice(0, at);
}

/** The message a reply answers, quoted as Gmail quotes it under what is written; null when Mild holds no text of it. */
export function quoteOf(message: MessageDetail): string | null {
  const body = reveal(message.body)?.trimEnd();
  if (!body) return null;
  return [`On ${dateTime(message.receivedAt)}, ${typed(senderOf(message))} wrote:`, '', ...body.split('\n').map((line) => (line ? `> ${line}` : '>'))].join(
    '\n',
  );
}

/** The text a reply goes with: what was written, and under it the quote, unless ••• put it there already. */
export const withQuote = (draft: Draft, quote: string | null) => (quote && !draft.quoted ? `${draft.text.trimEnd()}\n\n${quote}` : draft.text);

const shown = (list: MessageDetail['to']): Party[] => list.map((p) => ({ address: reveal(p.address), ...(p.name ? { name: reveal(p.name) } : {}) }));
const senderOf = (message: MessageDetail): Party => ({ address: reveal(message.fromAddress), ...(message.fromName ? { name: reveal(message.fromName) } : {}) });
const owns = (choices: readonly From[]) => {
  const own = new Set(choices.map((c) => c.address.toLowerCase()));
  return (p: Party) => own.has(p.address.toLowerCase());
};
/** The address the message was sent to, of those it can be answered from. */
const answeredFrom = (message: MessageDetail, choices: readonly From[]) =>
  [...shown(message.to), ...shown(message.cc)].find(owns(choices))?.address ?? choices[0].address;

function replyDraft(message: MessageDetail, choices: readonly From[], all: boolean): Draft {
  const isOwn = owns(choices);
  const sender = senderOf(message);
  const asked = message.headers['reply-to'] ? readAddresses(reveal(message.headers['reply-to'])).parties : [];
  const recipients = [...shown(message.to), ...shown(message.cc)];
  // Mail the person sent themselves is answered as Gmail does: to whoever it went to.
  const to = isOwn(sender) ? shown(message.to).filter((p) => !isOwn(p)) : asked.length > 0 ? asked : [sender];
  const answered = new Set(to.map((p) => p.address.toLowerCase()));
  const cc = all ? recipients.filter((p) => !isOwn(p) && !answered.has(p.address.toLowerCase())) : [];
  return emptyDraft(answeredFrom(message, choices), { to, cc, showCc: cc.length > 0 });
}

/** How a reply or forward of `message` starts. */
export const startOf = (message: MessageDetail, choices: readonly From[], what: Exclude<Writing, { kind: 'new' }>) =>
  what.kind === 'reply' ? replyDraft(message, choices, what.all) : forwardDraft(message, choices);

/** Gmail's quote of a forwarded message, under two empty lines for the reader's own text. Its files go with it (`ForwardedFiles`). */
function forwardDraft(message: MessageDetail, choices: readonly From[]): Draft {
  const subject = reveal(message.subject);
  const quoted = [
    QUOTE,
    `From: ${typed(senderOf(message))}`,
    `Date: ${dateTime(message.receivedAt)}`,
    `Subject: ${subject}`,
    ...(message.to.length > 0 ? [`To: ${shown(message.to).map(typed).join(', ')}`] : []),
    ...(message.cc.length > 0 ? [`Cc: ${shown(message.cc).map(typed).join(', ')}`] : []),
    '',
    reveal(message.body) ?? '',
  ];
  return emptyDraft(answeredFrom(message, choices), { subject: forwarding(subject), text: `\n\n${quoted.join('\n')}` });
}

/** What a saved draft answers, as Mild keeps it. */
export const ofWhat = (what: Writing) =>
  what.kind === 'new'
    ? ({ kind: 'new' } as const)
    : what.kind === 'reply'
      ? ({ kind: 'reply', messageId: what.messageId, all: what.all } as const)
      : ({ kind: 'forward', messageId: what.messageId } as const);
