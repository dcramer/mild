import type { Usage } from './stages/model.ts';
import { type Label, LEAVE_IN_INBOX_NAME } from './types.ts';

export const PROPOSAL_TOOL = 'propose_labels';

/** More than this and the model weighs too many on every message, and the person has too many to answer with. */
export const MAX_DRAFTS = 8;

/** The actions a proposal may suggest. Blocking is never suggested: a mislabelled security notice would block a real company. */
export const DRAFT_ACTIONS = ['keep', 'archive', 'digest', 'spam'] as const;

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
  /** What the person wants of Mild, in their own words. */
  goal: string;
  /** Labels they have already, which a proposal must not repeat. */
  labels: readonly Pick<Label, 'name' | 'description'>[];
}

export type Proposer = (input: ProposalInput) => Promise<{ drafts: LabelDraft[]; note?: string; usage?: Usage } | { failed: string; usage?: Usage }>;

export const PROPOSAL_PROMPT = `You suggest email labels for the owner of a mailbox, from what they say they want.

How the labels are used:
- A model reads each new email and gives it one of the owner's labels, or leaves it in the inbox, unlabelled,
  when none fits. Each label's description is all it has to go on, so a description says plainly what
  belongs and what does not.
- Mail needs no label to stay in the inbox. A label is mostly for mail the owner wants out of the way:
  archive (it leaves the inbox but stays in Gmail and in search), digest, or spam. A label may also mark its
  mail read, and may unsubscribe from the sender's mailing list.
- Digest takes mail out of the inbox as archive does, and once a day puts one email in the inbox listing
  it, with what looks worth a look on top. It is the safer choice for mail that is routine but where now and
  then one matters: notifications, alerts and reports from services (a failed build among passing ones, a
  payment that did not go through). Archive is for mail the owner never needs to see again.
- A label can instead keep its mail in the inbox and tag it in Gmail: for a kind of mail the owner asks to
  have tagged, or never wants to miss where another label might take it ("Bills to pay", beside a
  "Receipts" label that archives). Sorting the inbox into categories is not what they want.
- The owner can also make rules for one sender or domain ("from this address: archive"). What depends on
  who sent the mail belongs in a rule, not a label.

What makes a good label:
- It is narrow enough that one action is right for everything in it. "Cold outreach" (unsolicited pitches
  from strangers, sales, recruiting, follow-up sequences) is a good label: nobody wants it, so archiving and
  unsubscribing is right for all of it. "Marketing" is a poor label: whether a company's promotions are
  wanted depends on the company, so one action is wrong for much of it.
- It serves something the owner said. Do not add labels for goals they did not state.
- Where a label might catch mail they never want to miss, its description says so: a "Receipts" label for
  someone who never wants to miss a bill leaves out bills still to be paid.
- Spam is only for deceit: scams and phishing. Unsubscribe only where the sender never had the owner's
  permission, such as cold outreach; unsubscribing from a scam confirms the address works.
- Propose up to ${MAX_DRAFTS} labels, fewer if fewer serve what they said. None may repeat or overlap a label
  they already have: no email should fit both a new label and one of theirs.
- Say in the note what of what they asked your labels leave out: what a label of theirs covers already (name
  it), what belongs in a rule for a sender, or what labels cannot do. When all of it is like that, propose no
  labels and say why in the note. Otherwise leave the note empty.

Call ${PROPOSAL_TOOL} exactly once. Names are short and plain, in Title Case ("Cold Outreach"). A description is one or two sentences:
what belongs, and what looks similar but does not. The reason says in a few words which part of what the
owner said the label serves.`;

/** The user message for a proposal. */
export function buildProposalPrompt(input: ProposalInput): string {
  return ['# What the owner wants', input.goal.trim(), '', '# Labels they have', ...input.labels.map((l) => `- ${l.name}: ${l.description}`)].join('\n');
}

const MAX_NAME = 60;
const MAX_DESCRIPTION = 600;
const MAX_WHY = 200;

const tidy = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

const MAX_NOTE = 400;

/**
 * The drafts and note in the tool's arguments, dropping any draft that is not usable or is named like one of
 * `labels` or an earlier draft, which would refuse the whole batch when accepted; null when that leaves
 * neither a draft nor a note.
 */
export function readProposal(args: unknown, labels: ProposalInput['labels']): { drafts: LabelDraft[]; note?: string } | null {
  const raw = (args ?? {}) as { labels?: unknown; note?: unknown };
  const proposed = raw.labels;
  if (!Array.isArray(proposed)) return null;
  // Leave in inbox is not among `labels`, but no label may take its name either.
  const taken = new Set([...labels.map((l) => l.name.toLowerCase()), LEAVE_IN_INBOX_NAME.toLowerCase()]);
  const drafts = proposed.flatMap((raw: Record<string, unknown>): LabelDraft[] => {
    const name = tidy(raw['name'], MAX_NAME);
    const description = tidy(raw['description'], MAX_DESCRIPTION);
    const disposition = DRAFT_ACTIONS.find((a) => a === raw['action']);
    if (!name || !description || !disposition || taken.has(name.toLowerCase())) return [];
    taken.add(name.toLowerCase());
    return [
      {
        name,
        description,
        disposition,
        ...(raw['markRead'] === true && disposition !== 'spam' ? { markRead: true as const } : {}),
        ...(raw['unsubscribe'] === true ? { unsubscribe: true as const } : {}),
        why: tidy(raw['why'], MAX_WHY),
      },
    ];
  });
  const note = tidy(raw.note, MAX_NOTE);
  if (drafts.length === 0 && note === '') return null;
  return { drafts: drafts.slice(0, MAX_DRAFTS), ...(note === '' ? {} : { note }) };
}
