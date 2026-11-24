'use client';
import { Verdict } from '@/components/bits.tsx';
import { useAction } from '@/components/action.ts';
import { type MessageDetail, api } from '@/lib/api/endpoints.ts';
import { capitalised, count, dateTime, money } from '@/lib/format.ts';
import { tier } from '@/lib/words.ts';
import { AT_API_PRICES, usePlan } from '@/lib/prices.ts';
import { reveal } from '@/lib/reveal.ts';
import { Button, Failure, Timeline, TimelineEvent, useToast, LabelChip } from '@/system';

type Decision = MessageDetail['decisions'][number];
type Action = MessageDetail['actions'][number];

const CHANGE: Record<string, string> = {
  archive: 'Archived',
  spam: 'Marked spam',
  label: 'Labelled',
  undo: 'Undid a change',
  unsubscribe: 'Unsubscribed',
  read: 'Marked read',
  unread: 'Marked unread',
};
/** A change that never landed, as the lists say it ("Not archived"): it is tried again, so it is only history. */
const NOT_DONE: Record<string, string> = {
  archive: 'Not archived',
  spam: 'Not marked spam',
  label: 'Not labelled',
  undo: 'Not undone',
  unsubscribe: 'Not unsubscribed',
  read: 'Not marked read',
  unread: 'Not marked unread',
};

function DecisionEvent({ d }: { d: Decision }) {
  // Through a plan, the call was paid for by it: its cost is only what the API would have charged.
  const plan = usePlan(d.model ?? '');
  const facts = [
    d.ruleId ? `rule ${d.ruleId}` : null,
    d.confidence === null ? null : `confidence ${d.confidence.toFixed(2)}`,
    d.model ? `${d.model}, ${count(d.inputTokens + d.outputTokens)} tokens, ${money(d.costUsd)}${plan ? ` ${AT_API_PRICES}` : ''}` : null,
    d.durationMs === null ? null : `${count(d.durationMs)} ms`,
  ].filter(Boolean);
  return (
    <TimelineEvent
      at={dateTime(d.decidedAt)}
      title={
        <>
          <span className="font-medium">{d.carryOut ? 'Decided' : 'Suggested'}</span>
          <Verdict labelId={d.labelId} labelName={d.labelName} disposition={d.disposition} />
        </>
      }
    >
      <p className="text-foreground">{capitalised(reveal(d.reason))}</p>
      <p>
        By {tier(d.stage).name.toLowerCase()}
        {facts.length > 0 ? ` · ${facts.join(' · ')}` : ''}
      </p>
    </TimelineEvent>
  );
}

/** Where a change got to, when it is not done and did land. */
const ACTION_STATUS: Record<string, string> = { undone: 'Undone', pending: 'Waiting' };

function ActionEvent({ a, onUndo, busy }: { a: Action; onUndo: (id: number) => void; busy: boolean }) {
  const labels = (title: string, list: string[]) =>
    list.length === 0 ? null : (
      <p className="flex flex-wrap items-baseline gap-1.5">
        {title}
        {list.map((label) => (
          <LabelChip key={label}>{label}</LabelChip>
        ))}
      </p>
    );
  return (
    <TimelineEvent
      at={dateTime(a.createdAt)}
      title={
        a.status === 'failed' || a.status === 'unknown' ? (
          <span className="text-muted-foreground">{NOT_DONE[a.type] ?? a.type}</span>
        ) : (
          <>
            <span className="font-medium">{CHANGE[a.type] ?? a.type} in Gmail</span>
            {a.status === 'done' ? null : <span className="text-muted-foreground">{ACTION_STATUS[a.status] ?? a.status}</span>}
          </>
        )
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
      {labels('Added', reveal(a.added))}
      {labels('Removed', reveal(a.removed))}
    </TimelineEvent>
  );
}

/** What happened to a message, oldest first: what Mild decided and what changed in Gmail, each with Undo. */
export function History({ detail, onUndone }: { detail: MessageDetail; onUndone: () => void }) {
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
              if (message) toast(message);
              onUndone();
            })
          }
        />
      ),
    })),
  ].toSorted((x, y) => x.at - y.at || x.order - y.order);
  if (history.length === 0) return null;
  return (
    <>
      <Failure>{undo.error}</Failure>
      <Timeline>{history.map((entry) => entry.node)}</Timeline>
    </>
  );
}

export const historyCount = (detail: MessageDetail) => detail.decisions.length + detail.actions.length;
