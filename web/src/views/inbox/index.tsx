'use client';
import { ArchiveIcon, BanIcon, MailIcon, MailOpenIcon, ShieldAlertIcon } from 'lucide-react';
import { type ReactNode, useContext, useDeferredValue, useEffect } from 'react';
import { RuleDialog } from '@/components/rule-dialog.tsx';
import { standingStart } from '@/lib/rule-start.ts';
import type { AnswerLabel } from '@/components/answer.tsx';
import { ErrorNote } from '@/components/bits.tsx';
import { useAsk } from '@/components/ask.tsx';
import { TurnInboxOn } from '@/components/inbox-switch.tsx';
import { DraftList, useAnswersBegun } from '@/components/drafts.tsx';
import { useMailPress } from '@/components/mail.tsx';
import type { MailView } from '@/lib/api/endpoints.ts';
import { useShown } from '@/lib/telemetry.ts';
import { Mailbox } from '@/lib/narrowed.ts';
import { useHidden } from '@/components/action.ts';
import { inboxFirst } from '@/lib/words.ts';
import { period } from '@/lib/format.ts';
import { proposalKey, threadKey } from '@/lib/rows.ts';
import { useParam } from '@/lib/params.ts';
import { Callout, Check, Empty, Failure, FilterGroup, Heads, ListView, More, Note, Table, Td, Th, TrGroup, useNow, Loading, Blank, OnPhone } from '@/system';
import { useManage, useSuggestions, readTopAhead } from '@/lib/api/reads.ts';
import { useConversations } from './conversations.ts';
import { useHands } from './hands.ts';
import { type Listed, newest, useRows } from './listed.ts';
import { ProposalRow } from './proposal-row.tsx';
import { ThreadRow } from './thread-row.tsx';

/** What Inbox shows: its conversations, narrowed or not, or the mail begun and not sent. */
type Shown = MailView | 'drafts';

const VIEWS = [
  ['all', 'Everything'],
  ['needs', 'Needs you'],
  ['sorted', 'Sorted'],
  ['drafts', 'Drafts'],
] as const satisfies readonly (readonly [Shown, string])[];

const NO_LABELS: readonly AnswerLabel[] = [];

/** The conversations under the heading of when they came, Today and so on; none until the page knows the time. */
function byPeriod(threads: readonly Listed[], now: number | null) {
  const periods: { title: string | null; rows: Listed[] }[] = [];
  for (const thread of threads) {
    const title = now === null ? null : period(thread.newestAt, now);
    const last = periods.at(-1);
    if (last?.title === title) last.rows.push(thread);
    else periods.push({ title, rows: [thread] });
  }
  return periods;
}

/** Inbox: the conversations in the inbox, as a mail app lists them, with what Mild thinks of each; a search looks through all the mail Mild keeps. */
export function InboxView({ loading: loadingRows }: { loading: ReactNode }) {
  const manage = useManage();
  const [search, setSearch] = useParam('q');
  const [label, setLabel] = useParam('label');
  // Everything is the list unnarrowed, with nothing in the address.
  const [asked, setView] = useParam<Shown | ''>('view', VIEWS);
  const shown = asked || 'all';
  const drafting = shown === 'drafts';
  // Drafts are not conversations: the list of them stands in for the inbox's.
  const view: MailView = drafting ? 'all' : shown;
  const [unread, setUnread] = useParam('unread');
  // Rules Mild proposes, at the top of the inbox: For review is not a section of its own while Inbox is on.
  const suggestions = useSuggestions();
  const q = useDeferredValue(search.trim());
  const ask = useAsk();
  const on = manage.data?.mail === true;
  const mailbox = useContext(Mailbox);
  const hidden = useHidden();
  const labels = manage.data?.labels ?? NO_LABELS;
  const { names, rowOf } = useRows(manage.data);
  const begun = useAnswersBegun();
  const list = useConversations({ on, drafting, view, label, unread, q, ask, mailbox, hidden, rowOf });
  const { local, threads } = list;
  const mail = useMailPress();
  // The label each row shows, with its own action: Archive and Spam give it, however sure Mild was.
  const labelled = (rows: readonly Listed[]) =>
    rows.map((t) => {
      const label = labels.find((l) => l.id === t.thinks?.labelId);
      return { ...t, label: label ? { name: label.name, does: label.disposition } : null };
    });
  const press = (rows: readonly Listed[], what: 'archive' | 'spam' | 'read' | 'unread', then?: () => void) => mail.press(labelled(rows), what, then);
  const block = (rows: readonly Listed[], then?: () => void) => mail.block(labelled(rows), then);
  const { ruling, stopRuling } = mail;
  const proposals = (suggestions.data?.proposals ?? []).filter((p) => !hidden.has(proposalKey(p)));
  const now = useNow();
  const periods = byPeriod(threads, now);
  const refs = threads.map((t) => ({ ...newest(t), subject: t.subject, threadId: t.threadId }));
  useEffect(() => readTopAhead(refs));
  const { selected, setSelected, hands } = useHands({ threads, refs, press, block });
  const chosen = threads.filter((t) => selected.has(threadKey(t)));
  const act = (what: 'archive' | 'spam' | 'read' | 'unread') => press(chosen, what, () => setSelected(new Set()));

  const waiting = list.waiting || !manage.data;
  useShown('Inbox rows', !waiting, { rows: threads.length, from: local ? 'copy' : 'server' });

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
      view={{ label: 'Show', value: shown, options: VIEWS, onChange: (next) => setView(next === 'all' ? '' : (next as Shown)) }}
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
        all: { total: threads.length, select: () => setSelected(new Set(threads.map(threadKey))) },
        actions: [
          { label: 'Archive', key: 'Shift+e', onPress: () => act('archive') },
          { label: 'Spam', key: '!', onPress: () => act('spam') },
          { label: chosen.length === 1 ? 'Block sender' : 'Block senders', key: 'Shift+b', onPress: () => block(chosen, () => setSelected(new Set())) },
          { label: 'Mark read', key: 'Shift+i', onPress: () => act('read') },
          { label: 'Mark unread', key: 'Shift+u', onPress: () => act('unread'), tucked: true },
        ],
        thumbs: [
          { label: 'Archive', icon: <ArchiveIcon />, onPress: () => act('archive') },
          chosen.some((t) => t.unread)
            ? { label: 'Read', icon: <MailOpenIcon />, onPress: () => act('read') }
            : { label: 'Unread', icon: <MailIcon />, onPress: () => act('unread') },
          { label: 'Spam', icon: <ShieldAlertIcon />, onPress: () => act('spam') },
          { label: 'Block', icon: <BanIcon />, onPress: () => block(chosen, () => setSelected(new Set())) },
        ],
      }}
    >
      {ruling ? <RuleDialog labels={labels} start={standingStart({ address: ruling }, 'blocked')} onClose={stopRuling} /> : null}
      {list.error ? <ErrorNote message={list.error} /> : null}
      <Failure>{ask.error}</Failure>
      {ask.said ? (
        <Note>
          <p>{ask.said}</p>
        </Note>
      ) : null}
      {drafting ? (
        <DraftList mailbox={mailbox} />
      ) : waiting ? (
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
              // Not something the search found.
              <tbody className="phone:[html:has([data-searching])_&]:hidden">
                {proposals.map((p) => (
                  <ProposalRow key={p.id} proposal={p} labels={labels} />
                ))}
              </tbody>
            ) : null}
            {periods.map(({ title, rows }) => (
              <tbody key={title ?? ''}>
                {title ? <TrGroup title={title} span={4} /> : null}
                {rows.map((thread) => (
                  <ThreadRow
                    key={threadKey(thread)}
                    thread={thread}
                    labels={labels}
                    selected={selected.has(threadKey(thread))}
                    begun={thread.messageIds.some((id) => begun?.has(id))}
                    hands={hands}
                  />
                ))}
              </tbody>
            ))}
          </Table>
          {list.more ? <More onReach={list.next} /> : null}
        </>
      )}
    </ListView>
  );
}

/** Inbox's rows while they load. */
export function InboxLoading() {
  return (
    <Loading dense>
      <Td phone="hide" className="w-px">
        <Blank className="size-3.5" />
      </Td>
      <Td className="max-w-0 md:w-[18%] md:min-w-40">
        <Blank />
        <OnPhone>
          <span className="w-full text-base">
            <Blank />
          </span>
          <Blank />
        </OnPhone>
      </Td>
      <Td phone="hide" className="max-w-0 md:w-full">
        <Blank />
      </Td>
      <Td phone="hide" num>
        <Blank word />
      </Td>
    </Loading>
  );
}
