'use client';
import { ArchiveIcon, BanIcon, CircleHelpIcon, ShieldAlertIcon, WorkflowIcon } from 'lucide-react';
import { type Proposal, ProposalWords, proposalWhy } from '@/components/proposal.tsx';
import { RuleDialog } from '@/views/rule-dialog.tsx';
import { proposalStart, standingStart } from '@/lib/rule-start.ts';
import { eq, inArray, isNull, or, useLiveQuery } from '@tanstack/react-db';
import { type ReactNode, memo, useContext, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type AnswerLabel, answerChoices, useRecordAnswer } from '@/components/answer.tsx';
import { ErrorNote } from '@/components/bits.tsx';
import { useAsk } from '@/components/ask.tsx';
import { TurnInboxOn } from '@/components/inbox-switch.tsx';
import { Thinks, useMailPress, whoWrote } from '@/components/mail.tsx';
import { type MailThread, type MailView, api, readAheadOnRest, useLoaded, usePages } from '@/lib/api.ts';
import { type Copied, conversations, useWhole } from '@/lib/copy.ts';
import { Mailbox } from '@/lib/narrowed.ts';
import { useStarted } from '@/system/started.ts';
import { useAction, useHidden } from '@/lib/action.ts';
import { useCompose } from '@/lib/compose.ts';
import { count, inboxFirst, period, sureness } from '@/lib/format.ts';
import { messageKey, proposalKey, setParams, threadKey, useParam } from '@/lib/params.ts';
import { useOpenMessages } from '@/lib/open-messages.ts';
import { reveal } from '@/lib/reveal.ts';
import {
  Arrived,
  Button,
  Callout,
  Check,
  Empty,
  Failure,
  FilterGroup,
  Heads,
  Hint,
  LabelPick,
  ListView,
  More,
  Note,
  RowCheck,
  RowPresses,
  Sub,
  Table,
  Td,
  Th,
  Tooltip,
  Tr,
  TrGroup,
  useNow,
} from '@/system';

const VIEWS = [
  ['all', 'Everything'],
  ['needs', 'Needs you'],
  ['sorted', 'Sorted'],
] as const satisfies readonly (readonly [MailView, string])[];

/** How long a narrowing of the list is kept once nothing shows it: longer than a conversation is read for. */
const LIST_KEPT_MS = 30 * 60_000;
/**
 * Conversations of the copy drawn at first, and added each time the end of the list comes near. Drawn whole, an inbox of
 * thousands froze the page for seconds at every change the copy took in.
 */
const COPY_PAGE = 100;

/** A conversation as a row lists it: who wrote, named already. */
type Listed = Omit<MailThread, 'who'> & { who: string };

/** The newest message, which the reader opens on. */
const newest = (t: Listed) => ({ accountId: t.accountId, messageId: t.messageIds.at(-1)! });

/** A conversation the copy holds, as its row lists it: the person's own mailboxes as "me", the label by its name. */
function listedOf({ conversation: c, unread, newestAt }: Copied, mine: ReadonlySet<string>, names: ReadonlyMap<string, string>): Listed {
  const last = c.messages.at(-1)!;
  const writers = c.messages.map((m) => (mine.has(reveal(m.fromAddress)) ? 'me' : reveal(m.fromName ?? m.fromAddress)));
  return {
    accountId: c.accountId,
    threadId: c.threadId,
    subject: last.subject,
    from: last.fromAddress,
    who: whoWrote([...new Set(writers)]),
    messageIds: c.messages.map((m) => m.messageId),
    unread,
    newestAt,
    place: 'inbox',
    preview: last.preview,
    thinks: c.thinks ? { ...c.thinks, labelName: (c.thinks.labelId && names.get(c.thinks.labelId)) ?? null } : null,
  };
}

const NO_LABELS: readonly AnswerLabel[] = [];

/**
 * Each conversation as its row lists it, made once for each version of it the copy or the server gave: a row whose
 * conversation is the same object as last time gets the same props, and is not drawn again.
 */
function useRows(manage: { labels: readonly AnswerLabel[]; accounts: readonly { email: string }[] } | null | undefined) {
  return useMemo(() => {
    const names = new Map((manage?.labels ?? []).map((l) => [l.id, l.name] as const));
    const mine = new Set((manage?.accounts ?? []).map((a) => a.email));
    const made = new WeakMap<object, Listed>();
    const rowOf = (row: Copied | MailThread): Listed => {
      let listed = made.get(row);
      if (!listed) {
        listed = 'conversation' in row ? listedOf(row, mine, names) : { ...row, who: whoWrote(reveal(row.who)) };
        made.set(row, listed);
      }
      return listed;
    };
    return { names, rowOf };
  }, [manage?.labels, manage?.accounts]);
}

/** Its newest message read ahead of a press that opens it, which then waits on nothing. */
const ahead = (t: Listed) =>
  readAheadOnRest(`message/${t.accountId}/${newest(t).messageId}`, (signal) => api.message(newest(t).messageId, signal, t.accountId));

/** Where a conversation a search found is, when that is not the inbox, in front of its subject as Gmail puts a label. */
function Place({ thread }: { thread: Listed }) {
  if (thread.place === 'inbox') return null;
  return <span className="mr-2 font-normal text-muted-foreground">{thread.place === 'sent' ? 'Sent' : 'Archived'}</span>;
}

/** Mild looked at the newest message and could not say which label it is. */
const unplaced = (t: Listed) => t.thinks?.disposition === 'review' && t.thinks.labelId === null;

/**
 * What Mild thinks the newest message is, as a dropdown that says it otherwise: saved at once and the mail left where
 * it is, so picking again is the undo. Mail Mild never placed is answered all the same.
 */
function Label({ thread, labels }: { thread: Listed; labels: readonly AnswerLabel[] }) {
  const record = useRecordAnswer();
  const { thinks } = thread;
  const target = {
    accountId: thread.accountId,
    sender: reveal(thread.from),
    messageId: newest(thread).messageId,
    labelId: thinks?.labelId ?? null,
    ...(thinks ? { decisionId: thinks.decisionId } : {}),
  };
  return (
    <LabelPick
      key={`${thinks?.decisionId ?? 'undecided'}/${thinks?.labelId ?? ''}`}
      label={`What ${reveal(thread.subject) || '(no subject)'} is`}
      value={thinks?.labelId ?? null}
      groups={answerChoices(labels, target, thinks ? sureness(thinks) : 1, [])}
      onSubmit={(id) => record(target, id)}
    />
  );
}

/** What a row's presses do, the same from one draw to the next, so a row is drawn again only when its own conversation changes. */
type Hands = {
  select: (thread: Listed, on: boolean) => void;
  open: (thread: Listed) => void;
  press: (threads: readonly Listed[], what: 'archive' | 'spam' | 'read' | 'unread') => void;
  block: (threads: readonly Listed[]) => void;
};

/**
 * One conversation, on one line as Gmail lists it: who wrote and how many messages, the subject and the start of the
 * newest, and when, marked where Mild could not place it; pointed at, its label, Archive, Spam and Block take the time's
 * place. Unread is bold and bright, read is plain and dimmer. On a phone it reads as For review's rows do: who and when, the subject, then a
 * line of the text with the label.
 */
const ThreadRow = memo(function ThreadRow({
  thread,
  labels,
  selected,
  hands,
}: {
  thread: Listed;
  labels: readonly AnswerLabel[];
  selected: boolean;
  hands: Hands;
}) {
  const { press, block } = hands;
  const subject = reveal(thread.subject) || '(no subject)';
  const { who } = thread;
  const many = thread.messageIds.length > 1 ? <span className="font-normal text-muted-foreground tabular-nums">{thread.messageIds.length}</span> : null;
  const ink = thread.unread ? 'font-semibold text-foreground' : 'text-foreground/70';
  return (
    <Tr
      selected={selected}
      onOpen={() => hands.open(thread)}
      onPointerEnter={() => ahead(thread)}
      onFocusCapture={() => ahead(thread)}
      holds={thread.messageIds.map((messageId) => messageKey({ accountId: thread.accountId, messageId }))}
    >
      <RowCheck checked={selected} onChange={(on) => hands.select(thread, on)} label={`Select ${subject}`} />
      <Td className="max-w-0 phone:py-2 md:w-[18%] md:min-w-40">
        <span className={`flex min-w-0 items-baseline gap-1.5 phone:hidden ${ink}`}>
          <span className="truncate">{who}</span>
          {many}
        </span>
        {/* On a phone, a mail app's three lines set close: who and when, the subject, the start of the text with the label. */}
        <span className="flex flex-col leading-snug md:hidden">
          <span className="flex items-baseline gap-3">
            <span className={`flex min-w-0 flex-1 items-baseline gap-1.5 ${thread.unread ? 'name leading-snug' : 'text-foreground/85'}`}>
              <span className="truncate">{who}</span>
              {many}
            </span>
            <span className={`shrink-0 text-sm tabular-nums ${thread.unread ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
              <Arrived at={thread.newestAt} />
            </span>
          </span>
          <span className={`truncate ${thread.unread ? 'font-semibold text-foreground' : 'text-foreground/85'}`}>
            <Place thread={thread} />
            {subject}
          </span>
          <span className="flex items-baseline gap-3 text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">{thread.preview ? reveal(thread.preview) : null}</span>
            <span className="shrink-0 text-sm">
              <Thinks thinks={thread.thinks} />
            </span>
          </span>
        </span>
      </Td>
      <Td phone="hide" className="max-w-0 md:w-full">
        <span className="block truncate">
          <Place thread={thread} />
          <span className={ink}>{subject}</span>
          {thread.preview ? <span className="text-muted-foreground"> — {reveal(thread.preview)}</span> : null}
        </span>
      </Td>
      <RowPresses
        lead={<Label thread={thread} labels={labels} />}
        mark={unplaced(thread) ? <Hint icon={CircleHelpIcon} says="Unlabelled" tone="look" /> : null}
        presses={
          <>
            <Tooltip says="Archive">
              <Button variant="bare" size="tray" aria-label="Archive" onClick={() => press([thread], 'archive')}>
                <ArchiveIcon aria-hidden />
              </Button>
            </Tooltip>
            <Tooltip says="Spam">
              <Button variant="bare" size="tray" aria-label="Spam" onClick={() => press([thread], 'spam')}>
                <ShieldAlertIcon aria-hidden />
              </Button>
            </Tooltip>
            <Tooltip says="Block sender">
              <Button variant="bare" size="tray" aria-label="Block sender" onClick={() => block([thread])}>
                <BanIcon aria-hidden />
              </Button>
            </Tooltip>
          </>
        }
      >
        <span className={thread.unread ? 'font-semibold text-foreground' : undefined}>
          <Arrived at={thread.newestAt} />
        </span>
      </RowPresses>
    </Tr>
  );
});

/**
 * A rule Mild proposes, drawn as mail is: from Mild, the rule as its subject and why as its text. Pressing it opens why in full; pointed at, it can be made or dismissed in place.
 */
function ProposalRow({ proposal, labels }: { proposal: Proposal; labels: readonly AnswerLabel[] }) {
  const { hide } = useAction();
  const [making, setMaking] = useState(false);
  return (
    <Tr onOpen={() => setParams({ proposal: String(proposal.id) }, { state: { panel: true } })}>
      <Td phone="hide" className="w-px">
        <WorkflowIcon aria-hidden className="size-3.5 text-muted-foreground" />
      </Td>
      <Td className="max-w-0 phone:py-2 md:w-[18%] md:min-w-40">
        <span className="font-semibold">Mild</span>
        <span className="block truncate md:hidden">
          <ProposalWords proposal={proposal} />
        </span>
        <Sub className="md:hidden">{proposalWhy(proposal)}</Sub>
      </Td>
      <Td phone="hide" className="max-w-0 md:w-full">
        <span className="block truncate">
          <span className="font-semibold">
            <ProposalWords proposal={proposal} />
          </span>
          <span className="text-muted-foreground"> — {proposalWhy(proposal)}</span>
        </span>
      </Td>
      <RowPresses
        presses={
          <>
            <Button variant="bare" className="h-7 px-2" onClick={() => setMaking(true)}>
              Make a rule…
            </Button>
            <Button
              variant="bare"
              className="h-7 px-2"
              onClick={() => hide([proposalKey(proposal)], 'Could not dismiss it', () => api.dismissProposal(proposal.id))}
            >
              Dismiss
            </Button>
          </>
        }
      >
        <span className="text-sm">{count(proposal.agreed)} in a row</span>
      </RowPresses>
      {making ? (
        <RuleDialog
          labels={labels}
          start={proposalStart(reveal(proposal.match), proposal.labelId, proposal.disposition)}
          proposal={proposal.id}
          onClose={() => setMaking(false)}
        />
      ) : null}
    </Tr>
  );
}

/** Compose on a phone, which has no rail. Nothing while Inbox is off. */
export function PhoneCompose() {
  const compose = useCompose();
  return compose ? (
    <Button className="md:hidden" onClick={() => compose()}>
      Compose
    </Button>
  ) : null;
}

/** Inbox: the conversations in the inbox, as a mail app lists them, with what Mild thinks of each; a search looks through all the mail Mild keeps. */
export function InboxView({ loading: loadingRows }: { loading: ReactNode }) {
  const onOpen = useOpenMessages();
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  const [search, setSearch] = useParam('q');
  const [label, setLabel] = useParam('label');
  // Everything is the list unnarrowed, with nothing in the address.
  const [asked, setView] = useParam<MailView | ''>('view', VIEWS);
  const view = asked || 'all';
  const [unread, setUnread] = useParam('unread');
  // Rules Mild proposes, at the top of the inbox: For review is not a section of its own while Inbox is on.
  const suggestions = useLoaded('suggestions-false', (signal) => api.suggestions(false, '', signal));
  const q = useDeferredValue(search.trim());
  const ask = useAsk();
  const query = { view, label, q, unread: unread === '1', ...ask.query } as const;
  const on = manage.data?.mail === true;
  const started = useStarted();
  // The inbox is drawn from the copy in this browser; a search, or what Ask made of one, looks through all the mail Mild keeps, which only the server can.
  const local = on && started && q === '' && !ask.narrowed;
  // Asked only once the page has started: until then it cannot say whether the copy will draw the list.
  const server = on && started && !local;
  const pages = usePages(`mail-threads-${server}-${query.view}-${label}-${query.unread}-${q}-${JSON.stringify(ask.query)}`, (before, signal) =>
    server ? api.mailThreads(query, before, signal) : Promise.resolve({ threads: [], next: null }),
  );
  const mailbox = useContext(Mailbox);
  const [reach, setReach] = useState(COPY_PAGE);
  const copy = useLiveQuery({
    query: (from) => {
      if (!local) return undefined;
      let rows = from.from({ c: conversations() }).where(({ c }) => eq(c.inbox, true));
      if (mailbox) rows = rows.where(({ c }) => eq(c.accountId, mailbox));
      if (unread === '1') rows = rows.where(({ c }) => eq(c.unread, true));
      if (label) rows = rows.where(({ c }) => eq(c.labelId, label));
      if (view === 'needs') rows = rows.where(({ c }) => or(isNull(c.disposition), inArray(c.disposition, ['keep', 'review'])));
      if (view === 'sorted') rows = rows.where(({ c }) => inArray(c.disposition, ['archive', 'spam', 'block', 'digest']));
      // One past the rows drawn, to know there are more.
      return rows.orderBy(({ c }) => c.newestAt, 'desc').limit(reach + 1);
    },
    // Kept while the reader hides the list, so going back draws it as it was, the row last shown still there to take the focus.
    gcTime: LIST_KEPT_MS,
  });
  const whole = useWhole();
  const hidden = useHidden();
  const labels = manage.data?.labels ?? NO_LABELS;
  const { names, rowOf } = useRows(manage.data);
  // The copy hands its rows over as an urgent update, which would mount a view's or the next hundred's rows in one go:
  // deferred, React draws them in slices while the rows shown stay up.
  const copied = useDeferredValue(copy.data);
  const reached = useDeferredValue(reach);
  const more = local ? (copied?.length ?? 0) > reached : pages.more;
  const listed: Listed[] = local ? (copied ?? []).slice(0, reached).map(rowOf) : pages.pages.flatMap((page) => page.threads).map(rowOf);
  const threads = listed.filter((t) => !hidden.has(threadKey(t)));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const chosen = threads.filter((t) => selected.has(threadKey(t)));
  const { press, block, ruling, stopRuling, error } = useMailPress();
  const act = (what: 'archive' | 'spam' | 'read' | 'unread') => press(chosen, what, () => setSelected(new Set()));
  const proposals = (suggestions.data?.proposals ?? []).filter((p) => !hidden.has(proposalKey(p)));
  const now = useNow();
  const periods: { title: string | null; rows: Listed[] }[] = [];
  for (const thread of threads) {
    const title = now === null ? null : period(thread.newestAt, now);
    const last = periods.at(-1);
    if (last?.title === title) last.rows.push(thread);
    else periods.push({ title, rows: [thread] });
  }
  const refs = threads.map((t) => ({ ...newest(t), subject: t.subject, threadId: t.threadId }));
  const drawn = useRef({ threads, refs, press, block, onOpen });
  useLayoutEffect(() => {
    drawn.current = { threads, refs, press, block, onOpen };
  });
  const [hands] = useState<Hands>(() => ({
    select: (thread, on) =>
      setSelected((was) => {
        const changed = new Set(was);
        if (on) changed.add(threadKey(thread));
        else changed.delete(threadKey(thread));
        return changed;
      }),
    open: (thread) => {
      const { threads, refs, onOpen } = drawn.current;
      onOpen(
        refs,
        threads.findIndex((t) => threadKey(t) === threadKey(thread)),
      );
    },
    press: (threads, what) => drawn.current.press(threads, what),
    block: (threads) => drawn.current.block(threads),
  }));

  if (manage.data && !on)
    return (
      <Callout title="Inbox is off" action={<TurnInboxOn label="Turn Inbox on" />}>
        <p>
          Read and handle your mail here, with what Mild thinks of each message beside it. Mild keeps a copy of the mail in your inbox to show it; turning Inbox
          off deletes that copy.
        </p>
      </Callout>
    );

  const narrowed = q !== '' || label !== '' || unread === '1' || view !== 'all' || ask.narrowed;
  return (
    <ListView
      search={{ value: search, onChange: setSearch, placeholder: 'Search mail', ask: { onAsk: () => ask.ask(search.trim()), busy: ask.busy } }}
      view={{ label: 'Show', value: view, options: VIEWS, onChange: (next) => setView(next === 'all' ? '' : (next as MailView)) }}
      filters={{
        active: [
          ...(label === '' ? [] : [{ label: `Label: ${names.get(label) ?? label}`, clear: () => setLabel('') }]),
          ...(unread === '1' ? [{ label: 'Unread', clear: () => setUnread('') }] : []),
          ...ask.active,
        ],
        panel: (
          <>
            <FilterGroup label="Label" value={label} options={[['', 'Any'] as const, null, ...inboxFirst(names)]} onChange={setLabel} />
            <Check checked={unread === '1'} onChange={(next) => setUnread(next ? '1' : '')}>
              Unread
            </Check>
          </>
        ),
      }}
      selected={{
        count: chosen.length,
        clear: () => setSelected(new Set()),
        actions: [
          { label: 'Archive', key: 'e', onPress: () => act('archive') },
          { label: 'Spam', key: '!', onPress: () => act('spam') },
          { label: chosen.length === 1 ? 'Block sender' : 'Block senders', key: 'Shift+b', onPress: () => block(chosen, () => setSelected(new Set())) },
          { label: 'Mark read', key: 'Shift+i', onPress: () => act('read') },
          { label: 'Mark unread', key: 'Shift+u', onPress: () => act('unread') },
        ],
      }}
    >
      {ruling ? <RuleDialog labels={labels} start={standingStart({ address: ruling }, 'blocked')} onClose={stopRuling} /> : null}
      {pages.error ? <ErrorNote message={pages.error} /> : null}
      {error ? <ErrorNote message={error} /> : null}
      <Failure>{ask.error}</Failure>
      {ask.said ? (
        <Note>
          <p>{ask.said}</p>
        </Note>
      ) : null}
      {(local ? !copy.isReady || (threads.length === 0 && !whole) : !server || pages.loading) || !manage.data ? (
        loadingRows
      ) : threads.length === 0 ? (
        <Empty>{q !== '' || ask.narrowed ? 'No mail matches.' : narrowed ? 'Nothing in your inbox matches.' : 'Nothing is in your inbox.'}</Empty>
      ) : (
        <>
          <Table keys dense>
            <Heads>
              <Th phone="hide">Select</Th>
              <Th>From</Th>
              <Th phone="hide">Subject</Th>
              <Th phone="hide">Received</Th>
            </Heads>
            {proposals.length > 0 ? (
              <tbody>
                {proposals.map((p) => (
                  <ProposalRow key={p.id} proposal={p} labels={labels} />
                ))}
              </tbody>
            ) : null}
            {periods.map(({ title, rows }) => (
              <tbody key={title ?? ''}>
                {title ? <TrGroup title={title} span={4} /> : null}
                {rows.map((thread) => (
                  <ThreadRow key={threadKey(thread)} thread={thread} labels={labels} selected={selected.has(threadKey(thread))} hands={hands} />
                ))}
              </tbody>
            ))}
          </Table>
          {more ? <More onReach={local ? () => setReach((r) => r + COPY_PAGE) : pages.next} /> : null}
        </>
      )}
    </ListView>
  );
}
