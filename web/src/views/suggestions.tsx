import { useState } from 'react';
import { DispositionBadge, ErrorNote } from '@/components/bits.tsx';
import { type SuggestionGroup, type Suggestions, api, useLoaded } from '@/lib/api.ts';
import { count, percent, tier, willBe } from '@/lib/format.ts';
import { Button, Check, Empty, Highlight, Loading, Note, Select, Sheet, Stamp } from '@/system';
import type { MessageRef } from '@/views/message-sheet.tsx';

type Label = Suggestions['labels'][string][number];
const groupKey = (g: SuggestionGroup) => `${g.accountId}/${g.sender}/${g.disposition}/${g.labelId ?? ''}`;

/** The sample with repeated subjects folded together, newest first. */
function subjects(sample: SuggestionGroup['sample']) {
  const seen = new Map<string, { subject: string; messageId: string; times: number }>();
  for (const m of sample) {
    const entry = seen.get(m.subject);
    if (entry) entry.times += 1;
    else seen.set(m.subject, { subject: m.subject, messageId: m.messageId, times: 1 });
  }
  return [...seen.values()];
}

/** One sender's waiting mail: who, what sift says it is and would do, and the answer. */
function Group({
  group,
  labels,
  onOpen,
  onAnswered,
}: {
  group: SuggestionGroup;
  labels: readonly Label[];
  onOpen: (message: MessageRef) => void;
  onAnswered: (taught: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mail decided before labels existed has an action but no label.
  const unsure = group.labelId === null && group.disposition === 'review';
  const shown = subjects(group.sample);
  const more = group.messages - group.sample.length;

  const answer = async (label: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.feedback({
        accountId: group.accountId,
        sender: group.sender,
        scope: 'sender',
        label,
      });
      onAnswered(result.taught ?? 'Noted.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  return (
    <li className="row grid gap-x-8 gap-y-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="name truncate">{group.senderName ?? group.sender}</span>
          {group.senderName ? <span className="truncate text-[13px] text-muted-foreground">{group.sender}</span> : null}
        </p>
        <ul className="mt-1 flex flex-col">
          {shown.map((m) => (
            <li key={m.messageId} className="flex items-baseline gap-2 text-[13px] text-muted-foreground">
              <button
                type="button"
                className="min-w-0 cursor-pointer truncate py-0.5 text-left underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => onOpen({ accountId: group.accountId, messageId: m.messageId, subject: m.subject })}
              >
                {m.subject || '(no subject)'}
              </button>
              {m.times > 1 ? <span className="shrink-0 tabular-nums">×{m.times}</span> : null}
            </li>
          ))}
          {more > 0 ? <li className="py-0.5 text-[13px] text-muted-foreground tabular-nums">and {count(more)} more</li> : null}
        </ul>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {unsure ? (
            <Stamp tone="look">Not sure</Stamp>
          ) : (
            <>
              {group.labelId ? <span className="name">{group.labelName ?? group.labelId}</span> : null}
              <DispositionBadge disposition={group.disposition} />
            </>
          )}
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {count(group.messages)} {group.messages === 1 ? 'message' : 'messages'} · {tier(group.stage).name}
          </span>
        </p>
        {group.sample[0]?.reason ? <p className="text-[13px] text-muted-foreground">{group.sample[0].reason}</p> : null}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {group.labelId === null ? null : (
            <Button variant="ink" size="sm" busy={busy} onClick={() => void answer(group.labelId ?? '')}>
              Right
            </Button>
          )}
          <Select
            label="What it is"
            value=""
            disabled={busy}
            options={[
              ['', group.labelId === null ? 'It is…' : 'No, it is…'] as const,
              ...labels.filter((l) => l.id !== group.labelId).map((l) => [l.id, `${l.name} (${willBe(l.disposition)})`] as const),
            ]}
            onChange={(key) => {
              if (key !== '') void answer(key);
            }}
          />
        </div>
        {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
      </div>
    </li>
  );
}

/** What sift would do, waiting for the user to say right or wrong. One answer settles a sender. */
export function SuggestionsView({ onOpen, onChanged }: { onOpen: (message: MessageRef) => void; onChanged: () => void }) {
  const [includeKept, setIncludeKept] = useState(false);
  const { data, error, loading, reload } = useLoaded(`suggestions-${includeKept}`, (signal) => api.suggestions(includeKept, signal));
  const [taught, setTaught] = useState<string[]>([]);
  const examples = data ? data.examples.captured + data.examples.pending : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        {data ? (
          <>
            <p className="title tabular-nums">
              {data.waiting > 0 ? <Highlight className="mx-0">{count(data.waiting)}</Highlight> : 'Nothing'} waiting
              {data.waiting > 0 ? <span className="font-normal text-muted-foreground"> from {count(data.groups.length)} senders</span> : null}
            </p>
            <p className="text-[13px] text-muted-foreground tabular-nums">
              {[
                data.accuracy.reviewed > 0
                  ? `Right on ${percent(data.accuracy.right, data.accuracy.reviewed)} of ${count(data.accuracy.reviewed)} reviewed`
                  : null,
                examples > 0 ? `${count(examples)} kept as examples` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </>
        ) : null}
        <div className="ml-auto">
          <Check checked={includeKept} onChange={setIncludeKept}>
            Include mail sift would keep
          </Check>
        </div>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {taught.length > 0 ? (
        <Note title="Learned">
          <ul aria-live="polite" className="flex flex-col gap-0.5">
            {taught.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </Note>
      ) : null}
      <Sheet>
        {loading ? (
          <Loading rows={6} />
        ) : !data || data.groups.length === 0 ? (
          <Empty>Nothing is waiting on you. New mail shows up here as sift decides it.</Empty>
        ) : (
          <ul>
            {data.groups.map((group) => (
              <Group
                key={groupKey(group)}
                group={group}
                labels={data.labels[group.accountId] ?? []}
                onOpen={onOpen}
                onAnswered={(line) => {
                  setTaught((lines) => [line, ...lines].slice(0, 3));
                  reload();
                  onChanged();
                }}
              />
            ))}
          </ul>
        )}
      </Sheet>
      <p className="text-[13px] text-muted-foreground">
        An answer makes a rule for that sender, so it covers what arrives later too. The messages are stored whole as examples.
      </p>
    </div>
  );
}
