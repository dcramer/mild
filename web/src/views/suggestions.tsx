'use client';
import { WorkflowIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';
import { type AnswerLabel, type Answerable, useAnswer } from '@/components/answer.tsx';
import { ErrorNote } from '@/components/bits.tsx';
import { SenderCell } from '@/components/sender.tsx';
import { type Proposal, ProposalWords, proposalWhy } from '@/components/proposal.tsx';
import { messageKey, proposalKey, useParam } from '@/lib/params.ts';
import { type SuggestionItem, api, useLoaded } from '@/lib/api.ts';
import { useAction, useHidden } from '@/lib/action.ts';
import { ACTIONS, FACT_FILTER_OPTIONS, INBOX, inboxFirst, count, duration, factFilterName, outcomeName, period, plural, sureness } from '@/lib/format.ts';
import {
  Arrived,
  Heads,
  AnswerPicker,
  Button,
  Callout,
  CalloutKey,
  Check,
  Empty,
  FilterGroup,
  ListView,
  Meter,
  More,
  OnPhone,
  RowActions,
  Reserve,
  Rope,
  Table,
  Td,
  Th,
  Tr,
  TrGroup,
  useNow,
} from '@/system';
import { useLabelEnding } from '@/views/label-ending.tsx';
import { RuleDialog } from '@/views/rule-dialog.tsx';
import { fold } from '@/lib/fold.ts';
import { messageStart, proposalStart } from '@/lib/rule-start.ts';
import { useOpenMessages } from '@/lib/open-messages.ts';
import { reveal } from '@/lib/reveal.ts';
import { useShown } from '@/lib/telemetry.ts';

/** Rows drawn at first, and added as the end of the list comes near: all of them at once took seconds to draw. */
const ROWS = 100;

const UNSURE = '-';

/**
 * A rule worth having: the user keeps doing something other than what a label does to a sender's mail of that label,
 * which the model cannot learn. A row from Mild at the top of the list, its presses out as every row's answer is.
 * Nothing changes until the user has seen the rule in its dialog and said yes.
 */
function ProposalRow({ proposal, labels }: { proposal: Proposal; labels: readonly AnswerLabel[] }) {
  const { hide } = useAction();
  const [open, setOpen] = useState(false);
  return (
    <Tr onOpen={() => setOpen(true)}>
      <Td className="max-w-0 md:w-[24%] md:min-w-52">
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          <WorkflowIcon aria-hidden className="size-3.5 text-muted-foreground" />
          Mild
        </span>
        <OnPhone>
          <span className="w-full truncate text-base text-foreground">
            <ProposalWords proposal={proposal} />
          </span>
          <span className="w-full truncate">{proposalWhy(proposal)}</span>
        </OnPhone>
      </Td>
      <Td phone="hide" className="max-w-0 md:w-full">
        <span className="block truncate">
          <span className="font-semibold text-foreground">
            <ProposalWords proposal={proposal} />
          </span>
          <span className="text-muted-foreground"> — {proposalWhy(proposal)}</span>
        </span>
      </Td>
      <Td phone="hide" num quiet>
        {count(proposal.agreed)} in a row
      </Td>
      <RowActions>
        <span className="flex w-60 items-center justify-end gap-1.5">
          <Button variant="quiet" onClick={() => setOpen(true)}>
            Make a rule…
          </Button>
          <Button variant="quiet" onClick={() => hide([proposalKey(proposal)], 'Could not dismiss it', () => api.dismissProposal(proposal.id))}>
            Dismiss
          </Button>
        </span>
      </RowActions>
      {open ? (
        <RuleDialog
          labels={labels}
          start={proposalStart(reveal(proposal.match), proposal.labelId, proposal.disposition)}
          proposal={proposal.id}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Tr>
  );
}

const answerableOf = (i: SuggestionItem): Answerable => ({
  accountId: i.accountId,
  sender: reveal(i.sender),
  subject: reveal(i.subject),
  messageId: i.messageId,
  decisionId: i.decisionId,
  labelId: i.labelId,
});

/**
 * One suggestion: who, what, when, and what Mild says it is with how sure, in a dropdown with what else it
 * might be, and a check that commits. Pressing the row opens the message. With `rest`, the row stands for
 * the sender's other waiting mail Mild gave the same label too, says how many and what they are about,
 * and its answer is for all of them.
 */
function SuggestionRow({
  item,
  rest,
  labels,
  waiting,
  onOpen,
}: {
  item: SuggestionItem;
  rest: readonly SuggestionItem[];
  labels: readonly AnswerLabel[];
  waiting: readonly Answerable[];
  onOpen: () => void;
}) {
  const target = answerableOf(item);
  const { answer, answerAll, choices } = useAnswer(labels, waiting);
  const folded = rest.length > 0;
  const subjects = [item, ...rest].map((i) => reveal(i.subject) || '(no subject)').join(' · ');
  const { ending, dialogs } = useLabelEnding(labels, () => messageStart(target.sender, item.labelId));
  const groups = choices(target, sureness(item), item.alternatives);

  return (
    <Tr onOpen={onOpen} holds={[item, ...rest].map(messageKey)}>
      {/* On a phone the row reads like a mail app's: who and when, the subject, a line of the text and what Mild thinks it is. It opens to answer. */}
      <SenderCell
        address={reveal(item.sender)}
        name={reveal(item.senderName)}
        contact={item.contact}
        line
        messages={rest.length + 1}
        aside={
          <span className="shrink-0 text-sm text-muted-foreground tabular-nums md:hidden">
            <Arrived at={item.receivedAt} />
          </span>
        }
      >
        <OnPhone>
          <span className="w-full truncate text-base text-foreground">
            {folded ? plural(rest.length + 1, 'message') : reveal(item.subject) || '(no subject)'}
          </span>
          <span className="flex w-full items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate">{folded ? subjects : item.preview ? reveal(item.preview) : null}</span>
            {/* A label reads as Mild's answer; Unlabelled stays in the row's quiet ink. */}
            <span className={cn('inline-flex shrink-0 items-baseline gap-2', item.labelId !== null && 'text-supporting')}>
              {item.labelId !== null ? (
                <>
                  <Meter level={sureness(item)} />
                  {item.labelName ?? outcomeName(item.disposition)}
                </>
              ) : (
                outcomeName('review')
              )}
            </span>
          </span>
        </OnPhone>
      </SenderCell>
      {/* What it is about, and as much of what it says as fits: enough to answer without opening it. */}
      <Td phone="hide" className="max-w-0 md:w-full">
        <span className="block truncate">
          <span className="font-semibold text-foreground">{folded ? plural(rest.length + 1, 'message') : reveal(item.subject) || '(no subject)'}</span>
          {folded || item.preview ? <span className="text-muted-foreground"> — {folded ? subjects : reveal(item.preview)}</span> : null}
        </span>
      </Td>
      <Td phone="hide" num quiet>
        <Arrived at={item.receivedAt} />
      </Td>
      <RowActions>
        <AnswerPicker
          key={item.decisionId}
          className="w-60"
          label="What this message is"
          value={item.labelId}
          groups={groups}
          empty={outcomeName('review')}
          onSubmit={(id) => (folded ? answerAll([item, ...rest].map(answerableOf), id) : answer(target, id))}
          ending={ending}
        />
      </RowActions>
      {dialogs}
    </Tr>
  );
}

const DOES = [['', 'Anything'] as const, ...ACTIONS.filter(([key]) => key !== 'keep'), ['review', outcomeName('review')] as const];

/** The home page: what Mild would do with each waiting message, for the user to agree with in one press or change. */
export function SuggestionsView({ loading: loadingRows }: { loading: ReactNode }) {
  const onOpen = useOpenMessages();
  const [kept, setKept] = useParam('kept');
  const includeKept = kept === '1';
  const setIncludeKept = (on: boolean) => setKept(on ? '1' : '');
  const [fact, setFact] = useParam('fact', FACT_FILTER_OPTIONS);
  const [label, setLabel] = useParam('label');
  // Narrowed to Leave in inbox, the mail it would leave there is what was asked for.
  const withKept = includeKept || label === INBOX;
  // Unnarrowed, the same list the masthead counts.
  const { data, error, loading } = useLoaded(`suggestions-${withKept}${fact ? `-${fact}` : ''}`, (signal) => api.suggestions(withKept, fact, signal));
  // The server draws the page with this, so whether Mild is off is said before the list arrives.
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  // The masthead's, drawn on the server too.
  const usage = useLoaded('usage', (signal) => api.usage(signal), 60_000);
  const saved = usage.data?.saved;
  const [search, setSearch] = useParam('q');
  const [does, setDoes] = useParam('does', DOES);

  // An answer or dismissal on its way is left out at once.
  const hidden = useHidden();
  const items = (data?.items ?? []).filter((i) => !hidden.has(messageKey(i)));
  const proposals = (data?.proposals ?? []).filter((p) => !hidden.has(proposalKey(p)));
  const names = new Map((data?.labels ?? []).map((l) => [l.id, l.name] as const));
  const needle = search.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (label === '' || (label === UNSURE ? i.labelId === null : i.labelId === label)) &&
      (does === '' || i.disposition === does) &&
      (needle === '' || [i.sender, i.senderName ?? '', i.subject].some((text) => reveal(text).toLowerCase().includes(needle))),
  );
  const answerable = items.map(answerableOf);
  const narrowed = search !== '' || label !== '' || does !== '' || fact !== '' || includeKept;
  // Nothing at all is waiting: there is nothing to search or narrow.
  const nothing = data !== null && !loading && items.length === 0 && proposals.length === 0 && !data.importing && !narrowed;
  useShown('For review rows', !loading, { rows: shown.length });
  const rows = fold(shown);
  const [reach, setReach] = useState(ROWS);
  // Newest first, under the part of the past each falls in.
  const now = useNow();
  const periods: { title: string | null; rows: typeof rows }[] = [];
  for (const row of rows.slice(0, reach)) {
    const title = now === null ? null : period(row.item.receivedAt, now);
    const last = periods.at(-1);
    if (last?.title === title) last.rows.push(row);
    else periods.push({ title, rows: [row] });
  }
  // The panel steps through the messages as the list draws them: a folded row's together.
  const order = rows.flatMap(({ item, rest }) => [item, ...rest]);
  const refs = order.map((i) => ({ accountId: i.accountId, messageId: i.messageId, subject: i.subject }));

  return (
    <ListView
      intro={
        <>
          {/* Most people start off, so the room is held for it. Drawn once usage is in too, as its line arriving after
              would push the list down under a reader whose place a reload just gave back. */}
          <Reserve id="home-off" ready={manage.data !== null && !usage.loading} room="min-h-[448.83px] lg:min-h-[243.27px]">
            {manage.data && !manage.data.active && !nothing ? (
              <Callout title="Mild is off" action={<Button href="?settings=1">Turn Mild on…</Button>}>
                <p>
                  Nothing here has been done in Gmail. Each row is what Mild would do with that message. Correct the ones it gets wrong, and turn it on once it
                  stops making mistakes.
                </p>
                {saved && saved.wouldHave.messages > 0 ? (
                  <p>
                    On, it would have kept <span className="text-foreground">{plural(saved.wouldHave.messages, 'email')}</span> out of your inbox in the last 30
                    days: about <span className="text-foreground">{duration(saved.wouldHave.seconds)}</span>.
                  </p>
                ) : null}
                <CalloutKey mark={<Meter level={3} />}>Sure. Once Mild is on, it does this by itself.</CalloutKey>
                <CalloutKey mark={<Meter level={2} />}>Less sure, or no label. Mild leaves the message where it is and asks you.</CalloutKey>
              </Callout>
            ) : null}
          </Reserve>
        </>
      }
      search={nothing ? undefined : { value: search, onChange: setSearch, placeholder: 'Search senders and subjects' }}
      filters={
        nothing
          ? undefined
          : {
              active: [
                ...(label === ''
                  ? []
                  : [{ label: `Label: ${label === UNSURE ? outcomeName('review') : (names.get(label) ?? label)}`, clear: () => setLabel('') }]),
                ...(does === '' ? [] : [{ label: `Then: ${DOES.find(([key]) => key === does)?.[1]}`, clear: () => setDoes('') }]),
                ...(fact === '' ? [] : [{ label: factFilterName(fact), clear: () => setFact('') }]),
                ...(includeKept ? [{ label: 'With mail Mild would leave in your inbox', clear: () => setIncludeKept(false) }] : []),
              ],
              panel: (
                <>
                  <FilterGroup
                    label="Label"
                    value={label}
                    options={[['', 'Any'] as const, [UNSURE, outcomeName('review')] as const, null, ...inboxFirst(names)]}
                    onChange={setLabel}
                  />
                  <FilterGroup label="Then" value={does} options={DOES} onChange={setDoes} />
                  <FilterGroup label="What Mild saw" value={fact} options={FACT_FILTER_OPTIONS} onChange={setFact} />
                  <Check checked={includeKept} onChange={setIncludeKept}>
                    With mail Mild would leave in your inbox
                  </Check>
                </>
              ),
            }
      }
    >
      {error ? <ErrorNote message={error} /> : null}

      {loading ? (
        loadingRows
      ) : shown.length === 0 ? (
        nothing ? (
          <Empty
            art={<Rope />}
            after={
              manage.data && !manage.data.active ? (
                <>
                  <p>Mild is off. Nothing it suggests is done in Gmail until you turn it on.</p>
                  <Button href="?settings=1">Turn Mild on…</Button>
                </>
              ) : saved && saved.week.messages > 0 ? (
                <p>
                  Mild kept {count(saved.week.messages)} out of your inbox this week: about {duration(saved.week.seconds)} you didn’t spend on them.
                </p>
              ) : null
            }
          >
            Nothing is waiting on you.
          </Empty>
        ) : items.length > 0 || narrowed ? (
          <Empty>Nothing waiting matches.</Empty>
        ) : data?.importing ? (
          <Empty>Mild is going through your inbox. What it reads shows here.</Empty>
        ) : (
          // Only proposals wait.
          <Empty>Nothing is waiting on you.</Empty>
        )
      ) : (
        <Table keys dense>
          <Heads>
            <Th>Sender</Th>
            <Th phone="hide">Subject</Th>
            <Th phone="hide">Received</Th>
            <Th>Label</Th>
          </Heads>
          {data && proposals.length > 0 ? (
            <tbody>
              {proposals.map((proposal) => (
                <ProposalRow key={proposal.id} proposal={proposal} labels={data.labels} />
              ))}
            </tbody>
          ) : null}
          {periods.map(({ title, rows }) => (
            <tbody key={title ?? ''}>
              {title ? <TrGroup title={title} span={4} /> : null}
              {rows.map(({ item, rest }) => (
                <SuggestionRow
                  key={`${item.accountId}/${item.messageId}`}
                  item={item}
                  rest={rest}
                  labels={data?.labels ?? []}
                  waiting={answerable}
                  onOpen={() => onOpen(refs, order.indexOf(item))}
                />
              ))}
            </tbody>
          ))}
        </Table>
      )}
      {rows.length > reach ? <More onReach={() => setReach((r) => r + ROWS)} /> : null}
    </ListView>
  );
}
