'use client';
import { WorkflowIcon, XIcon } from 'lucide-react';
import { useLiveQuery } from '@tanstack/react-db';
import { useState } from 'react';
import { Thinks } from '@/components/mail.tsx';
import { ProposalWords, proposalWhy } from '@/components/proposal.tsx';
import { api } from '@/lib/api/endpoints.ts';
import { useAction } from '@/components/action.ts';
import { conversations } from '@/lib/copy.ts';
import { count } from '@/lib/format.ts';
import { proposalStart } from '@/lib/rule-start.ts';
import { reveal } from '@/lib/reveal.ts';
import { Arrived, Empty, Heads, Loading, Reader, ReaderBar, Section, Table, Td, Th, Tr } from '@/system';
import { RuleDialog } from '@/components/rule-dialog.tsx';
import { useManage, useSuggestions } from '@/lib/api/reads.ts';

/**
 * A rule Mild proposes, opened from Inbox in the list's place: the rule, why Mild proposes it, and the mail in the inbox it
 * would apply to, from the copy in this browser. Make the rule opens the rule dialog started on it; Dismiss goes back.
 */
export function ProposalReader({ id, onBack }: { id: string; onBack: () => void }) {
  const suggestions = useSuggestions();
  const proposal = suggestions.data?.proposals.find((p) => String(p.id) === id) ?? null;
  const manage = useManage();
  const [making, setMaking] = useState(false);
  const dismiss = useAction();
  const inbox = useLiveQuery({ query: (from) => from.from({ c: conversations() }).orderBy(({ c }) => c.newestAt, 'desc') });
  const match = proposal ? reveal(proposal.match) : null;
  const addresses = new Set((match?.from ?? []).map((a) => a.toLowerCase()));
  const domains = new Set((match?.fromDomain ?? []).map((d) => d.toLowerCase()));
  const theirs = (inbox.data ?? []).filter((row) => {
    const from = reveal(row.conversation.messages.at(-1)!.fromAddress).toLowerCase();
    return addresses.has(from) || domains.has(from.split('@')[1] ?? '');
  });
  const make = () => setMaking(true);
  const drop = () => proposal && dismiss.run(() => api.dismissProposal(proposal.id), onBack);
  const bar = (
    <ReaderBar
      back="Inbox"
      onBack={onBack}
      presses={
        proposal
          ? [
              { label: 'Make the rule…', key: 'm', onPress: make },
              { label: 'Dismiss', key: 'Shift+d', quiet: true, onPress: drop },
            ]
          : []
      }
    />
  );
  const thumbs = proposal
    ? [
        { label: 'Make the rule…', icon: <WorkflowIcon aria-hidden />, onPress: make },
        { label: 'Dismiss', icon: <XIcon aria-hidden />, onPress: drop },
      ]
    : [];
  if (!proposal)
    return (
      <Reader bar={bar} title="Mild no longer proposes it">
        {suggestions.loading ? <Loading rows={3} /> : <Empty>It was made into a rule or dismissed.</Empty>}
      </Reader>
    );
  return (
    <Reader bar={bar} thumbs={thumbs} title={<ProposalWords proposal={proposal} />} answer={<p className="text-muted-foreground">{proposalWhy(proposal)}</p>}>
      <Section title="In your inbox" meta={count(theirs.length)}>
        {theirs.length === 0 ? (
          <Empty>None of their mail is in your inbox.</Empty>
        ) : (
          <Table dense>
            <Heads>
              <Th>Subject</Th>
              <Th>Label</Th>
              <Th num>Received</Th>
            </Heads>
            <tbody>
              {theirs.map((row) => (
                <Tr key={row.key}>
                  <Td className="w-full max-w-0">
                    <span className="block truncate">{reveal(row.conversation.messages.at(-1)!.subject) || '(no subject)'}</span>
                  </Td>
                  <Td quiet className="whitespace-nowrap">
                    <Thinks
                      thinks={
                        row.conversation.thinks && {
                          ...row.conversation.thinks,
                          labelName: manage.data?.labels.find((l) => l.id === row.labelId)?.name ?? null,
                        }
                      }
                    />
                  </Td>
                  <Td num quiet>
                    <Arrived at={row.newestAt} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
      {making ? (
        <RuleDialog
          labels={manage.data?.labels ?? []}
          start={proposalStart(match!, proposal.labelId, proposal.disposition)}
          proposal={proposal.id}
          onClose={() => setMaking(false)}
        />
      ) : null}
    </Reader>
  );
}
