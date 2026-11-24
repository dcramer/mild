'use client';
import { WorkflowIcon } from 'lucide-react';
import { useState } from 'react';
import { useAction } from '@/components/action.ts';
import type { AnswerLabel } from '@/components/answer.tsx';
import { type Proposal, ProposalWords, proposalWhy } from '@/components/proposal.tsx';
import { RuleDialog } from '@/components/rule-dialog.tsx';
import { api } from '@/lib/api/endpoints.ts';
import { count } from '@/lib/format.ts';
import { setParams } from '@/lib/params.ts';
import { reveal } from '@/lib/reveal.ts';
import { proposalStart } from '@/lib/rule-start.ts';
import { proposalKey } from '@/lib/rows.ts';
import { Button, RowPresses, Sub, Td, Tr } from '@/system';

/**
 * A rule Mild proposes, drawn as mail is: from Mild, the rule as its subject and why as its text. Pressing it opens why in full; pointed at, it can be made or dismissed in place.
 */
export function ProposalRow({ proposal, labels }: { proposal: Proposal; labels: readonly AnswerLabel[] }) {
  const { hide } = useAction();
  const [making, setMaking] = useState(false);
  return (
    <Tr onOpen={() => setParams({ proposal: String(proposal.id) }, { state: { panel: true } })}>
      <Td phone="hide" className="w-px">
        <WorkflowIcon aria-hidden className="size-3.5 text-muted-foreground" />
      </Td>
      <Td className="max-w-0 phone:py-2 md:w-[18%] md:min-w-40">
        <span className="font-semibold">Mild</span>
        <span className="block truncate md:hidden">
          <ProposalWords proposal={proposal} />
        </span>
        <Sub className="md:hidden">{proposalWhy(proposal)}</Sub>
      </Td>
      <Td phone="hide" className="max-w-0 md:w-full">
        <span className="block truncate">
          <span className="font-semibold">
            <ProposalWords proposal={proposal} />
          </span>
          <span className="text-muted-foreground"> — {proposalWhy(proposal)}</span>
        </span>
      </Td>
      <RowPresses
        presses={
          <>
            <Button variant="bare" className="h-7 px-2" onClick={() => setMaking(true)}>
              Make a rule…
            </Button>
            <Button
              variant="bare"
              className="h-7 px-2"
              onClick={() => hide([proposalKey(proposal)], 'Could not dismiss it', () => api.dismissProposal(proposal.id))}
            >
              Dismiss
            </Button>
          </>
        }
      >
        <span className="text-sm">{count(proposal.agreed)} in a row</span>
      </RowPresses>
      {making ? (
        <RuleDialog
          labels={labels}
          start={proposalStart(reveal(proposal.match), proposal.labelId, proposal.disposition)}
          proposal={proposal.id}
          onClose={() => setMaking(false)}
        />
      ) : null}
    </Tr>
  );
}
