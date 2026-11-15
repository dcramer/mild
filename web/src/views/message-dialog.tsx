import type { ReactNode } from 'react';
import { DispositionBadge, Result } from '@/components/bits.tsx';
import { MessageBody, Part, SenderFacts, Unsubscribe } from '@/components/message-parts.tsx';
import { type MessageDetail, api, useLoaded } from '@/lib/api.ts';
import { count, dateTime, money, tier } from '@/lib/format.ts';
import { Code, Dialog, Loading, Note } from '@/system';

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
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{dateTime(at)}</span>
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
      <p className="text-xs text-muted-foreground">{facts.join(' · ')}</p>
      {d.actionId === null ? (
        <div className="text-xs">
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
          <span className="font-mono text-xs text-muted-foreground">#{a.id}</span>
        </>
      }
    >
      <div className="flex flex-col gap-1 text-[13px]">
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

function Body({ detail, reload }: { detail: MessageDetail; reload: () => void }) {
  const history = [
    ...detail.decisions.map((d) => ({ at: d.decidedAt, order: 0, node: <DecisionEntry key={`d${d.id}`} d={d} /> })),
    ...detail.actions.map((a) => ({ at: a.createdAt, order: 1, node: <ActionEntry key={`a${a.id}`} a={a} /> })),
  ].toSorted((x, y) => x.at - y.at || x.order - y.order);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-6 md:grid-cols-[minmax(0,1fr)_22rem]">
      <MessageBody untitled detail={detail} />
      <div className="flex min-w-0 flex-col gap-6">
        <Part title="What sift did">
          {history.length === 0 ? <p className="text-muted-foreground">Not sorted yet.</p> : <ol>{history.map((entry) => entry.node)}</ol>}
        </Part>
        <Part title="This sender">
          <SenderFacts sender={detail.sender} />
          <Unsubscribe detail={detail} onDone={reload} />
        </Part>
      </div>
    </div>
  );
}

/** Everything sift knows about one message: its text if held, each decision and each mailbox change, and its sender. */
export function MessageDialog({ target, onClose }: { target: MessageRef | null; onClose: () => void }) {
  return target ? <Loaded key={`${target.accountId}/${target.messageId}`} target={target} onClose={onClose} /> : null;
}

function Loaded({ target, onClose }: { target: MessageRef; onClose: () => void }) {
  const { data, error, loading, reload } = useLoaded(`${target.accountId}/${target.messageId}`, (signal) =>
    api.message(target.accountId, target.messageId, signal),
  );
  return (
    <Dialog open wide onClose={onClose} title={(data?.subject ?? target.subject) || '(no subject)'}>
      {loading ? (
        <div className="-mx-4">
          <Loading />
        </div>
      ) : data ? (
        <Body detail={data} reload={reload} />
      ) : (
        <Note tone="failure" title="Could not load this message">
          <p>{error}</p>
        </Note>
      )}
    </Dialog>
  );
}
