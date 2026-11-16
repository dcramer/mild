import { CheckIcon } from 'lucide-react';
import { ErrorNote, Verdict } from '@/components/bits.tsx';
import { SenderLink } from '@/components/sender.tsx';
import { useParam } from '@/lib/route.ts';
import { type Days, type SuggestionGroup, type Suggestions, type Summary, api, useAction, useLoaded } from '@/lib/api.ts';
import { ACTIONS, PERIODS, TIERS, ago, count, describeMatch, longDay, money, outcomeName, percent, plural, shortDay, willBe } from '@/lib/format.ts';
import {
  Button,
  Check,
  Empty,
  Figure,
  Figures,
  FilterGroup,
  Highlight,
  ListView,
  Loading,
  OnPhone,
  RowActions,
  Section,
  Select,
  StackedBars,
  Sub,
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from '@/system';
import type { OpenMessages } from '@/views/message-panel.tsx';

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

/** How sift is doing over the period: what it decided without a model, how often it was right, what it cost, and decisions per day by tier. */
function Standing({
  summary,
  accuracy,
  days,
  onDays,
}: {
  summary: Summary;
  accuracy: Suggestions['accuracy'] | undefined;
  days: Days;
  onDays: (days: Days) => void;
}) {
  const t = summary.totals;
  // Before senders were folded into rules they were a tier of their own. It is shown only where that history exists.
  const used = (stage: string) => stage !== 'sender' || summary.byStage.some((row) => row.stage === stage && row.decisions > 0);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-12 gap-y-6 lg:grid-cols-[auto_minmax(0,1fr)]">
      <Figures className="gap-x-8">
        <Figure
          label="No model needed"
          value={percent(t.withoutInference, t.decisions)}
          note={t.decisions ? `${count(t.withoutInference)} of ${count(t.decisions)}` : null}
        />
        {accuracy && accuracy.reviewed > 0 ? (
          <Figure label="sift was right" value={percent(accuracy.right, accuracy.reviewed)} note={`of ${count(accuracy.reviewed)} you checked`} />
        ) : null}
        <Figure label="Model cost" value={money(t.costUsd)} note={t.decisions ? plural(t.decisions, 'decision') : null} />
        {t.troubledActions > 0 ? (
          <Figure label="Needs a look" value={count(t.troubledActions)} note="in Activity" tone="failure" href="/activity?status=trouble&days=30" />
        ) : null}
      </Figures>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex justify-end">
          <Select label="Period" value={String(days) as (typeof PERIODS)[number][0]} options={PERIODS} onChange={(value) => onDays(Number(value) as Days)} />
        </div>
        {t.decisions === 0 ? (
          <p className="pt-10 text-muted-foreground">Nothing decided in this period.</p>
        ) : (
          <StackedBars
            compact
            unit="decisions"
            series={TIERS.filter((tier) => used(tier.key))}
            rows={summary.daily.map((d) => ({ key: d.day, label: shortDay(d.day), title: longDay(d.day), values: d.counts }))}
          />
        )}
      </div>
    </div>
  );
}

type Proposal = Suggestions['proposals'][number];

/** A rule sift thinks is worth having. Nothing changes until it is accepted. */
function ProposalRow({ proposal, onResolved }: { proposal: Proposal; onResolved: (line: string | null) => void }) {
  const { busy, error, run } = useAction();
  const whose = describeMatch(proposal.match);
  const resolve = (accept: boolean) =>
    run(async () => {
      await api.resolveProposal(proposal.id, accept);
      onResolved(accept ? `From now on, mail ${whose} is ${proposal.labelName}: ${willBe(proposal.disposition)}, without sift reading it.` : null);
    });
  return (
    <li className="row flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-80">
        <p>
          Mail {whose} is <span className="font-medium">{proposal.labelName}</span> ({outcomeName(proposal.disposition)})
        </p>
        <p className="text-muted-foreground">
          {proposal.kind === 'rule'
            ? `The last ${count(proposal.agreed)} were. A rule would decide without a model.`
            : `sift has agreed ${count(proposal.agreed)} times running. It could stop reading each one.`}
        </p>
        {error ? <p className="text-destructive">{error}</p> : null}
      </div>
      <span className="flex items-center gap-1.5">
        <Button busy={busy} onClick={() => resolve(true)}>
          {proposal.kind === 'rule' ? 'Make the rule' : 'Stop reading them'}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={() => resolve(false)}>
          Dismiss
        </Button>
      </span>
    </li>
  );
}

/** One sender's waiting mail, as a row: who, what it is about, what sift says, and agreeing in one press. Pressing the row opens it to answer otherwise. */
function SuggestionRow({ group, onOpen, onAnswered }: { group: SuggestionGroup; onOpen: () => void; onAnswered: (taught: string) => void }) {
  const { busy, error, run } = useAction();
  const [first, ...rest] = subjects(group.sample);
  const mixed = group.guesses > 1;
  const agree = () =>
    run(async () => {
      const result = await api.feedback({ accountId: group.accountId, sender: group.sender, scope: 'sender', label: group.labelId ?? '' });
      onAnswered(result.taught ?? 'Noted.');
    });
  const verdict = <Verdict labelName={group.labelName} disposition={group.disposition} unsubscribe={group.unsubscribe} />;

  return (
    <Tr onOpen={onOpen}>
      <Td className="max-w-0 md:w-[22%]">
        <span className="name block truncate">
          <SenderLink accountId={group.accountId} address={group.sender}>
            {group.senderName ?? group.sender}
          </SenderLink>
        </span>
        <Sub>{group.senderName ? group.sender : plural(group.messages, 'message')}</Sub>
        <OnPhone>
          <span className="w-full truncate">{first?.subject || '(no subject)'}</span>
          {verdict}
        </OnPhone>
      </Td>
      <Td phone="hide" className="max-w-0 md:w-[36%]">
        <span className="flex items-baseline gap-2">
          <span className="truncate">{first?.subject || '(no subject)'}</span>
          {first && first.times > 1 ? <span className="shrink-0 text-muted-foreground tabular-nums">×{first.times}</span> : null}
        </span>
        <Sub>
          {plural(group.messages, 'message')}
          {rest.length > 0 ? ` · also “${rest[0]?.subject}”` : ''}
        </Sub>
      </Td>
      <Td phone="hide" className="whitespace-nowrap">
        {verdict}
        {mixed ? <Sub>for most; open to see the rest</Sub> : null}
        {error ? <span className="mt-1 block text-destructive">{error}</span> : null}
      </Td>
      <Td phone="hide" num quiet>
        {ago(group.latestReceivedAt)}
      </Td>
      <RowActions>
        {/* A sender sift guessed more than one way, or could not place, is worth opening before agreeing. */}
        {group.labelId === null || mixed ? null : (
          <Button variant="quiet" busy={busy} onClick={agree}>
            <CheckIcon aria-hidden />
            Right
          </Button>
        )}
      </RowActions>
    </Tr>
  );
}

const DOES = [['', 'Anything'] as const, ...ACTIONS.filter(([key]) => key !== 'keep'), ['review', outcomeName('review')] as const];

/** The home page: how sift is doing, the rules it proposes, then what it would do, waiting for the user to say right or wrong. */
export function SuggestionsView({ onOpen }: { onOpen: OpenMessages }) {
  const [kept, setKept] = useParam('kept');
  const includeKept = kept === '1';
  const setIncludeKept = (on: boolean) => setKept(on ? '1' : '');
  const [chosen, setChosen] = useParam('days');
  const days = (PERIODS.some(([key]) => key === chosen) ? Number(chosen) : 7) as Days;
  const { data, error, loading, reload } = useLoaded(`suggestions-${includeKept}`, (signal) => api.suggestions(includeKept, signal));
  const summary = useLoaded(`summary-${days}`, (signal) => api.summary(days, signal));
  const toast = useToast();
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
  const learned = (line: string) => {
    toast(line);
    reload();
  };

  return (
    <ListView
      title="Suggestions"
      meta={
        data ? (
          data.waiting > 0 ? (
            <span>
              <Highlight className="mx-0 font-medium">{count(data.waiting)} waiting</Highlight> from {plural(data.groups.length, 'sender')}
            </span>
          ) : (
            'Nothing waiting on you'
          )
        ) : null
      }
      intro={
        <>
          {summary.data ? (
            <Standing summary={summary.data} accuracy={data?.accuracy} days={days} onDays={(next) => setChosen(next === 7 ? '' : String(next))} />
          ) : null}
          {data && data.proposals.length > 0 ? (
            <Section title="Proposed rules" meta={count(data.proposals.length)}>
              <ul className="flex flex-col">
                {data.proposals.map((proposal) => (
                  <ProposalRow
                    key={proposal.id}
                    proposal={proposal}
                    onResolved={(line) => {
                      if (line) toast(line);
                      reload();
                    }}
                  />
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      }
      search={{ value: search, onChange: setSearch, placeholder: 'Search senders and subjects' }}
      filters={{
        active: [
          ...(label === '' ? [] : [{ label: `Label: ${label === UNSURE ? outcomeName('review') : (names.get(label) ?? label)}`, clear: () => setLabel('') }]),
          ...(does === '' ? [] : [{ label: `Then: ${DOES.find(([key]) => key === does)?.[1]}`, clear: () => setDoes('') }]),
          ...(includeKept ? [{ label: 'With mail sift would keep', clear: () => setIncludeKept(false) }] : []),
        ],
        panel: (
          <>
            <FilterGroup label="Label" value={label} options={[['', 'Any'] as const, [UNSURE, outcomeName('review')] as const, ...names]} onChange={setLabel} />
            <FilterGroup label="Then" value={does} options={DOES} onChange={setDoes} />
            <Check checked={includeKept} onChange={setIncludeKept}>
              With mail sift would keep
            </Check>
          </>
        ),
      }}
    >
      {error ? <ErrorNote message={error} /> : null}
      {loading ? (
        <Loading rows={6} />
      ) : groups.length === 0 ? (
        <Empty>
          {data && data.groups.length > 0
            ? 'Nothing waiting matches.'
            : 'Nothing is waiting on you. As mail arrives sift says what it would do with it here, and each answer you give becomes a rule that covers later mail too.'}
        </Empty>
      ) : (
        <Table>
          <thead>
            <Tr>
              <Th>Sender</Th>
              <Th phone="hide">Mail</Th>
              <Th phone="hide">sift says</Th>
              <Th phone="hide" num>
                Latest
              </Th>
              <Th phone="hide" />
            </Tr>
          </thead>
          <tbody>
            {groups.map((group, index) => (
              <SuggestionRow key={groupKey(group)} group={group} onOpen={() => onOpen(items, index)} onAnswered={learned} />
            ))}
          </tbody>
        </Table>
      )}
    </ListView>
  );
}
