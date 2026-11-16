import { PlusIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAnswer } from '@/components/answer.tsx';
import { StatusWord, Verdict } from '@/components/bits.tsx';
import { MessageBody, SeenFacts } from '@/components/message-parts.tsx';
import { AddLabelDialog } from '@/views/label-panel.tsx';
import { AddRuleDialog } from '@/views/rule-dialog.tsx';
import { type RuleStart, keepStart, messageStart } from '@/lib/rule-start.ts';
import { SenderFacts, SenderLink, senderHref } from '@/components/sender.tsx';
import { type MessageDetail, type RuleMatch, api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, count, dateTime, describeMatch, money, sureness, tier } from '@/lib/format.ts';
import {
  AnswerPicker,
  Button,
  Code,
  Disclosure,
  Failure,
  Loading,
  Look,
  Note,
  Panel,
  Section,
  Table,
  Td,
  TextLink,
  Timeline,
  TimelineEvent,
  Tr,
  useToast,
} from '@/system';

/** Open the message panel on one item of a list, so it can step through the rest. */
export type OpenMessages = (items: MessageRef[], index: number) => void;

export interface MessageRef {
  accountId: string;
  messageId: string;
  subject: string;
}

type Decision = MessageDetail['decisions'][number];
type Action = MessageDetail['actions'][number];

const CHANGE: Record<string, string> = { archive: 'Archived', spam: 'Marked spam', label: 'Labelled', undo: 'Undid a change', unsubscribe: 'Unsubscribed' };

function DecisionEvent({ d }: { d: Decision }) {
  const facts = [
    d.ruleId ? `rule ${d.ruleId}` : null,
    d.confidence === null ? null : `confidence ${d.confidence.toFixed(2)}`,
    d.model ? `${d.model}, ${count(d.inputTokens + d.outputTokens)} tokens, ${money(d.costUsd)}` : null,
    d.durationMs === null ? null : `${count(d.durationMs)} ms`,
  ].filter(Boolean);
  return (
    <TimelineEvent
      at={dateTime(d.decidedAt)}
      title={
        <>
          <span className="font-medium">{d.carryOut ? 'Decided' : 'Suggested'}</span>
          <Verdict labelName={d.labelName} disposition={d.disposition} />
        </>
      }
    >
      <p className="text-foreground">{d.reason}</p>
      <p>
        By {tier(d.stage).name.toLowerCase()}
        {facts.length > 0 ? ` · ${facts.join(' · ')}` : ''}
      </p>
    </TimelineEvent>
  );
}

function ActionEvent({ a, onUndo, busy }: { a: Action; onUndo: (id: number) => void; busy: boolean }) {
  const bad = a.status !== 'done' && a.status !== 'undone';
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
        <>
          <span className="font-medium">{CHANGE[a.type] ?? a.type} in Gmail</span>
          {a.status === 'done' ? null : bad ? (
            <Failure inline>{a.status}</Failure>
          ) : (
            <span className="text-muted-foreground">{a.status === 'undone' ? 'Undone' : a.status}</span>
          )}
        </>
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
      {labels('Added', a.added)}
      {labels('Removed', a.removed)}
      <Failure>{a.error}</Failure>
    </TimelineEvent>
  );
}

/**
 * One message, whichever list it was opened from: its text on the left; on the right what sift said, the
 * answer that confirms or changes it, who sent it, and everything that happened to it. Answering moves to
 * the next item in the list.
 */
function Body({
  detail,
  onPick,
  onAnswered,
  onUndone,
}: {
  detail: MessageDetail;
  /** Show another message from the same sender in this panel. */
  onPick: (messageId: string) => void;
  onAnswered: () => void;
  onUndone: () => void;
}) {
  const waiting = useLoaded(
    `suggestion/${detail.accountId}/${detail.fromAddress}`,
    (signal) => api.suggestion(detail.accountId, detail.fromAddress, signal),
    120_000,
  );
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
  const others = waitingNow.filter((m) => m.messageId !== detail.messageId);
  const labels = manage.data?.labels[detail.accountId] ?? [];
  // Mail sift never decided (the model could not judge it) is answered all the same.
  const target = {
    accountId: detail.accountId,
    sender: detail.fromAddress,
    messageId: detail.messageId,
    labelId: current?.labelId ?? null,
    ...(current ? { decisionId: current.id } : {}),
  };
  const { answer, choices, busy, error } = useAnswer(
    labels,
    waitingNow.map((m) => ({ accountId: detail.accountId, sender: detail.fromAddress, messageId: m.messageId, decisionId: m.decisionId, labelId: m.labelId })),
    onAnswered,
  );
  // What else it might be: the labels the sender's other mail has had, most first.
  const total = detail.sender.labels.reduce((sum, l) => sum + l.messages, 0);
  const alternatives = detail.sender.labels
    .filter((l) => l.id !== current?.labelId)
    .slice(0, 2)
    .map((l) => ({ id: l.id, name: l.name, share: total ? l.messages / total : 0 }));
  const groups = choices(target, current ? sureness(current.stage, current.confidence) : 1, alternatives);
  // Mail that is what Sift says but matters anyway: a rule keeps the sender's mail of that kind, and this message with it.
  const given = labels.find((l) => l.id === current?.labelId);
  const keepable = given && current?.disposition !== 'keep' && given.disposition !== 'keep' && given.disposition !== 'review' ? given : null;
  // A rule covers mail from here on; this message, which may already have been moved, is answered as the rule would.
  const keep = useAction();
  const covers = (match: RuleMatch) =>
    Object.keys(match).length === 1 && (match.from === detail.fromAddress || match.fromDomain === detail.fromAddress.split('@')[1]);
  const keepThis = (labelId: string) =>
    keep.run(async () => {
      const reply = await api.feedback({
        accountId: detail.accountId,
        sender: detail.fromAddress,
        messageId: detail.messageId,
        ...(current ? { decisionId: current.id } : {}),
        scope: 'once',
        label: labelId,
        disposition: 'keep',
      });
      if (reply.notFixed !== null) toast('Could not put the message back in Gmail', { tone: 'failure', description: reply.notFixed });
      onAnswered();
    });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <AnswerPicker
            key={current?.id ?? 'undecided'}
            className="w-72"
            label="What this message is"
            value={current?.labelId ?? null}
            groups={groups}
            empty={<Look>Which label?</Look>}
            busy={busy}
            onSubmit={(id) => answer(target, id)}
            extra={{ label: 'Add a label…', lead: <PlusIcon />, onSelect: () => setAdding(true) }}
          />
          {keepable ? (
            <Button variant="quiet" busy={keep.busy} onClick={() => setRuling(keepStart(detail.fromAddress, keepable.id))}>
              Keep as {keepable.name}…
            </Button>
          ) : null}
          {adding ? <AddLabelDialog accountId={detail.accountId} onClose={() => setAdding(false)} onSaved={() => setAdding(false)} /> : null}
          <span className="flex-1" />
          <Button variant="quiet" onClick={() => setRuling(messageStart(detail.fromAddress, current?.labelId ?? null))}>
            Make a rule…
          </Button>
          {ruling ? (
            <AddRuleDialog
              accountId={detail.accountId}
              labels={labels}
              start={ruling}
              onClose={() => setRuling(null)}
              onAdded={(match, outcome, rule) => {
                toast(`Rule added: ${describeMatch(match)} → ${outcome}`);
                if (rule.whenLabel !== undefined && rule.whenLabel === current?.labelId && rule.disposition === 'keep' && covers(match))
                  keepThis(rule.whenLabel);
              }}
            />
          ) : null}
        </div>
        {current ? (
          <p className="text-muted-foreground">
            {current.reason}
            {current.carryOut ? (
              <>
                {' · '}
                <StatusWord row={current} />
              </>
            ) : null}
          </p>
        ) : null}
        <Failure>{error}</Failure>
        <Failure>{keep.error}</Failure>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <MessageBody detail={detail} />
        <div className="flex min-w-0 flex-col gap-8">
          <Section title="Sender" action={<TextLink href={senderHref(detail.accountId, detail.fromAddress)}>All their mail</TextLink>}>
            <SenderFacts accountId={detail.accountId} profile={detail.sender} />
          </Section>
          <SeenFacts detail={detail} onRule={setRuling} />
          {others.length > 0 ? (
            <Section title="Also waiting" meta={count(others.length)}>
              <div className="max-h-56 overflow-y-auto">
                <Table>
                  <tbody>
                    {others.map((m) => (
                      <Tr key={m.messageId} onOpen={() => onPick(m.messageId)}>
                        <Td className="w-full max-w-0 truncate">{m.subject || '(no subject)'}</Td>
                        <Td num quiet>
                          {ago(m.receivedAt)}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Section>
          ) : null}
          <div className="flex flex-col gap-3">
            {history.length > 0 ? (
              <Disclosure summary={`History · ${history.length}`}>
                <Failure>{undo.error}</Failure>
                <Timeline>{history.map((entry) => entry.node)}</Timeline>
              </Disclosure>
            ) : null}
          </div>
        </div>
      </div>
    </div>
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
}: {
  items: readonly MessageRef[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  // Another message from the same sender, looked at without leaving this place in the list.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [index]);
  const messageId = picked ?? item?.messageId ?? '';
  const { data, error, loading, reload } = useLoaded(`message/${item?.accountId ?? ''}/${messageId}`, (signal) =>
    item ? api.message(item.accountId, messageId, signal) : Promise.reject(new Error('Nothing is open.')),
  );
  if (!item) return null;

  return (
    <Panel
      open
      keys
      onClose={onClose}
      title={(data?.subject ?? (picked ? '' : item.subject)) || '(no subject)'}
      subtitle={
        data ? (
          <span className="flex flex-wrap items-center gap-x-2">
            <SenderLink accountId={data.accountId} address={data.fromAddress} className="text-foreground">
              {data.fromName ?? data.fromAddress}
            </SenderLink>
            {data.fromName ? <span>{data.fromAddress}</span> : null}
            <span aria-hidden>·</span>
            <span className="tabular-nums">{dateTime(data.receivedAt)}</span>
          </span>
        ) : undefined
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
