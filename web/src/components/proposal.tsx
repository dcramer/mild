'use client';
import { MatchWords } from '@/components/sender.tsx';
import { NamedLabel } from '@/components/bits.tsx';
import type { Suggestions } from '@/lib/api.ts';
import { count, outcomeName } from '@/lib/format.ts';
import { reveal } from '@/lib/reveal.ts';

/** A rule Mild proposes: where the person keeps doing something other than what a label does. */
export type Proposal = Suggestions['proposals'][number];

/** What the user has been doing to a label's mail, and what the label does instead: "You kept the last 2, but the label archives them". */
const USER_DID: Record<string, (n: string) => string> = {
  keep: (n) => `kept the last ${n}`,
  archive: (n) => `archived the last ${n}`,
  spam: (n) => `marked the last ${n} as spam`,
};
const LABEL_DOES: Record<string, string> = {
  keep: 'keeps them',
  archive: 'archives them',
  digest: 'puts them in the daily digest',
  spam: 'marks them spam',
  block: 'marks them spam and blocks the sender',
};

/** The rule in words, as a question: what it would do, to which label's mail, from whom. */
export function ProposalWords({ proposal }: { proposal: Proposal }) {
  return (
    <>
      {outcomeName(proposal.disposition)} {proposal.labelName ? <NamedLabel id={proposal.labelId}>{proposal.labelName}</NamedLabel> : null}{' '}
      <MatchWords match={reveal(proposal.match)} />?
    </>
  );
}

/** Why Mild proposes it. */
export const proposalWhy = (proposal: Proposal) =>
  `You ${USER_DID[proposal.disposition]?.(count(proposal.agreed))}, but the label ${LABEL_DOES[proposal.labelDisposition]}.`;
