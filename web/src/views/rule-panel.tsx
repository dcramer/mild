'use client';
import { type LabelSummary, type RuleMatch, type RuleSummary, api, useLoaded } from '@/lib/api.ts';
import { useAction } from '@/lib/action.ts';
import {
  HANDLED,
  INBOX_NAME,
  saidOf,
  count,
  doesName,
  describeMatch,
  factAnswers,
  factWords,
  longDay,
  madeBy,
  duration,
  money,
  moneyTick,
  outcomeName,
  plural,
  roughly,
  shortDate,
  shortDay,
  willBe,
} from '@/lib/format.ts';
import { Verdict } from '@/components/bits.tsx';
import { messageKey, useParam } from '@/lib/params.ts';
import { MatchValue } from '@/components/sender.tsx';
import type { OpenMessages } from '@/lib/open-messages.ts';
import { GmailFilter } from '@/views/gmail-filter.tsx';
import { RuleDialog } from '@/views/rule-dialog.tsx';
import { type ReactNode, useState } from 'react';
import {
  Ago,
  Th,
  Heads,
  Blank,
  Button,
  DeleteButton,
  Dialog,
  Does,
  Empty,
  Fact,
  Facts,
  Failure,
  Figure,
  Figures,
  Loading,
  Panel,
  Reserve,
  Section,
  Share,
  StackedBars,
  Table,
  Td,
  Tr,
  TrGroup,
  useToast,
} from '@/system';
import { usePlan } from '@/components/model-connect.tsx';
import { AT_API_PRICES, approx, costName, priceNote } from '@/lib/prices.ts';
import { reveal } from '@/lib/reveal.ts';

const QUIET: Record<string, string> = {
  fromDomain: 'anyone at',
  fromName: 'named',
  fromNameContains: 'name has',
  to: 'sent to',
  listId: 'the list',
  subjectContains: 'subject has',
};

/** Whether checking the rule's condition costs anything: only a model can say whether mail meets one. */
export const checked = (rule: RuleSummary) => rule.when !== null || rule.checks > 0;

/** What a rule matches: an address alone, or a quiet word and the value; then what the mail must be, in words. */
export function Who({ match }: { match: RuleMatch }) {
  const named = saidOf(match);
  const asked = factAnswers(match.facts).map(factWords);
  return (
    <span className="name">
      {named.map((said) => (
        <span key={`${said.key} ${said.value}`}>
          {said.joint ? <span className="font-normal text-muted-foreground">{said.joint}</span> : null}
          {said.first && QUIET[said.key] ? <span className="font-normal text-muted-foreground">{QUIET[said.key]} </span> : null}
          <MatchValue match={match} said={said} />
        </span>
      ))}
      {asked.length > 0 ? (
        <span className="font-normal">
          <span className="text-muted-foreground">{named.length > 0 ? ', that ' : 'mail that '}</span>
          {asked.join(' and ')}
        </span>
      ) : null}
    </span>
  );
}

/** What a rule is called: its name, or its conditions. */
const ruleTitle = (rule: Pick<RuleSummary, 'name' | 'match'>) => reveal(rule.name) ?? whoText(reveal(rule.match));

export function whoText(match: RuleMatch): string {
  const said = saidOf(match);
  const named = said.map(({ key, value, joint, first }) => `${joint}${first && QUIET[key] ? `${QUIET[key]} ` : ''}${value}`).join('');
  const asked = factAnswers(match.facts).map(factWords);
  return [...(named ? [named] : []), ...(asked.length > 0 ? [`${said.length > 0 ? 'that' : 'mail that'} ${asked.join(' and ')}`] : [])].join(', ');
}

/**
 * What applying the rule to the inbox would do, from the newest mail Gmail finds for it, and the press that
 * starts it. Nothing moves until that press: then it is the user's, carried out whether Mild is on or off.
 */
function ApplyDialog({ rule, onClose }: { rule: RuleSummary; onClose: () => void }) {
  const plan = usePlan();
  // Each look searches Gmail, so it is not repeated on a timer.
  const inbox = useLoaded(`rule-inbox ${rule.id}`, (signal) => api.ruleInbox(rule.id, signal), 0);
  const apply = useAction();
  const toast = useToast();
  const sample = inbox.data;
  const none = sample?.exact === true && sample.messages === 0;
  const cost = sample?.costEach ? sample.costEach * sample.reading : null;
  const action = outcomeName(rule.disposition ?? 'keep');
  return (
    <Dialog
      open
      onClose={onClose}
      title="Apply to your inbox"
      subtitle={
        <>
          {ruleTitle(rule)} → {rule.labelName ? `${rule.labelName} · ` : ''}
          {rule.disposition ? <Does action={rule.disposition}>{outcomeName(rule.disposition)}</Does> : null}
        </>
      }
      footer={
        <>
          <Button
            variant="ink"
            busy={apply.busy}
            disabled={!sample || none}
            onClick={() =>
              apply.run(
                () => api.applyRule(rule.id),
                () => {
                  toast(ruleTitle(rule), { kind: 'Applying to your inbox' });
                  onClose();
                },
              )
            }
          >
            {!sample || none ? 'Apply' : `${action} ${sample.exact ? count(sample.messages) : 'all'}${rule.labelName ? ` as ${rule.labelName}` : ''}`}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Failure>{apply.error}</Failure>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <Failure>{inbox.error}</Failure>
        {inbox.loading ? (
          <Loading rows={5}>
            <Td className="w-full max-w-0">
              <Blank />
            </Td>
            <Td num>
              <Blank word />
            </Td>
          </Loading>
        ) : !sample ? null : none ? (
          <Empty>Nothing in your inbox for this rule.</Empty>
        ) : (
          <>
            <Figures>
              <Figure
                label="In your inbox"
                value={sample.exact ? count(sample.messages) : sample.messages === 0 ? 'A few' : `About ${roughly(sample.messages)}`}
                note={sample.most === null ? null : `the newest ${count(sample.most)}`}
              />
              {sample.reading > 0 ? <Figure label="Need the model" value={sample.exact ? count(sample.reading) : `About ${roughly(sample.reading)}`} /> : null}
              {cost ? <Figure label="About" value={money(cost)} tone="look" note={priceNote(null, plan)} /> : null}
            </Figures>
            {sample.examples.length > 0 ? (
              <Table>
                <Heads>
                  <Th>Message</Th>
                  <Th num>Received</Th>
                </Heads>
                <tbody>
                  <TrGroup title="Newest" span={2} />
                  {sample.examples.map((m) => (
                    <Tr key={m.messageId}>
                      <Td className="w-full max-w-0 truncate">{reveal(m.subject) || '(no subject)'}</Td>
                      <Td num quiet>
                        <Ago at={m.receivedAt} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : null}
            {sample.reading > 0 ? (
              <p className="text-muted-foreground">
                A model reads {sample.reading === sample.messages ? 'each of these' : 'some of these'} first. Those that are {rule.when ?? rule.labelName} are{' '}
                {willBe(rule.disposition ?? 'keep')}; the rest are treated as new mail.
              </p>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** Mail the rule decided that is still waiting in the inbox, how far applying it there has got, and the press that applies it. */
function InInbox({ rule, onOpen }: { rule: RuleSummary; onOpen: OpenMessages }) {
  const waiting = useLoaded(`rule-waiting ${rule.id}`, (signal) => api.ruleWaiting(rule.id, signal));
  const [applying, setApplying] = useParam('apply');
  const stop = useAction();
  const { total = 0, messages = [], applying: going = null } = waiting.data ?? {};
  return (
    <Section
      title="Still in your inbox"
      meta={total > 0 ? count(total) : undefined}
      action={
        going ? (
          <Button variant="plain" busy={stop.busy} onClick={() => stop.run(() => api.stopInbox(rule.id))}>
            Stop
          </Button>
        ) : (
          <Button variant="plain" onClick={() => setApplying('1')}>
            Apply to inbox…
          </Button>
        )
      }
    >
      <Failure>{waiting.error ?? stop.error}</Failure>
      {going ? (
        <div className="flex flex-col gap-2">
          <Share part={going.done} whole={going.listed ? going.total : 0} />
          <span className="text-muted-foreground tabular-nums">
            {going.listed ? `Applying · ${count(going.done)} of ${count(going.total)}` : `Finding them in Gmail · ${count(going.total)} so far`}
          </span>
        </div>
      ) : null}
      {messages.length > 0 ? (
        <>
          <p className="text-muted-foreground">These came before the rule or while Mild was off, so they were not moved.</p>
          <Table>
            <Heads>
              <Th>Message</Th>
              <Th num>Received</Th>
            </Heads>
            <tbody>
              {messages.map((m, index) => (
                <Tr key={m.messageId} onOpen={() => onOpen(messages, index)} holds={[messageKey(m)]}>
                  <Td className="w-full max-w-0 truncate">{reveal(m.subject) || '(no subject)'}</Td>
                  <Td num quiet>
                    <Ago at={m.receivedAt} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {total > messages.length ? <p className="text-muted-foreground">{count(total - messages.length)} more</p> : null}
        </>
      ) : null}
      {applying === '1' ? <ApplyDialog rule={rule} onClose={() => setApplying('')} /> : null}
    </Section>
  );
}

/**
 * How much the rule decided over the last 30 days, by day, then since it was made; for a rule a model
 * checks, what checking cost. A rule is usually opened to see whether it is doing anything.
 */
function Use({ rule }: { rule: RuleSummary }) {
  const plan = usePlan();
  const usage = useLoaded(`rule-usage ${rule.id}`, (signal) => api.ruleUsage(rule.id, signal));
  const daily = usage.data?.daily ?? [];
  const matched = daily.reduce((sum, day) => sum + day.changed + day.left, 0);
  const cost = daily.reduce((sum, day) => sum + day.costUsd, 0);
  return (
    <Reserve id="rule-use" ready={usage.data !== null || usage.error !== null} room="min-h-[280px] lg:min-h-[260px]">
      <div className="flex flex-col gap-5">
        <Failure>{usage.error}</Failure>
        <Figures>
          <Figure
            label="Matched, 30 days"
            value={count(matched)}
            note={
              rule.lastHitAt ? (
                <>
                  last <Ago at={rule.lastHitAt} />
                </>
              ) : null
            }
          />
          {checked(rule) ? (
            <Figure
              label="Cost, 30 days"
              value={approx(rule.checkCost, plan)}
              note={`${plural(rule.checks, 'message')} checked${plan ? `, ${AT_API_PRICES}` : ''}`}
            />
          ) : null}
          {usage.data && usage.data.saved.messages > 0 ? <Figure label="Saved, 30 days" value={duration(usage.data.saved.seconds)} /> : null}
          <Figure label="All time" value={count(rule.hits)} note={`since ${shortDate(rule.createdAt)}`} />
        </Figures>
        {matched > 0 ? (
          <StackedBars
            compact
            series={HANDLED}
            rows={daily.map((day) => ({ key: day.day, label: shortDay(day.day), title: longDay(day.day), values: { changed: day.changed, left: day.left } }))}
            {...(cost > 0 ? { line: { name: costName(plan), values: daily.map((day) => day.costUsd), format: money, tick: moneyTick } } : {})}
          />
        ) : null}
      </div>
    </Reserve>
  );
}

/** Removing a rule, from its panel or, as a trash can, its row. Its Gmail filter goes with it. */
export function RemoveRule({ rule, icon, onRemoved }: { rule: RuleSummary; icon?: ReactNode; onRemoved?: () => void }) {
  const remove = useAction();
  const toast = useToast();
  return (
    <DeleteButton
      question="Remove this rule?"
      what={ruleTitle(rule)}
      {...(rule.filterId ? { says: 'Its Gmail filter is taken out of Gmail too.' } : {})}
      {...(icon ? { icon } : {})}
      onDelete={async () => {
        await remove.settle(() => api.removeRule(rule.id));
        toast(reveal(rule.name) ?? `Mail ${describeMatch(reveal(rule.match))}`, { kind: 'Rule removed' });
        onRemoved?.();
      }}
    >
      Remove
    </DeleteButton>
  );
}

/** One rule, opened from the Rules list or wherever it was just made. */
export function RulePanel({
  rule,
  labels,
  active,
  position,
  onPrevious,
  onNext,
  onOpen,
  onClose,
}: {
  rule: RuleSummary;
  labels: readonly LabelSummary[];
  /** Whether Mild is on, which writing a filter to Gmail needs. */
  active: boolean;
  position?: string;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  /** Opens a message the rule decided, over the rule. */
  onOpen: OpenMessages;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const action = rule.disposition ?? 'keep';
  const labelId = rule.kind === 'label' ? rule.labelId : null;
  // Leave in inbox, or an action rule that keeps mail, changes nothing in the inbox.
  const moves = doesName(labelId, action) !== INBOX_NAME;
  const actions = (
    <>
      <Button variant="plain" onClick={() => setEditing(true)}>
        Change…
      </Button>
      <span className="ml-auto">
        <RemoveRule rule={rule} onRemoved={onClose} />
      </span>
    </>
  );
  return (
    <Panel
      narrow
      open
      onClose={onClose}
      actions={actions}
      title={ruleTitle(rule)}
      {...(position === undefined ? {} : { position })}
      onPrevious={onPrevious}
      onNext={onNext}
    >
      <div className="flex flex-col gap-8">
        <Use rule={rule} />
        <Facts>
          {rule.name ? (
            <Fact term="Mail">
              <Who match={reveal(rule.match)} />
            </Fact>
          ) : null}
          {rule.kind === 'when-label' ? <Fact term="When it is">{rule.labelName}</Fact> : null}
          {rule.when ? <Fact term="Only when it is">{rule.when}</Fact> : null}
          {rule.except.length > 0 ? (
            <Fact term="Unless">
              {rule.except.map((except, index) => (
                <span key={index} className="block">
                  <Who match={reveal(except)} />
                </span>
              ))}
            </Fact>
          ) : null}
          <Fact term="Then">
            <Verdict labelId={labelId} labelName={labelId === null ? null : rule.labelName} disposition={action} />
            {rule.override && rule.kind === 'label' ? <span className="text-muted-foreground">, instead of the label’s</span> : null}
            {[rule.markRead ? 'marked read' : null, rule.unsubscribe ? 'unsubscribed' : null].filter(Boolean).map((extra) => (
              <span key={extra} className="text-muted-foreground">
                , {extra}
              </span>
            ))}
          </Fact>
          <Fact term="Made by">
            {madeBy(rule.source)}, {shortDate(rule.createdAt)}
          </Fact>
        </Facts>
        <GmailFilter rule={rule} active={active} />
        {moves ? <InInbox rule={rule} onOpen={onOpen} /> : null}
      </div>
      {editing ? <RuleDialog labels={labels} editing={rule} onClose={() => setEditing(false)} /> : null}
    </Panel>
  );
}
