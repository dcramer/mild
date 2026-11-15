import { CheckIcon } from 'lucide-react';
import { useState } from 'react';
import { Answer, type AnswerValue } from '@/components/answer.tsx';
import { DispositionBadge, ErrorNote, Sub } from '@/components/bits.tsx';
import { MessageBody, Part, SenderFacts, Unsubscribe } from '@/components/message-parts.tsx';
import { type SuggestionGroup, type Suggestions, api, useAction, useLoaded } from '@/lib/api.ts';
import { ACTIONS, ago, count, percent, tier, willBe } from '@/lib/format.ts';
import { cn } from '@/lib/utils';
import { Button, Check, Dialog, Empty, FilterGroup, Highlight, ListView, Loading, Note, Select, Stamp, Table, Td, Th, Tr } from '@/system';

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
        <span className="mt-1 block truncate text-[13px] text-muted-foreground md:hidden">
          {count(group.messages)} · {first?.subject || '(no subject)'}
        </span>
      </Td>
      <Td className="hidden max-w-0 md:table-cell md:w-full">
        <span className="flex items-baseline gap-2">
          <span className="truncate">{first?.subject || '(no subject)'}</span>
          {first && first.times > 1 ? <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">×{first.times}</span> : null}
        </span>
        <Sub>
          {count(group.messages)} {group.messages === 1 ? 'message' : 'messages'}
          {rest.length > 0 ? ` · also “${rest[0]?.subject}”` : ''}
        </Sub>
      </Td>
      <Td className="whitespace-nowrap">
        <span className="flex items-center gap-2">
          <Guess labelName={group.labelName} disposition={group.disposition} />
        </span>
        {mixed ? <Sub>for most of them; mixed</Sub> : null}
        {error ? <span className="mt-1 block text-[13px] text-destructive">{error}</span> : null}
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

/** A sender's waiting mail opened up: read the messages, see what sift knows about the sender, and answer with a scope. */
function SuggestionDialog({
  group,
  labels,
  onClose,
  onAnswered,
}: {
  group: SuggestionGroup;
  labels: readonly Label[];
  onClose: () => void;
  onAnswered: (taught: string) => void;
}) {
  const detail = useLoaded(`suggestion/${group.accountId}/${group.sender}`, (signal) => api.suggestion(group.accountId, group.sender, signal), 120_000);
  const [picked, setPicked] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const messages = detail.data?.messages ?? [];
  const current = messages.find((m) => m.messageId === picked) ?? messages[0];
  const message = useLoaded(
    `message/${group.accountId}/${current?.messageId ?? ''}`,
    (signal) => (current ? api.message(group.accountId, current.messageId, signal) : Promise.resolve(null)),
    120_000,
  );
  const submit = (answer: AnswerValue) =>
    run(async () => {
      const result = await api.feedback({ accountId: group.accountId, sender: group.sender, ...answer });
      onAnswered(result.taught ?? `Settled ${result.reviewed} ${result.reviewed === 1 ? 'message' : 'messages'}. No rule was made.`);
      onClose();
    });

  return (
    <Dialog open wide onClose={onClose} title={group.senderName ?? group.sender} subtitle={group.senderName ? group.sender : undefined}>
      {detail.loading ? (
        <div className="-mx-4">
          <Loading rows={6} />
        </div>
      ) : !detail.data || !current ? (
        <Note tone="failure" title="Could not load this">
          <p>{detail.error ?? 'Nothing from this sender is waiting any more.'}</p>
        </Note>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-6 md:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-5">
            {messages.length > 1 ? (
              <ul className="-mx-2 flex max-h-44 flex-col overflow-y-auto" aria-label="Waiting from this sender">
                {messages.map((m) => (
                  <li key={m.messageId}>
                    <button
                      type="button"
                      aria-current={m.messageId === current.messageId ? 'true' : undefined}
                      className={cn(
                        'flex w-full cursor-pointer items-baseline gap-3 px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-(--fill) hover:text-foreground',
                        'aria-[current=true]:bg-(--fill) aria-[current=true]:font-medium aria-[current=true]:text-foreground',
                      )}
                      onClick={() => setPicked(m.messageId)}
                    >
                      <span className="min-w-0 flex-1 truncate">{m.subject || '(no subject)'}</span>
                      <span className="shrink-0 text-xs font-normal tabular-nums">{ago(m.receivedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {message.data ? (
              <div className="max-h-[45svh] overflow-y-auto md:max-h-none">
                <MessageBody detail={message.data} />
              </div>
            ) : message.loading ? (
              <Loading />
            ) : (
              <p className="text-destructive">{message.error}</p>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <Part title="sift says">
              <p className="flex flex-wrap items-center gap-2">
                <Guess labelName={current.labelName} disposition={current.disposition} />
              </p>
              <p className="text-[13px] text-muted-foreground">
                {current.reason} <span className="whitespace-nowrap">({tier(current.stage).name})</span>
              </p>
            </Part>
            <Part title="This sender">
              <SenderFacts sender={detail.data.sender} />
              {message.data ? <Unsubscribe detail={message.data} /> : null}
            </Part>
            <Answer
              labels={labels}
              guess={group.guesses > 1 ? null : group.labelId}
              sender={group.sender}
              waiting={messages.length}
              busy={busy}
              error={error}
              onSubmit={submit}
            />
          </div>
        </div>
      )}
    </Dialog>
  );
}

const DOES = [['', 'Anything'] as const, ...ACTIONS.filter(([key]) => key !== 'keep'), ['review', 'Hold it for you'] as const];

/** What sift would do, waiting for the user to say right or wrong. */
export function SuggestionsView({ onChanged }: { onChanged: () => void }) {
  const [includeKept, setIncludeKept] = useState(false);
  const { data, error, loading, reload } = useLoaded(`suggestions-${includeKept}`, (signal) => api.suggestions(includeKept, signal));
  const [taught, setTaught] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [label, setLabel] = useState('');
  const [does, setDoes] = useState<(typeof DOES)[number][0]>('');
  const [open, setOpen] = useState<SuggestionGroup | null>(null);

  const names = new Map(Object.values(data?.labels ?? {}).flatMap((list) => list.map((l) => [l.id, l.name] as const)));
  const needle = search.trim().toLowerCase();
  const groups = (data?.groups ?? []).filter(
    (g) =>
      (label === '' || (label === UNSURE ? g.labelId === null : g.labelId === label)) &&
      (does === '' || g.disposition === does) &&
      (needle === '' || [g.sender, g.senderName ?? '', ...g.sample.map((m) => m.subject)].some((text) => text.toLowerCase().includes(needle))),
  );
  const answered = (line: string) => {
    setTaught((lines) => [line, ...lines].slice(0, 3));
    reload();
    onChanged();
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
              {groups.map((group) => (
                <SuggestionRow
                  key={groupKey(group)}
                  group={group}
                  labels={data?.labels[group.accountId] ?? []}
                  onOpen={() => setOpen(group)}
                  onAnswered={answered}
                />
              ))}
            </tbody>
          </Table>
        )}
      </div>
      {facts.length > 0 ? <p className="text-[13px] text-muted-foreground tabular-nums">{facts.join(' · ')}</p> : null}
      {open ? <SuggestionDialog group={open} labels={data?.labels[open.accountId] ?? []} onClose={() => setOpen(null)} onAnswered={answered} /> : null}
    </ListView>
  );
}
