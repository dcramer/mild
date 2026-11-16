import { useEffect, useState } from 'react';
import { Answer, type AnswerValue } from '@/components/answer.tsx';
import { StatusWord, Verdict } from '@/components/bits.tsx';
import { MessageBody, SignalFacts } from '@/components/message-parts.tsx';
import { SenderFacts, SenderLink, senderHref } from '@/components/sender.tsx';
import { type MessageDetail, api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, count, dateTime, money, tier } from '@/lib/format.ts';
import { Button, Code, Disclosure, Failure, Loading, Note, Panel, Section, Table, Td, TextLink, Timeline, TimelineEvent, Tr, useToast } from '@/system';

/** Open the message panel on one item of a list, so it can step through the rest. */
export type OpenMessages = (items: MessageRef[], index: number) => void;

export interface MessageRef {
  accountId: string;
  messageId: string;
  subject: string;
}

type Decision = MessageDetail['decisions'][number];
type Action = MessageDetail['actions'][number];

const CHANGE: Record<string, string> = { archive: 'Archived', spam: 'Marked spam', label: 'Labelled', undo: 'Undid a change', unsubscribe: 'Unsubscribed' };

function DecisionEvent({ d }: { d: Decision }) {
  const facts = [
    d.ruleId ? `rule ${d.ruleId}` : null,
    d.confidence === null ? null : `confidence ${d.confidence.toFixed(2)}`,
    d.model ? `${d.model}, ${count(d.inputTokens + d.outputTokens)} tokens, ${money(d.costUsd)}` : null,
    d.durationMs === null ? null : `${count(d.durationMs)} ms`,
  ].filter(Boolean);
  return (
    <TimelineEvent
      at={dateTime(d.decidedAt)}
      title={
        <>
          <span className="font-medium">{d.mode === 'observe' ? 'Suggested' : 'Decided'}</span>
          <Verdict labelName={d.labelName} disposition={d.disposition} />
        </>
      }
    >
      <p className="text-foreground">{d.reason}</p>
      <p>
        By {tier(d.stage).name.toLowerCase()}
        {facts.length > 0 ? ` · ${facts.join(' · ')}` : ''}
      </p>
    </TimelineEvent>
  );
}

function ActionEvent({ a, onUndo, busy }: { a: Action; onUndo: (id: number) => void; busy: boolean }) {
  const bad = a.status !== 'done' && a.status !== 'undone';
  const labels = (title: string, list: string[]) =>
    list.length === 0 ? null : (
      <p className="flex flex-wrap items-baseline gap-1.5">
        {title}
        {list.map((label) => (
          <Code key={label}>{label}</Code>
        ))}
      </p>
    );
  return (
    <TimelineEvent
      at={dateTime(a.createdAt)}
      title={
        <>
          <span className="font-medium">{CHANGE[a.type] ?? a.type} in Gmail</span>
          {a.status === 'done' ? null : bad ? (
            <Failure inline>{a.status}</Failure>
          ) : (
            <span className="text-muted-foreground">{a.status === 'undone' ? 'Undone' : a.status}</span>
          )}
        </>
      }
      {...(a.status === 'done' && a.type !== 'undo' && a.type !== 'unsubscribe'
        ? {
            action: (
              <Button busy={busy} onClick={() => onUndo(a.id)}>
                Undo
              </Button>
            ),
          }
        : {})}
    >
      {labels('Added', a.added)}
      {labels('Removed', a.removed)}
      <Failure>{a.error}</Failure>
    </TimelineEvent>
  );
}

/**
 * One message, whichever list it was opened from: its text on the left; on the right what sift said, the
 * answer that confirms or changes it, who sent it, and everything that happened to it. Answering moves to
 * the next item in the list.
 */
function Body({
  detail,
  onPick,
  onAnswered,
  onUndone,
}: {
  detail: MessageDetail;
  /** Show another message from the same sender in this panel. */
  onPick: (messageId: string) => void;
  onAnswered: (said: string[]) => void;
  onUndone: () => void;
}) {
  const waiting = useLoaded(
    `suggestion/${detail.accountId}/${detail.fromAddress}`,
    (signal) => api.suggestion(detail.accountId, detail.fromAddress, signal),
    120_000,
  );
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  const { busy, error, run } = useAction();
  const undo = useAction();
  const toast = useToast();
  const history = [
    ...detail.decisions.map((d) => ({ at: d.decidedAt, order: 0, node: <DecisionEvent key={`d${d.id}`} d={d} /> })),
    ...detail.actions.map((a) => ({
      at: a.createdAt,
      order: 1,
      node: (
        <ActionEvent
          key={`a${a.id}`}
          a={a}
          busy={undo.busy}
          onUndo={(id) =>
            undo.run(async () => {
              const { message } = await api.undo(id);
              toast(message);
              onUndone();
            })
          }
        />
      ),
    })),
  ].toSorted((x, y) => x.at - y.at || x.order - y.order);
  const current = detail.decisions.at(-1);
  const others = (waiting.data?.messages ?? []).filter((m) => m.messageId !== detail.messageId);
  const isWaiting = (waiting.data?.messages ?? []).some((m) => m.messageId === detail.messageId);
  const acted = detail.actions.some((a) => a.status === 'done' && a.type !== 'undo' && a.type !== 'unsubscribe');
  const labels = manage.data?.labels[detail.accountId] ?? [];

  const submit = (answer: AnswerValue) =>
    run(async () => {
      const result = await api.feedback({
        accountId: detail.accountId,
        sender: detail.fromAddress,
        messageId: detail.messageId,
        // "Only this message" settles this one and leaves the sender's other waiting mail alone.
        ...(answer.scope === 'once' && current ? { decisionId: current.id } : {}),
        ...answer,
      });
      onAnswered([result.taught ?? 'Noted for this message. No rule was made.', ...(result.fixed ? [result.fixed] : [])]);
    });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_25rem]">
      <div className="flex min-w-0 flex-col gap-10">
        <MessageBody detail={detail} />
        {others.length > 0 ? (
          <Section title="Also waiting from them" meta={count(others.length)}>
            <div className="max-h-56 overflow-y-auto">
              <Table>
                <tbody>
                  {others.map((m) => (
                    <Tr key={m.messageId} onOpen={() => onPick(m.messageId)}>
                      <Td className="max-w-0 truncate">{m.subject || '(no subject)'}</Td>
                      <Td num quiet>
                        {ago(m.receivedAt)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Section>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-8">
        <Section
          title={isWaiting ? 'sift suggests' : 'sift decided'}
          {...(current && current.mode !== 'observe' ? { meta: <StatusWord row={current} /> } : {})}
        >
          {current ? (
            <div className="flex flex-col gap-1.5">
              <Verdict labelName={current.labelName} disposition={current.disposition} unsubscribe={current.unsubscribe} />
              <p className="text-muted-foreground">{current.reason}</p>
            </div>
          ) : (
            <p className="text-muted-foreground">Not sorted yet.</p>
          )}
        </Section>

        {current && labels.length > 0 ? (
          <Section title="Your answer">
            <Answer
              key={detail.messageId}
              labels={labels}
              guess={current.labelId}
              proposed={current.disposition}
              sender={detail.fromAddress}
              acted={acted}
              busy={busy}
              error={error}
              onSubmit={submit}
            />
          </Section>
        ) : null}

        <Section title="Sender" action={<TextLink href={senderHref(detail.accountId, detail.fromAddress)}>All their mail</TextLink>}>
          <SenderFacts accountId={detail.accountId} profile={detail.sender} />
        </Section>

        <div className="flex flex-col gap-4">
          <Disclosure summary="What sift saw in it">
            <SignalFacts detail={detail} />
          </Disclosure>
          {history.length > 0 ? (
            <Disclosure summary={`Everything sift did with it · ${history.length}`}>
              <Failure>{undo.error}</Failure>
              <Timeline>{history.map((entry) => entry.node)}</Timeline>
            </Disclosure>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The panel every list opens a message in. `items` is the list it was opened from and `index` the one
 * showing, so previous, next and "answer, then the next one" all follow the list.
 */
export function MessagePanel({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: readonly MessageRef[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const toast = useToast();
  // Another message from the same sender, looked at without leaving this place in the list.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [index]);
  const messageId = picked ?? item?.messageId ?? '';
  const { data, error, loading, reload } = useLoaded(`message/${item?.accountId ?? ''}/${messageId}`, (signal) =>
    item ? api.message(item.accountId, messageId, signal) : Promise.reject(new Error('Nothing is open.')),
  );
  if (!item) return null;

  return (
    <Panel
      open
      onClose={onClose}
      title={(data?.subject ?? (picked ? '' : item.subject)) || '(no subject)'}
      subtitle={
        data ? (
          <span className="flex flex-wrap items-center gap-x-2">
            <SenderLink accountId={data.accountId} address={data.fromAddress} className="text-foreground">
              {data.fromName ?? data.fromAddress}
            </SenderLink>
            {data.fromName ? <span>{data.fromAddress}</span> : null}
            <span aria-hidden>·</span>
            <span className="tabular-nums">{dateTime(data.receivedAt)}</span>
          </span>
        ) : undefined
      }
      position={items.length > 1 ? `${index + 1} of ${items.length}` : undefined}
      onPrevious={index > 0 ? () => onIndex(index - 1) : undefined}
      onNext={index < items.length - 1 ? () => onIndex(index + 1) : undefined}
    >
      {loading ? (
        <Loading rows={6} />
      ) : data ? (
        <Body
          key={`${data.accountId}/${data.messageId}`}
          detail={data}
          onPick={setPicked}
          onUndone={reload}
          onAnswered={([taught, fixed]) => {
            toast(taught ?? 'Noted.', fixed ? { description: fixed } : {});
            if (index < items.length - 1) onIndex(index + 1);
            else onClose();
          }}
        />
      ) : (
        <Note tone="failure" title="Could not load this message">
          <p>{error}</p>
        </Note>
      )}
    </Panel>
  );
}
