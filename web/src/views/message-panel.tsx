'use client';
import { messageKey } from '@/lib/params.ts';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useAnswer } from '@/components/answer.tsx';
import { StatusWord, Verdict } from '@/components/bits.tsx';
import { MessageBody, SeenFacts } from '@/components/message-parts.tsx';
import { AddLabelsDialog } from '@/views/label-panel.tsx';
import { RuleDialog } from '@/views/rule-dialog.tsx';
import { type RuleStart, keepStart, messageStart } from '@/lib/rule-start.ts';
import { ContactHint, SenderFacts, SenderLink, senderHref } from '@/components/sender.tsx';
import { type Confidential, type MessageDetail, type RuleMatch, api, useLoaded } from '@/lib/api.ts';
import { useAction } from '@/lib/action.ts';
import { capitalised, count, dateTime, money, outcomeName, sureness, tier } from '@/lib/format.ts';
import {
  Ago,
  Th,
  Heads,
  AnswerPicker,
  Blank,
  Button,
  Code,
  Disclosure,
  Failure,
  Loading,
  Note,
  Panel,
  Section,
  SomeOf,
  Table,
  Td,
  TextLink,
  Timeline,
  TimelineEvent,
  Tr,
  useToast,
} from '@/system';
import { usePlan } from '@/components/model-connect.tsx';
import { AT_API_PRICES } from '@/lib/prices.ts';
import { reveal } from '@/lib/reveal.ts';

/** Open the message panel on one item of a list, so it can step through the rest. */

export interface MessageRef {
  accountId: string;
  messageId: string;
  /** Null when the list it was opened from does not know it. */
  subject: Confidential | null;
}

type Decision = MessageDetail['decisions'][number];
type Action = MessageDetail['actions'][number];

const CHANGE: Record<string, string> = { archive: 'Archived', spam: 'Marked spam', label: 'Labelled', undo: 'Undid a change', unsubscribe: 'Unsubscribed' };
/** A change that never landed, as the lists say it ("Not archived"): it is tried again, so it is only history. */
const NOT_DONE: Record<string, string> = {
  archive: 'Not archived',
  spam: 'Not marked spam',
  label: 'Not labelled',
  undo: 'Not undone',
  unsubscribe: 'Not unsubscribed',
};

function DecisionEvent({ d }: { d: Decision }) {
  // Through a plan, the call was paid for by it: its cost is only what the API would have charged.
  const plan = usePlan(d.model ?? '');
  const facts = [
    d.ruleId ? `rule ${d.ruleId}` : null,
    d.confidence === null ? null : `confidence ${d.confidence.toFixed(2)}`,
    d.model ? `${d.model}, ${count(d.inputTokens + d.outputTokens)} tokens, ${money(d.costUsd)}${plan ? ` ${AT_API_PRICES}` : ''}` : null,
    d.durationMs === null ? null : `${count(d.durationMs)} ms`,
  ].filter(Boolean);
  return (
    <TimelineEvent
      at={dateTime(d.decidedAt)}
      title={
        <>
          <span className="font-medium">{d.carryOut ? 'Decided' : 'Suggested'}</span>
          <Verdict labelId={d.labelId} labelName={d.labelName} disposition={d.disposition} />
        </>
      }
    >
      <p className="text-foreground">{capitalised(reveal(d.reason))}</p>
      <p>
        By {tier(d.stage).name.toLowerCase()}
        {facts.length > 0 ? ` · ${facts.join(' · ')}` : ''}
      </p>
    </TimelineEvent>
  );
}

/** Where a change got to, when it is not done and did land. */
const ACTION_STATUS: Record<string, string> = { undone: 'Undone', pending: 'Waiting' };

function ActionEvent({ a, onUndo, busy }: { a: Action; onUndo: (id: number) => void; busy: boolean }) {
  const labels = (title: string, list: string[]) =>
    list.length === 0 ? null : (
      <p className="flex flex-wrap items-baseline gap-1.5">
        {title}
        {list.map((label) => (
          <Code key={label}>{label}</Code>
        ))}
      </p>
    );
  return (
    <TimelineEvent
      at={dateTime(a.createdAt)}
      title={
        a.status === 'failed' || a.status === 'unknown' ? (
          <span className="text-muted-foreground">{NOT_DONE[a.type] ?? a.type}</span>
        ) : (
          <>
            <span className="font-medium">{CHANGE[a.type] ?? a.type} in Gmail</span>
            {a.status === 'done' ? null : <span className="text-muted-foreground">{ACTION_STATUS[a.status] ?? a.status}</span>}
          </>
        )
      }
      {...(a.status === 'done' && a.type !== 'undo' && a.type !== 'unsubscribe'
        ? {
            action: (
              <Button busy={busy} onClick={() => onUndo(a.id)}>
                Undo
              </Button>
            ),
          }
        : {})}
    >
      {labels('Added', reveal(a.added))}
      {labels('Removed', reveal(a.removed))}
    </TimelineEvent>
  );
}

/**
 * One message, whichever list it was opened from: the message on the left; on the right everything for
 * answering it, top to bottom: what Sift said and the answer that confirms or changes it, who sent it, what
 * Sift saw, and what happened to it. On a phone the answer comes first, then the message. Answering moves
 * to the next item in the list.
 */
function Body({
  detail,
  onPick,
  onAnswered,
  onUndone,
}: {
  detail: MessageDetail;
  /** Show another message from the same sender in this panel. */
  onPick: (message: Pick<MessageRef, 'accountId' | 'messageId'>) => void;
  onAnswered: () => void;
  onUndone: () => void;
}) {
  const waiting = useLoaded(`suggestion/${reveal(detail.fromAddress)}`, (signal) => api.suggestion(reveal(detail.fromAddress), signal), 120_000);
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  const undo = useAction();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  // The rule dialog, opened in place on what this message shows: its sender and label, or one thing sift saw in it.
  const [ruling, setRuling] = useState<RuleStart | null>(null);
  const history = [
    ...detail.decisions.map((d) => ({ at: d.decidedAt, order: 0, node: <DecisionEvent key={`d${d.id}`} d={d} /> })),
    ...detail.actions.map((a) => ({
      at: a.createdAt,
      order: 1,
      node: (
        <ActionEvent
          key={`a${a.id}`}
          a={a}
          busy={undo.busy}
          onUndo={(id) =>
            undo.run(async () => {
              const { message } = await api.undo(id);
              if (message) toast(message);
              onUndone();
            })
          }
        />
      ),
    })),
  ].toSorted((x, y) => x.at - y.at || x.order - y.order);
  const current = detail.decisions.at(-1);
  const waitingNow = waiting.data?.messages ?? [];
  const others = waitingNow.filter((m) => m.accountId !== detail.accountId || m.messageId !== detail.messageId);
  const labels = manage.data?.labels ?? [];
  // Mail sift never decided (the model could not judge it) is answered all the same.
  const target = {
    accountId: detail.accountId,
    sender: detail.fromAddress,
    messageId: detail.messageId,
    labelId: current?.labelId ?? null,
    ...(current ? { decisionId: current.id } : {}),
  };
  const { answer, choices } = useAnswer(
    labels,
    waitingNow.map((m) => ({
      accountId: m.accountId,
      sender: reveal(detail.fromAddress),
      messageId: m.messageId,
      decisionId: m.decisionId,
      labelId: m.labelId,
    })),
    onAnswered,
  );
  // What else it might be: the labels the sender's other mail has had, most first.
  const total = detail.sender.labels.reduce((sum, l) => sum + l.messages, 0);
  const alternatives = detail.sender.labels
    .filter((l) => l.id !== current?.labelId)
    .slice(0, 2)
    .map((l) => ({ id: l.id, name: l.name, share: total ? l.messages / total : 0 }));
  const groups = choices(reveal(target), current ? sureness(current) : 1, alternatives);
  // Mail that is what Sift says but matters anyway: a rule keeps the sender's mail of that kind, and this message with it.
  const given = labels.find((l) => l.id === current?.labelId);
  const keepable = given && current?.disposition !== 'keep' && given.disposition !== 'keep' && given.disposition !== 'review' ? given : null;
  // A rule covers mail from here on; this message, which may already have been moved, is answered as the rule would.
  const keep = useAction();
  const covers = (match: RuleMatch) =>
    Object.keys(match).length === 1 &&
    ((match.from ?? []).includes(reveal(detail.fromAddress)) || (match.fromDomain ?? []).includes(reveal(detail.fromAddress).split('@')[1] ?? ''));
  const keepThis = (labelId: string) => {
    keep.hide([messageKey(detail)], 'Could not save your answer', async () => {
      const reply = await api.feedback({
        accountId: detail.accountId,
        sender: reveal(detail.fromAddress),
        messageId: detail.messageId,
        ...(current ? { decisionId: current.id } : {}),
        label: labelId,
        disposition: 'keep',
      });
      if (reply.notFixed !== null) toast('Could not put the message back in Gmail', { tone: 'failure', description: reply.notFixed });
    });
    onAnswered();
  };

  return (
    // On a phone the answer comes first, then the message, then the rest. On a desktop the message fills the
    // height beside one column that scrolls on its own; that column reaches into the panel's gutters, so its
    // rows' hover and its scrollbar sit where the page's would.
    <div className="flex flex-col gap-10 lg:grid lg:h-full lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[minmax(0,1fr)] lg:gap-12 2xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-h-0 min-w-0 flex-col max-lg:order-2">
        <MessageBody detail={detail} />
      </div>
      <div className="max-lg:contents lg:-mt-1 lg:-mr-6 lg:-mb-6 lg:-ml-4 lg:flex lg:flex-col lg:gap-8 lg:overflow-x-hidden lg:overflow-y-auto lg:pt-1 lg:pr-6 lg:pb-6 lg:pl-4">
        <div className="flex min-w-0 flex-col gap-3 max-lg:order-1">
          <AnswerPicker
            key={current?.id ?? 'undecided'}
            className="min-w-0"
            label="What this message is"
            value={current?.labelId ?? null}
            groups={groups}
            empty={outcomeName('review')}
            onSubmit={(id) => answer(reveal(target), id)}
            extra={{ label: 'Add a label…', lead: <PlusIcon />, onSelect: () => setAdding(true) }}
          />
          {current ? (
            <p className="text-muted-foreground">
              {capitalised(reveal(current.reason))}
              {current.carryOut ? (
                <>
                  {' · '}
                  <StatusWord row={current} />
                </>
              ) : null}
            </p>
          ) : null}
          <div className="-ml-3 flex flex-wrap items-center gap-1">
            {keepable ? (
              <Button variant="quiet" onClick={() => setRuling(keepStart(reveal(detail.fromAddress), keepable.id))}>
                Keep as {keepable.name}…
              </Button>
            ) : null}
            <Button variant="quiet" onClick={() => setRuling(messageStart(reveal(detail.fromAddress), current?.labelId ?? null))}>
              Make a rule…
            </Button>
          </div>
          {adding ? <AddLabelsDialog onClose={() => setAdding(false)} onSaved={() => setAdding(false)} /> : null}
          {ruling ? (
            <RuleDialog
              labels={labels}
              start={ruling}
              onClose={() => setRuling(null)}
              onAdded={(match, rule) => {
                if (rule.whenLabel !== undefined && rule.whenLabel === current?.labelId && rule.disposition === 'keep' && covers(match))
                  keepThis(rule.whenLabel);
              }}
            />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-8 max-lg:order-3">
          <Section title="Sender" action={<TextLink href={senderHref(reveal(detail.fromAddress))}>All their mail</TextLink>}>
            <SenderFacts profile={detail.sender} />
          </Section>
          <SeenFacts detail={detail} onRule={setRuling} />
          {others.length > 0 ? (
            <Section title="Also waiting" meta={count(others.length)}>
              <div className="max-h-56 overflow-y-auto">
                <Table>
                  <Heads>
                    <Th>Message</Th>
                    <Th num>Received</Th>
                  </Heads>
                  <tbody>
                    {others.map((m) => (
                      <Tr key={`${m.accountId}/${m.messageId}`} onOpen={() => onPick(m)}>
                        <Td className="w-full max-w-0 truncate">{reveal(m.subject) || '(no subject)'}</Td>
                        <Td num quiet>
                          <Ago at={m.receivedAt} />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Section>
          ) : null}
          {/* After "Also waiting" has loaded, which would otherwise push it down from under the pointer. */}
          {history.length > 0 && !waiting.loading ? (
            <Disclosure summary={`History · ${history.length}`}>
              <Failure>{undo.error}</Failure>
              <Timeline>{history.map((entry) => entry.node)}</Timeline>
            </Disclosure>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const people = (list: MessageDetail['to']) => list.map((p) => reveal(p.address));

/** Who a message went to, unless that was the account alone, which says nothing. A long list folds, so the panel's header never fills the screen. */
function AddressedTo({ detail }: { detail: MessageDetail }) {
  if (detail.cc.length === 0 && detail.to.every((p) => reveal(p.address) === detail.accountId)) return null;
  return (
    <span className="mt-0.5 block">
      {detail.to.length > 0 ? (
        <>
          To <SomeOf items={people(detail.to)} />
        </>
      ) : null}
      {detail.cc.length > 0 ? (
        <>
          {detail.to.length > 0 ? ', cc ' : 'Cc '}
          <SomeOf items={people(detail.cc)} />
        </>
      ) : null}
    </span>
  );
}

/**
 * The panel every list opens a message in. `items` is the list it was opened from and `index` the one
 * showing, so previous, next and "answer, then the next one" all follow the list.
 */
export function MessagePanel({
  items,
  index,
  onIndex,
  onClose,
  onClosing,
}: {
  items: readonly MessageRef[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onClosing: () => void;
}) {
  const item = items[index];
  // Another message from the same sender, looked at without leaving this place in the list.
  const [picked, setPicked] = useState<Pick<MessageRef, 'accountId' | 'messageId'> | null>(null);
  const [shownAt, setShownAt] = useState(index);
  if (shownAt !== index) {
    setShownAt(index);
    setPicked(null);
  }
  const shown = picked ?? item;
  const { data, error, loading, reload } = useLoaded(`message/${shown?.accountId ?? ''}/${shown?.messageId ?? ''}`, (signal) =>
    shown ? api.message(shown.accountId, shown.messageId, signal) : Promise.reject(new Error('Nothing is open.')),
  );
  if (!item) return null;

  return (
    <Panel
      open
      keys
      onClose={onClose}
      onClosing={onClosing}
      returnTo={messageKey(item)}
      title={(reveal(data?.subject) ?? (picked ? null : reveal(item.subject))) || '(no subject)'}
      subtitle={
        data ? (
          <>
            <span className="flex flex-wrap items-center gap-x-2">
              <SenderLink address={reveal(data.fromAddress)} name={reveal(data.fromName)} className="text-foreground">
                {reveal(data.fromName) ?? reveal(data.fromAddress)}
              </SenderLink>
              <ContactHint contact={data.sender.contact} />
              {data.fromName ? <SenderLink address={reveal(data.fromAddress)} className="min-w-0 break-all" /> : null}
              <span aria-hidden className="max-sm:hidden">
                ·
              </span>
              <span className="tabular-nums max-sm:basis-full">{dateTime(data.receivedAt)}</span>
            </span>
            <AddressedTo detail={data} />
          </>
        ) : (
          // Holds the line the sender and date will take, so the message does not drop when they arrive.
          <Blank />
        )
      }
      position={items.length > 1 ? `${index + 1} of ${items.length}` : undefined}
      onPrevious={index > 0 ? () => onIndex(index - 1) : undefined}
      onNext={index < items.length - 1 ? () => onIndex(index + 1) : undefined}
    >
      {loading ? (
        <Loading rows={6} />
      ) : data ? (
        <Body
          key={`${data.accountId}/${data.messageId}`}
          detail={data}
          onPick={setPicked}
          onUndone={reload}
          onAnswered={() => {
            if (index < items.length - 1) onIndex(index + 1);
            else onClose();
          }}
        />
      ) : (
        <Note tone="failure" title="Could not load this message">
          <p>{error}</p>
        </Note>
      )}
    </Panel>
  );
}
