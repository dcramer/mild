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
}

export type Proposer = (input: ProposalInput) => Promise<{ drafts: LabelDraft[]; usage?: Usage } | { failed: string; usage?: Usage }>;

export const PROPOSAL_PROMPT = `You suggest email labels for the owner of a mailbox, from what they say they want.

How the labels are used:
- A model reads each new email and gives it one of the owner's labels. Each label's description is all it
  has to go on, so a description says plainly what belongs and what does not.
- The label decides what happens to the email: keep (it stays in the inbox), archive (it leaves the inbox
  but stays in Gmail and in search), or spam. A label may also mark its mail read, and may unsubscribe
  from the sender's mailing list.
- There is already a label "Everything else" that keeps mail none of the labels fit. Mail needs no label to
  stay in the inbox.
- The owner can also make rules for one sender or domain ("from this address: archive"). What depends on
  who sent the mail belongs in a rule, not a label.

What makes a good label:
- It is narrow enough that one action is right for everything in it. "Cold outreach" (unsolicited pitches
  from strangers, sales, recruiting, follow-up sequences) is a good label: nobody wants it, so archiving and
  unsubscribing is right for all of it. "Marketing" is a poor label: whether a company's promotions are
  wanted depends on the company, so one action is wrong for much of it.
- It serves something the owner said. Do not add labels for goals they did not state.
- A label that keeps mail earns its place only when it protects mail another label might move, such as mail
  a person wrote to them among automated mail that is archived.
- Spam is only for deceit: scams and phishing. Unsubscribe only where the sender never had the owner's
  permission, such as cold outreach; unsubscribing from a scam confirms the address works.
- Propose between one and ${MAX_DRAFTS} labels, fewer if fewer serve what they said. None may repeat a
  label they already have.

Call ${PROPOSAL_TOOL} exactly once. Names are short and plain. A description is one or two sentences:
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

/** The drafts in the tool's arguments, dropping any that is not usable; null when there are none. */
export function readDrafts(args: unknown): LabelDraft[] | null {
  const labels = (args as { labels?: unknown } | undefined)?.labels;
  if (!Array.isArray(labels)) return null;
  const drafts = labels.flatMap((raw: Record<string, unknown>): LabelDraft[] => {
    const name = tidy(raw['name'], MAX_NAME);
    const description = tidy(raw['description'], MAX_DESCRIPTION);
    const disposition = DRAFT_ACTIONS.find((a) => a === raw['action']);
    if (!name || !description || !disposition) return [];
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
  return drafts.length > 0 ? drafts.slice(0, MAX_DRAFTS) : null;
}
