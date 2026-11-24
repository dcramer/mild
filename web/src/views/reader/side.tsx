'use client';
import { History, historyCount } from '@/components/message-history.tsx';
import { SeenFacts } from '@/components/message-parts.tsx';
import { SenderFacts, senderHref } from '@/components/sender.tsx';
import type { MessageDetail, SuggestionDetail } from '@/lib/api/endpoints.ts';
import type { Loaded } from '@/lib/api/query.ts';
import { count } from '@/lib/format.ts';
import type { MessageRef } from '@/lib/open-messages.ts';
import { reveal } from '@/lib/reveal.ts';
import type { RuleStart } from '@/lib/rule-start.ts';
import { Ago, Disclosure, Heads, Section, Table, Td, TextLink, Th, Tr } from '@/system';

/** Beside a message opened from anywhere but Inbox: what Mild saw, the sender, what else of theirs waits, and the history. */
export function MessageSide({
  detail,
  waiting,
  onRule,
  onPick,
  onUndone,
}: {
  detail: MessageDetail;
  /** The sender's mail waiting on an answer, this message among it. */
  waiting: Loaded<SuggestionDetail>;
  onRule: (start: RuleStart) => void;
  onPick: (message: Pick<MessageRef, 'accountId' | 'messageId'>) => void;
  onUndone: () => void;
}) {
  const others = (waiting.data?.messages ?? []).filter((m) => m.accountId !== detail.accountId || m.messageId !== detail.messageId);
  return (
    <>
      <SeenFacts detail={detail} onRule={onRule} />
      <Section title="Sender" action={<TextLink href={senderHref(reveal(detail.fromAddress))}>All their mail</TextLink>}>
        <SenderFacts profile={detail.sender} />
      </Section>
      {others.length > 0 ? (
        <Section title="Also waiting" meta={count(others.length)}>
          <div className="max-h-56 overflow-y-auto">
            <Table>
              <Heads>
                <Th>Message</Th>
                <Th num>Received</Th>
              </Heads>
              <tbody>
                {others.map((m) => (
                  <Tr key={`${m.accountId}/${m.messageId}`} onOpen={() => onPick(m)}>
                    <Td className="w-full max-w-0 truncate">{reveal(m.subject) || '(no subject)'}</Td>
                    <Td num quiet>
                      <Ago at={m.receivedAt} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Section>
      ) : null}
      {/* After "Also waiting" has loaded, which would otherwise push it down from under the pointer. */}
      {historyCount(detail) > 0 && !waiting.loading ? (
        <Disclosure summary={`History · ${historyCount(detail)}`}>
          <History detail={detail} onUndone={onUndone} />
        </Disclosure>
      ) : null}
    </>
  );
}
