import { type ReactNode, useEffect, useState } from 'react';
import { Answer, type AnswerValue } from '@/components/answer.tsx';
import { DispositionBadge, Result } from '@/components/bits.tsx';
import { MessageBody, Part, SenderFacts, Unsubscribe } from '@/components/message-parts.tsx';
import { type MessageDetail, api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, count, dateTime, money, tier } from '@/lib/format.ts';
import { cn } from '@/lib/utils';
import { Code, Disclosure, Loading, Note, Panel } from '@/system';

/** Open the message panel on one item of a list, so it can step through the rest. */
export type OpenMessages = (items: MessageRef[], index: number) => void;

export interface MessageRef {
  accountId: string;
  messageId: string;
  subject: string;
}

function Labels({ title, labels }: { title: string; labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-muted-foreground">{title}</span>
      {labels.map((label) => (
        <Code key={label}>{label}</Code>
      ))}
    </p>
  );
}

type Decision = MessageDetail['decisions'][number];
type Action = MessageDetail['actions'][number];

/** One thing that happened to the message: what, when, then the detail. */
function Entry({ what, at, children }: { what: ReactNode; at: number; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-1.5 border-t border-dashed border-(--rule) py-3.5 first:border-t-0 first:pt-0">
      <p className="flex flex-wrap items-center gap-2">
        {what}
        <span className="ml-auto text-[13px] text-muted-foreground tabular-nums">{dateTime(at)}</span>
      </p>
      {children}
    </li>
  );
}

function DecisionEntry({ d }: { d: Decision }) {
  const facts = [
    tier(d.stage).name,
    d.ruleId ? `rule ${d.ruleId}` : null,
    d.confidence === null ? null : `confidence ${d.confidence.toFixed(2)}`,
    d.model ? `${d.model} · ${count(d.inputTokens + d.outputTokens)} tokens · ${money(d.costUsd)}` : null,
    d.durationMs === null ? null : `${count(d.durationMs)} ms`,
    d.mode === 'observe' ? 'observing' : null,
  ].filter(Boolean);
  return (
    <Entry
      at={d.decidedAt}
      what={
        <>
          <DispositionBadge disposition={d.disposition} />
          {d.labelName ? <span className="font-medium">{d.labelName}</span> : null}
        </>
      }
    >
      <p>{d.reason}</p>
      <p className="text-[13px] text-muted-foreground">{facts.join(' · ')}</p>
      {d.actionId === null ? (
        <div className="text-[13px]">
          <Result row={d} />
        </div>
      ) : null}
    </Entry>
  );
}

function ActionEntry({ a }: { a: Action }) {
  const bad = a.status !== 'done' && a.status !== 'undone';
  return (
    <Entry
      at={a.createdAt}
      what={
        <>
          <span className="font-medium">Changed in Gmail</span>
          <span className={bad ? 'font-medium text-destructive' : 'text-muted-foreground'}>
            {a.type} {a.status}
          </span>
          <span className="font-mono text-[13px] text-muted-foreground">#{a.id}</span>
        </>
      }
    >
      <div className="flex flex-col gap-1 text-sm">
        <Labels title="Added" labels={a.added} />
        <Labels title="Removed" labels={a.removed} />
        {a.error ? <p className="text-destructive">{a.error}</p> : null}
        {a.status === 'done' ? (
          <p className="text-muted-foreground">
            Undo it under{' '}
            <a className="text-foreground underline underline-offset-2" href="#changes">
              Changes
            </a>
            .
          </p>
        ) : null}
      </div>
    </Entry>
  );
}

/** Where the decision that stands for a message has got to, in a sentence. */
function standing(d: Decision): string {
  if (d.mode === 'observe') return 'A suggestion. Nothing in Gmail was changed.';
  if (d.outcome === null) return 'Waiting to be carried out in Gmail.';
  if (d.outcome === 'done') return 'Done in Gmail.';
  if (d.outcome === 'none') return 'Nothing needed doing in Gmail.';
  return d.outcomeDetail ? `Not carried out: ${d.outcomeDetail}.` : 'Not carried out.';
}

/**
 * One message, whichever list it was opened from: its text, what sift decided and why, what sift knows
 * about the sender, and the answer that confirms or changes the decision. Answering moves to the next
 * item in the list.
 */
function Body({
  detail,
  onPick,
  onAnswered,
}: {
  detail: MessageDetail;
  /** Show another message from the same sender in this panel. */
  onPick: (messageId: string) => void;
  onAnswered: (said: string[]) => void;
}) {
  const waiting = useLoaded(
    `suggestion/${detail.accountId}/${detail.fromAddress}`,
    (signal) => api.suggestion(detail.accountId, detail.fromAddress, signal),
    120_000,
  );
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  const { busy, error, run } = useAction();
  const history = [
    ...detail.decisions.map((d) => ({ at: d.decidedAt, order: 0, node: <DecisionEntry key={`d${d.id}`} d={d} /> })),
    ...detail.actions.map((a) => ({ at: a.createdAt, order: 1, node: <ActionEntry key={`a${a.id}`} a={a} /> })),
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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-8">
        <MessageBody untitled detail={detail} />
        {others.length > 0 ? (
          <Part title={`Also waiting from this sender · ${others.length}`}>
            <ul className="-mx-2 flex max-h-56 flex-col overflow-y-auto">
              {others.map((m) => (
                <li key={m.messageId}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full cursor-pointer items-baseline gap-3 px-2 py-1.5 text-left text-sm text-muted-foreground',
                      'hover:bg-(--fill) hover:text-foreground',
                    )}
                    onClick={() => onPick(m.messageId)}
                  >
                    <span className="min-w-0 flex-1 truncate">{m.subject || '(no subject)'}</span>
                    <span className="shrink-0 text-[13px] tabular-nums">{ago(m.receivedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Part>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-7">
        <Part title={isWaiting ? 'sift suggests' : 'sift decided'}>
          {current ? (
            <>
              <p className="flex flex-wrap items-center gap-2">
                {current.labelName ? <span className="font-medium">{current.labelName}</span> : null}
                {current.labelId === null && current.disposition === 'review' ? null : (
                  <DispositionBadge would={current.mode === 'observe'} disposition={current.disposition} />
                )}
                {current.labelId === null && current.disposition === 'review' ? <span className="font-medium">Could not place it</span> : null}
                {current.unsubscribe ? <span className="text-sm text-muted-foreground">and unsubscribe</span> : null}
              </p>
              <p className="text-sm text-muted-foreground">
                {current.reason} <span className="whitespace-nowrap">({tier(current.stage).name})</span>
              </p>
              <p className="text-sm text-muted-foreground">{standing(current)}</p>
            </>
          ) : (
            <p className="text-muted-foreground">Not sorted yet.</p>
          )}
          {history.length > 1 ? (
            <Disclosure summary={`Everything sift did with it · ${history.length}`}>
              <ol className="text-foreground">{history.map((entry) => entry.node)}</ol>
            </Disclosure>
          ) : null}
        </Part>

        <Part title="This sender">
          <SenderFacts sender={detail.sender} />
          <Unsubscribe detail={detail} />
        </Part>

        {current && labels.length > 0 ? (
          <Answer
            key={detail.messageId}
            labels={labels}
            guess={current.labelId}
            sender={detail.fromAddress}
            acted={acted}
            busy={busy}
            error={error}
            onSubmit={submit}
          />
        ) : null}
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
  onChanged,
}: {
  items: readonly MessageRef[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** Something was answered: lists behind the panel are out of date. */
  onChanged: () => void;
}) {
  const item = items[index];
  // Another message from the same sender, looked at without leaving this place in the list.
  const [picked, setPicked] = useState<string | null>(null);
  const [said, setSaid] = useState<string[]>([]);
  useEffect(() => setPicked(null), [index]);
  const messageId = picked ?? item?.messageId ?? '';
  const { data, error, loading } = useLoaded(`message/${item?.accountId ?? ''}/${messageId}`, (signal) =>
    item ? api.message(item.accountId, messageId, signal) : Promise.reject(new Error('Nothing is open.')),
  );
  if (!item) return null;

  return (
    <Panel
      open
      onClose={onClose}
      title={(data?.subject ?? (picked ? '' : item.subject)) || '(no subject)'}
      position={items.length > 1 ? `${index + 1} of ${items.length}` : undefined}
      onPrevious={index > 0 ? () => onIndex(index - 1) : undefined}
      onNext={index < items.length - 1 ? () => onIndex(index + 1) : undefined}
    >
      <div className="flex flex-col gap-6">
        {said.length > 0 ? (
          <Note title="Learned">
            <ul aria-live="polite" className="flex flex-col gap-0.5">
              {said.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Note>
        ) : null}
        {loading ? (
          <Loading rows={6} />
        ) : data ? (
          <Body
            key={`${data.accountId}/${data.messageId}`}
            detail={data}
            onPick={setPicked}
            onAnswered={(lines) => {
              setSaid(lines);
              onChanged();
              if (index < items.length - 1) onIndex(index + 1);
              else onClose();
            }}
          />
        ) : (
          <Note tone="failure" title="Could not load this message">
            <p>{error}</p>
          </Note>
        )}
      </div>
    </Panel>
  );
}
