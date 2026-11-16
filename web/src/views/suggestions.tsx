import { CheckIcon } from 'lucide-react';
import { useState } from 'react';
import { DispositionBadge, ErrorNote, Sub } from '@/components/bits.tsx';
import { type SuggestionGroup, type Suggestions, api, useAction, useLoaded } from '@/lib/api.ts';
import { ACTIONS, ago, count, percent, willBe } from '@/lib/format.ts';
import { useParam } from '@/lib/route.ts';
import { Button, Check, Empty, FilterGroup, Highlight, ListView, Loading, Note, Select, Stamp, Table, Td, Th, Tr } from '@/system';
import type { OpenMessages } from '@/views/message-panel.tsx';

type Label = Suggestions['labels'][string][number];
const groupKey = (g: SuggestionGroup) => `${g.accountId}/${g.sender}`;
const UNSURE = '-';

/** The sample with repeated subjects folded together, newest first. */
function subjects(sample: SuggestionGroup['sample']) {
  const seen = new Map<string, { subject: string; times: number }>();
  for (const m of sample) {
    const entry = seen.get(m.subject);
    if (entry) entry.times += 1;
    else seen.set(m.subject, { subject: m.subject, times: 1 });
  }
  return [...seen.values()];
}

/** What sift says a group is and would do, as two things side by side. */
function Guess({ labelName, disposition }: { labelName: string | null; disposition: string }) {
  if (labelName === null && disposition === 'review') return <Stamp tone="look">Not sure</Stamp>;
  return (
    <>
      {labelName ? <span className="font-medium">{labelName}</span> : null}
      <DispositionBadge would disposition={disposition} />
    </>
  );
}

/** One sender's waiting mail, as a row: who, what it is about, what sift says, and the answers that need no reading. Pressing the row opens it. */
function SuggestionRow({
  group,
  labels,
  onOpen,
  onAnswered,
}: {
  group: SuggestionGroup;
  labels: readonly Label[];
  onOpen: () => void;
  onAnswered: (taught: string) => void;
}) {
  const { busy, error, run } = useAction();
  const [first, ...rest] = subjects(group.sample);
  const mixed = group.guesses > 1;
  const answer = (label: string) =>
    run(async () => {
      const result = await api.feedback({ accountId: group.accountId, sender: group.sender, scope: 'sender', label });
      onAnswered(result.taught ?? 'Noted.');
    });

  return (
    <Tr onOpen={onOpen}>
      <Td className="max-w-0 w-full md:w-64 md:max-w-64">
        <span className="name block truncate">{group.senderName ?? group.sender}</span>
        {group.senderName ? <Sub>{group.sender}</Sub> : null}
        {/* On a phone the mail and the answers have no column: the subject sits here and the row opens to answer. */}
        <span className="mt-1 block truncate text-sm text-muted-foreground md:hidden">
          {count(group.messages)} · {first?.subject || '(no subject)'}
        </span>
      </Td>
      <Td className="hidden max-w-0 md:table-cell md:w-full">
        <span className="flex items-baseline gap-2">
          <span className="truncate">{first?.subject || '(no subject)'}</span>
          {first && first.times > 1 ? <span className="shrink-0 text-sm text-muted-foreground tabular-nums">×{first.times}</span> : null}
        </span>
        <Sub>
          {count(group.messages)} {group.messages === 1 ? 'message' : 'messages'}
          {rest.length > 0 ? ` · also “${rest[0]?.subject}”` : ''}
        </Sub>
      </Td>
      <Td className="whitespace-nowrap">
        <span className="flex items-center gap-2">
          <Guess labelName={group.labelName} disposition={group.disposition} />
          {group.unsubscribe ? <span className="text-sm text-muted-foreground">and unsubscribe</span> : null}
        </span>
        {mixed ? <Sub>for most of them; mixed</Sub> : null}
        {error ? <span className="mt-1 block text-sm text-destructive">{error}</span> : null}
      </Td>
      <Td quiet className="hidden text-right whitespace-nowrap tabular-nums md:table-cell">
        {ago(group.latestReceivedAt)}
      </Td>
      {/* Presses here answer; they do not open the row. */}
      <Td className="hidden py-1.5 md:table-cell" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <span className="flex items-center justify-end gap-1.5">
          {/* A sender sift guessed more than one way is worth opening before agreeing. */}
          {group.labelId === null || mixed ? null : (
            <Button variant="ink" busy={busy} onClick={() => answer(group.labelId ?? '')}>
              <CheckIcon aria-hidden />
              Right
            </Button>
          )}
          <Select
            label={`What mail from ${group.sender} is`}
            value=""
            disabled={busy}
            options={[
              ['', group.labelId === null || mixed ? 'It is…' : 'No, it is…'] as const,
              ...labels.filter((l) => mixed || l.id !== group.labelId).map((l) => [l.id, `${l.name} (${willBe(l.disposition)})`] as const),
            ]}
            onChange={(key) => key !== '' && answer(key)}
          />
        </span>
      </Td>
    </Tr>
  );
}

const DOES = [['', 'Anything'] as const, ...ACTIONS.filter(([key]) => key !== 'keep'), ['review', 'Hold it for you'] as const];

/** What sift would do, waiting for the user to say right or wrong. */
export function SuggestionsView({ onOpen }: { onOpen: OpenMessages }) {
  const [kept, setKept] = useParam('kept');
  const includeKept = kept === '1';
  const setIncludeKept = (on: boolean) => setKept(on ? '1' : '');
  const { data, error, loading, reload } = useLoaded(`suggestions-${includeKept}`, (signal) => api.suggestions(includeKept, signal));
  const [taught, setTaught] = useState<string[]>([]);
  const [search, setSearch] = useParam('q');
  const [label, setLabel] = useParam('label');
  const [does, setDoes] = useParam('does', DOES);

  const names = new Map(Object.values(data?.labels ?? {}).flatMap((list) => list.map((l) => [l.id, l.name] as const)));
  const needle = search.trim().toLowerCase();
  const groups = (data?.groups ?? []).filter(
    (g) =>
      (label === '' || (label === UNSURE ? g.labelId === null : g.labelId === label)) &&
      (does === '' || g.disposition === does) &&
      (needle === '' || [g.sender, g.senderName ?? '', ...g.sample.map((m) => m.subject)].some((text) => text.toLowerCase().includes(needle))),
  );
  // A row opens on the newest message waiting from that sender.
  const items = groups.map((g) => ({ accountId: g.accountId, messageId: g.sample[0]?.messageId ?? '', subject: g.sample[0]?.subject ?? '' }));
  const answered = (line: string) => {
    setTaught((lines) => [line, ...lines].slice(0, 3));
    reload();
  };
  const examples = data ? data.examples.captured + data.examples.pending : 0;
  const facts = data
    ? [
        data.accuracy.reviewed > 0
          ? `sift was right on ${percent(data.accuracy.right, data.accuracy.reviewed)} of the ${count(data.accuracy.reviewed)} you checked`
          : null,
        examples > 0 ? `${count(examples)} kept as examples` : null,
      ].filter(Boolean)
    : [];

  return (
    <ListView
      title="Suggestions"
      count={
        data ? (
          data.waiting > 0 ? (
            <>
              <Highlight className="mx-0 font-medium">{count(data.waiting)}</Highlight> waiting from {count(data.groups.length)} senders
            </>
          ) : (
            'Nothing waiting'
          )
        ) : null
      }
      description="An answer makes a rule, so it covers what arrives later too. Open a row to read the mail and choose how far the answer reaches."
      search={{ value: search, onChange: setSearch, placeholder: 'Search senders and subjects' }}
      filters={{
        active: [
          ...(label === '' ? [] : [{ label: `Label: ${label === UNSURE ? 'Not sure' : (names.get(label) ?? label)}`, clear: () => setLabel('') }]),
          ...(does === '' ? [] : [{ label: `sift would: ${DOES.find(([key]) => key === does)?.[1].toLowerCase()}`, clear: () => setDoes('') }]),
          ...(includeKept ? [{ label: 'Including mail sift would keep', clear: () => setIncludeKept(false) }] : []),
        ],
        panel: (
          <>
            <FilterGroup label="Label" value={label} options={[['', 'Any'] as const, [UNSURE, 'Not sure'] as const, ...names]} onChange={setLabel} />
            <FilterGroup label="sift would" value={does} options={DOES} onChange={setDoes} />
            <Check checked={includeKept} onChange={setIncludeKept}>
              Include mail sift would keep
            </Check>
          </>
        ),
      }}
    >
      {error ? <ErrorNote message={error} /> : null}
      {taught.length > 0 ? (
        <Note title="Learned">
          <ul aria-live="polite" className="flex flex-col gap-0.5">
            {taught.map((line, index) => (
              <li key={index} className={index === 0 ? undefined : 'text-muted-foreground'}>
                {line}
              </li>
            ))}
          </ul>
        </Note>
      ) : null}
      <div>
        {loading ? (
          <Loading rows={6} />
        ) : groups.length === 0 ? (
          <Empty>{data && data.groups.length > 0 ? 'Nothing waiting matches.' : 'Nothing is waiting on you. New mail shows up here as sift decides it.'}</Empty>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>Sender</Th>
                <Th className="hidden md:table-cell">Mail</Th>
                <Th>sift says</Th>
                <Th className="hidden text-right md:table-cell">Latest</Th>
                <Th className="hidden md:table-cell" />
              </Tr>
            </thead>
            <tbody>
              {groups.map((group, index) => (
                <SuggestionRow
                  key={groupKey(group)}
                  group={group}
                  labels={data?.labels[group.accountId] ?? []}
                  onOpen={() => onOpen(items, index)}
                  onAnswered={answered}
                />
              ))}
            </tbody>
          </Table>
        )}
      </div>
      {facts.length > 0 ? <p className="text-sm text-muted-foreground tabular-nums">{facts.join(' · ')}</p> : null}
    </ListView>
  );
}
