import type { ReactNode } from 'react';
import { DispositionBadge, Empty, Result, TierLabel } from '@/components/bits.tsx';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { type MessageDetail, api, useLoaded } from '@/lib/api.ts';
import { count, dateTime, money } from '@/lib/format.ts';

export interface MessageRef {
  accountId: string;
  messageId: string;
  subject: string;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Labels({ title, labels }: { title: string; labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="w-14 text-muted-foreground">{title}</span>
      {labels.map((label) => (
        <span key={label} className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono">
          {label}
        </span>
      ))}
    </span>
  );
}

type Decision = MessageDetail['decisions'][number];
type Action = MessageDetail['actions'][number];

function DecisionEntry({ d }: { d: Decision }) {
  const facts = [
    d.confidence === null ? null : `confidence ${d.confidence.toFixed(2)}`,
    d.ruleId ? `rule ${d.ruleId}` : null,
    d.model ? `${d.model} · ${count(d.inputTokens + d.outputTokens)} tokens · ${money(d.costUsd)}` : 'no model used',
    d.durationMs === null ? null : `${count(d.durationMs)} ms`,
    d.mode === 'observe' ? 'observe mode' : null,
  ].filter(Boolean);
  return (
    <li className="sheet bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Decision</span>
        <DispositionBadge disposition={d.disposition} />
        {d.label ? <span className="font-mono text-xs text-muted-foreground">{d.label}</span> : null}
        <span className="ml-auto font-mono text-xs text-muted-foreground">{dateTime(d.decidedAt)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <TierLabel stage={d.stage} />
        <span className="text-muted-foreground">{d.reason}</span>
      </div>
      <p className="mt-1.5 font-mono text-xs text-muted-foreground">{facts.join(' · ')}</p>
      {d.actionId === null ? (
        <div className="mt-2 text-xs">
          <Result row={d} />
        </div>
      ) : null}
    </li>
  );
}

function ActionEntry({ a }: { a: Action }) {
  const bad = a.status !== 'done' && a.status !== 'undone';
  return (
    <li className="sheet bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Mailbox change</span>
        <span className={`inline-flex h-5 items-center rounded-full border px-2 text-xs font-medium ${bad ? 'border-destructive/50 text-destructive' : ''}`}>
          {a.type} {a.status}
        </span>
        <span className="font-mono text-xs text-muted-foreground">#{a.id}</span>
        <span className="ml-auto font-mono text-xs text-muted-foreground">{dateTime(a.createdAt)}</span>
      </div>
      <div className="mt-2 flex flex-col gap-1 text-xs">
        <Labels title="Added" labels={a.added} />
        <Labels title="Removed" labels={a.removed} />
        {a.error ? <p className="text-destructive">{a.error}</p> : null}
        {a.status === 'done' ? (
          <p className="text-muted-foreground">
            Reverse with <code className="font-mono text-foreground">sift undo {a.id}</code>
          </p>
        ) : null}
      </div>
    </li>
  );
}

const people = (list: MessageDetail['to']) => list.map((p) => p.address).join(', ');

function Body({ detail }: { detail: MessageDetail }) {
  const history = [
    ...detail.decisions.map((d) => ({ at: d.decidedAt, order: 0, node: <DecisionEntry key={`d${d.id}`} d={d} /> })),
    ...detail.actions.map((a) => ({ at: a.createdAt, order: 1, node: <ActionEntry key={`a${a.id}`} a={a} /> })),
  ].toSorted((x, y) => x.at - y.at || x.order - y.order);
  const headers = Object.entries(detail.headers).filter(([name]) => !['from', 'to', 'cc', 'subject'].includes(name));
  return (
    <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-6">
      <dl>
        <Field label="From">{detail.fromName ? `${detail.fromName} <${detail.fromAddress}>` : detail.fromAddress}</Field>
        {detail.to.length > 0 ? <Field label="To">{people(detail.to)}</Field> : null}
        {detail.cc.length > 0 ? <Field label="Cc">{people(detail.cc)}</Field> : null}
        <Field label="Received">{dateTime(detail.receivedAt)}</Field>
        {detail.listId ? <Field label="List">{detail.listId}</Field> : null}
        <Field label="Message id">
          <code className="text-xs">{detail.messageId}</code>
        </Field>
      </dl>

      <section>
        <h3 className="slug mb-2 text-muted-foreground">History</h3>
        {history.length === 0 ? <Empty>Not triaged yet.</Empty> : <ol className="flex flex-col gap-2">{history.map((entry) => entry.node)}</ol>}
      </section>

      {headers.length > 0 ? (
        <section>
          <h3 className="slug mb-1 text-muted-foreground">Headers used for triage</h3>
          <p className="mb-2 text-xs text-muted-foreground">sift stores these headers and the subject. It never stores the body.</p>
          <dl className="text-xs">
            {headers.map(([name, value]) => (
              <Field key={name} label={name}>
                <span className="font-mono">{value}</span>
              </Field>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

/** Everything sift knows about one message: who sent it, each decision and each mailbox change, in order. */
export function MessageSheet({ target, onClose }: { target: MessageRef | null; onClose: () => void }) {
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {target ? <Loaded key={`${target.accountId}/${target.messageId}`} target={target} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Loaded({ target }: { target: MessageRef }) {
  const { data, error, loading } = useLoaded(`${target.accountId}/${target.messageId}`, (signal) => api.message(target.accountId, target.messageId, signal));
  return (
    <>
      <SheetHeader>
        <SheetTitle className="title pr-8">{(data?.subject ?? target.subject) || '(no subject)'}</SheetTitle>
        <SheetDescription>What sift decided and did for this message.</SheetDescription>
      </SheetHeader>
      {loading ? (
        <div className="px-4">
          <Skeleton className="h-48 w-full" />
        </div>
      ) : data ? (
        <Body detail={data} />
      ) : (
        <p role="alert" className="px-4 text-sm text-destructive">
          Could not load this message. {error}
        </p>
      )}
    </>
  );
}
