import { type AnswerLabel, type Answerable, useAnswer } from '@/components/answer.tsx';
import { ErrorNote } from '@/components/bits.tsx';
import { SenderLink } from '@/components/sender.tsx';
import { useParam } from '@/lib/route.ts';
import { type SuggestionItem, type Suggestions, type Summary, api, useAction, useLoaded } from '@/lib/api.ts';
import { ACTIONS, ago, count, describeMatch, money, outcomeName, percent, plural, sureness, willBe } from '@/lib/format.ts';
import {
  AnswerPicker,
  Button,
  Check,
  Empty,
  Failure,
  FilterGroup,
  ListView,
  Look,
  Loading,
  Meter,
  OnPhone,
  Sub,
  RowActions,
  Reserve,
  Table,
  TextLink,
  Td,
  Th,
  Tr,
  useToast,
} from '@/system';
import type { OpenMessages } from '@/views/message-panel.tsx';

const UNSURE = '-';

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

/**
 * One suggestion: who, what, when, and what sift says it is with how sure, in a dropdown with what else it
 * might be, and a check that commits. Pressing the row opens the message.
 */
function SuggestionRow({
  item,
  labels,
  waiting,
  onOpen,
  onAnswered,
}: {
  item: SuggestionItem;
  labels: readonly AnswerLabel[];
  waiting: readonly Answerable[];
  onOpen: () => void;
  onAnswered: () => void;
}) {
  const target = { accountId: item.accountId, sender: item.sender, messageId: item.messageId, decisionId: item.decisionId, labelId: item.labelId };
  const { answer, choices, busy, error } = useAnswer(labels, waiting, onAnswered);
  const groups = choices(target, sureness(item.stage, item.confidence), item.alternatives);

  return (
    <Tr onOpen={onOpen}>
      {/* Who sent it, by name and address: a name alone could be anyone. */}
      <Td className="max-w-0 md:w-[24%] md:min-w-52">
        <span className="name block truncate">
          <SenderLink accountId={item.accountId} address={item.sender}>
            {item.senderName ?? item.sender}
          </SenderLink>
        </span>
        {item.senderName ? <Sub>{item.sender}</Sub> : null}
        {/* On a phone the row only says what sift thinks; it opens the message, where the answer is. */}
        <OnPhone>
          <span className="w-full truncate text-foreground">{item.subject || '(no subject)'}</span>
          {item.labelId !== null ? (
            <span className="inline-flex items-center gap-2">
              <Meter level={sureness(item.stage, item.confidence)} />
              {item.labelName ?? outcomeName(item.disposition)}
            </span>
          ) : (
            <Look>{outcomeName('review')}</Look>
          )}
        </OnPhone>
      </Td>
      {/* What it is about, and as much of what it says as fits: enough to answer without opening it. */}
      <Td phone="hide" className="max-w-0 md:w-full">
        <span className="block truncate">{item.subject || '(no subject)'}</span>
        {item.preview ? <Sub>{item.preview}</Sub> : null}
        <Failure className="mt-1">{error}</Failure>
      </Td>
      <Td phone="hide" num quiet>
        {ago(item.receivedAt)}
      </Td>
      <RowActions>
        <AnswerPicker
          key={item.decisionId}
          className="w-60"
          label="What this message is"
          value={item.labelId}
          groups={groups}
          empty={<Look>{outcomeName('review')}</Look>}
          busy={busy}
          onSubmit={(id) => answer(target, id)}
        />
      </RowActions>
    </Tr>
  );
}

const DOES = [['', 'Anything'] as const, ...ACTIONS.filter(([key]) => key !== 'keep'), ['review', outcomeName('review')] as const];

/** The home page: what sift would do with each waiting message, for the user to agree with in one press or change. */
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
  const shown = (data?.items ?? []).filter(
    (i) =>
      (label === '' || (label === UNSURE ? i.labelId === null : i.labelId === label)) &&
      (does === '' || i.disposition === does) &&
      (needle === '' || [i.sender, i.senderName ?? '', i.subject].some((text) => text.toLowerCase().includes(needle))),
  );
  const refs = shown.map((i) => ({ accountId: i.accountId, messageId: i.messageId, subject: i.subject }));
  const answerable = (data?.items ?? []).map((i) => ({
    accountId: i.accountId,
    sender: i.sender,
    messageId: i.messageId,
    decisionId: i.decisionId,
    labelId: i.labelId,
  }));

  return (
    <ListView
      title="Suggestions"
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
      ) : shown.length === 0 ? (
        <Empty>{data && data.items.length > 0 ? 'Nothing waiting matches.' : 'Nothing is waiting on you.'}</Empty>
      ) : (
        <Table>
          <thead className="sr-only">
            <Tr>
              <Th>Sender</Th>
              <Th phone="hide">Subject</Th>
              <Th phone="hide">Received</Th>
              <Th>Label</Th>
            </Tr>
          </thead>
          <tbody>
            {shown.map((item, index) => (
              <SuggestionRow
                key={`${item.accountId}/${item.messageId}`}
                item={item}
                labels={data?.labels[item.accountId] ?? []}
                waiting={answerable}
                onOpen={() => onOpen(refs, index)}
                onAnswered={reload}
              />
            ))}
          </tbody>
        </Table>
      )}
    </ListView>
  );
}
