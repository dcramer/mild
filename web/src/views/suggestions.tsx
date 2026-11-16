import { ErrorNote, Verdict } from '@/components/bits.tsx';
import { SenderLink } from '@/components/sender.tsx';
import { useParam } from '@/lib/route.ts';
import { type SuggestionGroup, type Suggestions, type Summary, api, useAction, useLoaded } from '@/lib/api.ts';
import { ACTIONS, ago, count, describeMatch, money, outcomeName, percent, plural, willBe } from '@/lib/format.ts';
import {
  Button,
  Check,
  Empty,
  Failure,
  FilterGroup,
  ListView,
  Loading,
  OnPhone,
  RowActions,
  Reserve,
  Sub,
  Table,
  TextLink,
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

/** How sift did this week, as one quiet line beside the title; changes that went wrong are the only thing in it that asks for anything. */
function Week({ summary }: { summary: Summary }) {
  const t = summary.totals;
  return (
    <p className="text-right text-sm text-muted-foreground tabular-nums">
      {t.troubledActions > 0 ? (
        <>
          <Failure inline>
            <TextLink href="/activity?status=trouble&days=30">{plural(t.troubledActions, 'change')} went wrong</TextLink>
          </Failure>
          <br />
        </>
      ) : null}
      This week {percent(t.withoutInference, t.decisions)} without a model · {money(t.costUsd)} · <TextLink href="/activity">Activity</TextLink>
    </p>
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
    <li className="row flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
      <p className="min-w-0 flex-1 basis-80">
        <span className="font-semibold">{proposal.kind === 'rule' ? 'Make a rule?' : 'Stop checking?'}</span>{' '}
        <span className="text-muted-foreground">
          The last {count(proposal.agreed)} from {whose.replace(/^from /, '')} were {proposal.labelName}.
        </span>
        <Failure>{error}</Failure>
      </p>
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

/** One sender's waiting mail, as a row: who, what, what sift says, when, and Agree or Change… to say otherwise. */
function SuggestionRow({ group, onOpen, onAnswered }: { group: SuggestionGroup; onOpen: () => void; onAnswered: (taught: string) => void }) {
  const { busy, error, run } = useAction();
  const [first] = subjects(group.sample);
  const mixed = group.guesses > 1;
  const sure = group.labelId !== null && !mixed;
  const agree = () =>
    run(async () => {
      const result = await api.feedback({ accountId: group.accountId, sender: group.sender, scope: 'label', label: group.labelId ?? '' });
      onAnswered(result.taught ?? 'Noted.');
    });
  const subject = (
    <>
      <span className="truncate">{first?.subject || '(no subject)'}</span>
      {group.messages > 1 ? <span className="shrink-0 text-muted-foreground/70 tabular-nums">+{count(group.messages - 1)}</span> : null}
    </>
  );
  const verdict = <Verdict labelName={group.labelName} disposition={group.disposition} unsubscribe={group.unsubscribe} />;

  return (
    <Tr onOpen={onOpen}>
      <Td className="max-w-0 md:w-[24%]">
        <span className="name block truncate">
          <SenderLink accountId={group.accountId} address={group.sender}>
            {group.senderName ?? group.sender}
          </SenderLink>
        </span>
        {group.senderName ? <Sub>{group.sender}</Sub> : null}
        <OnPhone>
          <span className="flex w-full min-w-0 items-baseline gap-2 text-foreground">{subject}</span>
          {verdict}
        </OnPhone>
      </Td>
      <Td phone="hide" className="max-w-0 md:w-[36%]">
        <span className="flex items-baseline gap-2">{subject}</span>
      </Td>
      <Td phone="hide" className="whitespace-nowrap">
        {verdict}
        {mixed ? <span className="text-muted-foreground/70"> · for most</span> : null}
        <Failure className="mt-1">{error}</Failure>
      </Td>
      <Td phone="hide" num quiet>
        {ago(group.latestReceivedAt)}
      </Td>
      <RowActions>
        {sure ? (
          <Button variant="quiet" busy={busy} onClick={agree}>
            Agree
          </Button>
        ) : null}
        <Button variant="quiet" onClick={onOpen}>
          {sure ? 'Change…' : 'Answer…'}
        </Button>
      </RowActions>
    </Tr>
  );
}

const DOES = [['', 'Anything'] as const, ...ACTIONS.filter(([key]) => key !== 'keep'), ['review', outcomeName('review')] as const];

/** The home page: what sift would do with waiting mail, sender by sender, for the user to agree with or change. */
export function SuggestionsView({ onOpen }: { onOpen: OpenMessages }) {
  const [kept, setKept] = useParam('kept');
  const includeKept = kept === '1';
  const setIncludeKept = (on: boolean) => setKept(on ? '1' : '');
  const { data, error, loading, reload } = useLoaded(`suggestions-${includeKept}`, (signal) => api.suggestions(includeKept, signal));
  const summary = useLoaded('summary-7', (signal) => api.summary(7, signal));
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
      count={data ? count(data.waiting) : null}
      actions={summary.data ? <Week summary={summary.data} /> : null}
      intro={
        // Proposals arrive after the list is drawn, and would push it down.
        <Reserve id="home-proposals" ready={data !== null} room={{ narrow: 0, wide: 0 }}>
          {data && data.proposals.length > 0 ? (
            <ul className="sheet flex flex-col">
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
          ) : null}
        </Reserve>
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
        <Empty>{data && data.groups.length > 0 ? 'Nothing waiting matches.' : 'Nothing is waiting on you.'}</Empty>
      ) : (
        <Table>
          <thead className="sr-only">
            <Tr>
              <Th>Sender</Th>
              <Th phone="hide">Mail</Th>
              <Th phone="hide">sift says</Th>
              <Th phone="hide">Latest</Th>
              <Th phone="hide">Actions</Th>
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
