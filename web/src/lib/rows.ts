/** A message as a list's rows name it (`holds`), which is how the panel finds its way back to one. */
export const messageKey = (m: { accountId: string; messageId: string }) => `${m.accountId}/${m.messageId}`;

const PROPOSAL = 'proposal/';

/** A proposal as For review's list names it, for hiding it while its dismissal is on its way. */
export const proposalKey = (p: { id: number }) => `${PROPOSAL}${p.id}`;

const THREAD = 'thread/';

/** A conversation as Inbox's list names it, for hiding it while its archive is on its way. */
export const threadKey = (t: { accountId: string; threadId: string }) => `${THREAD}${t.accountId}/${t.threadId}`;

export const isMessageKey = (key: string) => !key.startsWith(PROPOSAL) && !key.startsWith(THREAD);
