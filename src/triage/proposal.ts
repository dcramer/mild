import type { Usage } from './stages/model.ts';
import type { Label } from './types.ts';

export const PROPOSAL_TOOL = 'propose_labels';

/** More than this and the model weighs too many on every message, and the person has too many to answer with. */
export const MAX_DRAFTS = 8;

/** The actions a proposal may suggest. Blocking is never suggested: a mislabelled security notice would block a real company. */
export const DRAFT_ACTIONS = ['keep', 'archive', 'spam'] as const;

/** A label the model suggests. Nothing is made until the person accepts it, edited or not. */
export interface LabelDraft {
  name: string;
  description: string;
  disposition: (typeof DRAFT_ACTIONS)[number];
  markRead?: true;
  unsubscribe?: true;
  /** Which part of what the person asked for it serves. */
  why: string;
}

export interface ProposalInput {
  /** What the person wants of Sift, in their own words. */
  goal: string;
  /** Labels they have already, which a proposal must not repeat. */
  labels: readonly Pick<Label, 'name' | 'description'>[];
  /** What they already said always stays in their inbox; empty if nothing. */
  inbox: string;
}

/** What the model suggests: labels, what always stays in the inbox to add to what the person said before, and a note. */
export interface Proposal {
  drafts: LabelDraft[];
  /** Empty when they asked for nothing like it. */
  inbox: string;
  note?: string;
}

export type Proposer = (input: ProposalInput) => Promise<(Proposal & { usage?: Usage }) | { failed: string; usage?: Usage }>;

export const PROPOSAL_PROMPT = `You suggest email labels for the owner of a mailbox, from what they say they want.

How the labels are used:
- A model reads each new email and gives it one of the owner's labels, or leaves it in the inbox when none
  fits. Each label's description is all it has to go on, so a description says plainly what belongs and what
  does not.
- Mail needs no label to stay in the inbox. A label is for mail the owner wants out of the way: archive (it
  leaves the inbox but stays in Gmail and in search) or spam. A label may also mark its mail read, and may
  unsubscribe from the sender's mailing list.
- A label can instead keep its mail in the inbox and only tag it in Gmail. Suggest that only for a kind of
  mail the owner asks to have tagged; sorting the inbox into categories is not what they want.
- What the owner never wants to miss ("never miss a bill") is not a label. Say it in inbox: a short phrase
  naming the kinds of mail that always stay in the inbox, even when a label would also fit them, such as
  "bills I still have to pay; mail a person wrote to me". The model reads it on every email. Leave it empty
  when they asked for nothing like that, and add only what they have not already said.
- The owner can also make rules for one sender or domain ("from this address: archive"). What depends on
  who sent the mail belongs in a rule, not a label.

What makes a good label:
- It is narrow enough that one action is right for everything in it. "Cold outreach" (unsolicited pitches
  from strangers, sales, recruiting, follow-up sequences) is a good label: nobody wants it, so archiving and
  unsubscribing is right for all of it. "Marketing" is a poor label: whether a company's promotions are
  wanted depends on the company, so one action is wrong for much of it.
- It serves something the owner said. Do not add labels for goals they did not state.
- It leaves out what they said always stays in the inbox: a "Receipts" label for someone who never wants to
  miss a bill says that bills still to be paid do not belong.
- Spam is only for deceit: scams and phishing. Unsubscribe only where the sender never had the owner's
  permission, such as cold outreach; unsubscribing from a scam confirms the address works.
- Propose up to ${MAX_DRAFTS} labels, fewer if fewer serve what they said. None may repeat or overlap a label
  they already have: no email should fit both a new label and one of theirs.
- Say in the note what of what they asked your labels and inbox leave out: what a label of theirs covers
  already (name it), what belongs in a rule for a sender, or what labels cannot do. When all of it is like
  that, propose no labels and say why in the note. Otherwise leave the note empty.

Call ${PROPOSAL_TOOL} exactly once. Names are short and plain, in Title Case ("Cold Outreach"). A description is one or two sentences:
what belongs, and what looks similar but does not. The reason says in a few words which part of what the
owner said the label serves.`;

/** The user message for a proposal. */
export function buildProposalPrompt(input: ProposalInput): string {
  return [
    '# What the owner wants',
    input.goal.trim(),
    '',
    '# Labels they have',
    ...input.labels.map((l) => `- ${l.name}: ${l.description}`),
    '',
    '# What they said always stays in their inbox',
    input.inbox.trim() || '(nothing yet)',
  ].join('\n');
}

const MAX_NAME = 60;
const MAX_DESCRIPTION = 600;
const MAX_WHY = 200;

const tidy = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

const MAX_NOTE = 400;
const MAX_INBOX = 600;

/**
 * The drafts, inbox and note in the tool's arguments, dropping any draft that is not usable or is named like
 * one of `labels` or an earlier draft, which would refuse the whole batch when accepted; null when that leaves
 * nothing.
 */
export function readProposal(args: unknown, labels: ProposalInput['labels']): Proposal | null {
  const raw = (args ?? {}) as { labels?: unknown; inbox?: unknown; note?: unknown };
  const proposed = Array.isArray(raw.labels) ? raw.labels : [];
  const taken = new Set(labels.map((l) => l.name.toLowerCase()));
  const drafts = proposed.flatMap((item: Record<string, unknown>): LabelDraft[] => {
    const name = tidy(item['name'], MAX_NAME);
    const description = tidy(item['description'], MAX_DESCRIPTION);
    const disposition = DRAFT_ACTIONS.find((a) => a === item['action']);
    if (!name || !description || !disposition || taken.has(name.toLowerCase())) return [];
    taken.add(name.toLowerCase());
    return [
      {
        name,
        description,
        disposition,
        ...(item['markRead'] === true && disposition !== 'spam' ? { markRead: true as const } : {}),
        ...(item['unsubscribe'] === true ? { unsubscribe: true as const } : {}),
        why: tidy(item['why'], MAX_WHY),
      },
    ];
  });
  const inbox = tidy(raw.inbox, MAX_INBOX);
  const note = tidy(raw.note, MAX_NOTE);
  if (drafts.length === 0 && inbox === '' && note === '') return null;
  return { drafts: drafts.slice(0, MAX_DRAFTS), inbox, ...(note === '' ? {} : { note }) };
}
