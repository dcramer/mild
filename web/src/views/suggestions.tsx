import { useState } from 'react';
import { Button, Sheet } from '@/system';
import { DispositionBadge, Empty, ErrorNote, Sub, TierLabel } from '@/components/bits.tsx';
import { Picker } from '@/components/picker.tsx';
import { Skeleton } from '@/components/ui/skeleton';
import { type SuggestionGroup, type Suggestions, api, useLoaded } from '@/lib/api.ts';
import { count, percent } from '@/lib/format.ts';
import type { MessageRef } from '@/views/message-sheet.tsx';

type Kind = Suggestions['categories'][string][number];
const DOES: Record<string, string> = { keep: 'kept', archive: 'archived', spam: 'spam', review: 'kept' };
const groupKey = (g: SuggestionGroup) => `${g.accountId}/${g.sender}/${g.disposition}`;

function Group({
  group,
  kinds,
  onOpen,
  onAnswered,
}: {
  group: SuggestionGroup;
  kinds: readonly Kind[];
  onOpen: (message: MessageRef) => void;
  onAnswered: (taught: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unsure = group.disposition === 'review';

  const answer = async (verdict: 'right' | 'wrong', category?: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.feedback({
        accountId: group.accountId,
        sender: group.sender,
        scope: 'sender',
        verdict,
        suggested: group.disposition,
        ...(category ? { category } : {}),
      });
      onAnswered(result.taught ?? 'Noted.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  return (
    <li className="row grid gap-x-6 gap-y-3 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="name truncate">{group.senderName ?? group.sender}</span>
          {group.senderName ? <span className="truncate text-[13px] text-muted-foreground">{group.sender}</span> : null}
          <span className="text-[13px] text-muted-foreground tabular-nums">· {count(group.messages)}</span>
        </div>
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {group.sample.map((m) => (
            <li key={m.decisionId}>
              <button
                type="button"
                className="block max-w-full truncate text-left text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => onOpen({ accountId: group.accountId, messageId: m.messageId, subject: m.subject })}
              >
                {m.subject || '(no subject)'}
              </button>
            </li>
          ))}
          {group.messages > group.sample.length ? (
            <li className="text-[13px] text-muted-foreground">and {count(group.messages - group.sample.length)} more</li>
          ) : null}
        </ul>
      </div>

      <div className="flex flex-col gap-2 md:items-end">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          {unsure ? <span className="stamp bg-highlight text-highlight-ink">sift was not sure</span> : <DispositionBadge disposition={group.disposition} />}
          <TierLabel stage={group.stage} />
        </div>
        <Sub>{group.sample[0]?.reason}</Sub>
        <div className="flex flex-wrap items-center gap-1.5">
          {unsure ? null : (
            <Button variant="ink" size="sm" disabled={busy} onClick={() => void answer('right')}>
              Right
            </Button>
          )}
          <Picker
            label="What kind of mail it is"
            value=""
            options={[
              ['', unsure ? 'It is…' : 'No, it is…'] as const,
              ...kinds.filter((k) => k.key !== group.category).map((k) => [k.key, `${k.name} (${DOES[k.disposition] ?? k.disposition})`] as const),
            ]}
            onChange={(key) => {
              if (key !== '') void answer('wrong', key);
            }}
          />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
        {data ? (
          <span className="tabular-nums">
            {count(data.waiting)} waiting from {count(data.groups.length)} senders
            {data.accuracy.reviewed > 0
              ? ` · sift was right on ${percent(data.accuracy.right, data.accuracy.reviewed)} of ${count(data.accuracy.reviewed)} reviewed`
              : ''}
            {examples > 0 ? ` · ${count(examples)} kept as examples` : ''}
          </span>
        ) : null}
        <label className="ml-auto flex items-center gap-2">
          <input type="checkbox" className="accent-foreground" checked={includeKept} onChange={(event) => setIncludeKept(event.target.checked)} />
          Include kept mail
        </label>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {taught.length > 0 ? (
        <ul className="flex flex-col gap-1 text-[13px]" aria-live="polite">
          {taught.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : null}
      <Sheet>
        {loading ? (
          <div className="p-4">
            <Skeleton className="h-64 w-full" />
          </div>
        ) : !data || data.groups.length === 0 ? (
          <Empty>Nothing is waiting on you.</Empty>
        ) : (
          <ul>
            {data.groups.map((group) => (
              <Group
                key={groupKey(group)}
                group={group}
                kinds={data.categories[group.accountId] ?? []}
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
        An answer covers all mail from that sender, including what arrives later. The messages are stored whole as examples.
      </p>
    </div>
  );
}
