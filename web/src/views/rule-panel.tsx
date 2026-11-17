import { type RuleMatch, type RuleSummary, api, useAction, useLoaded } from '@/lib/api.ts';
import {
  HANDLED,
  INBOX_NAME,
  ago,
  saidOf,
  count,
  doesName,
  describeMatch,
  factAnswers,
  factWords,
  longDay,
  madeBy,
  money,
  moneyTick,
  outcomeName,
  plural,
  shortDate,
  shortDay,
  willBe,
} from '@/lib/format.ts';
import { Verdict } from '@/components/bits.tsx';
import { messageKey, useParam } from '@/lib/route.ts';
import { MatchValue } from '@/components/sender.tsx';
import type { OpenMessages } from '@/views/message-panel.tsx';
import { GmailFilter } from '@/views/gmail-filter.tsx';
import {
  Blank,
  Button,
  ConfirmButton,
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
  StackedBars,
  Table,
  Td,
  Tr,
  TrGroup,
  useToast,
} from '@/system';

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
export function Who({ accountId, match }: { accountId: string; match: RuleMatch }) {
  const named = saidOf(match);
  const asked = factAnswers(match.facts).map(factWords);
  return (
    <span className="name">
      {named.map((said) => (
        <span key={`${said.key} ${said.value}`}>
          {said.joint ? <span className="font-normal text-muted-foreground">{said.joint}</span> : null}
          {said.first && QUIET[said.key] ? <span className="font-normal text-muted-foreground">{QUIET[said.key]} </span> : null}
          <MatchValue accountId={accountId} match={match} said={said} />
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
const ruleTitle = (rule: Pick<RuleSummary, 'name' | 'match'>) => rule.name ?? whoText(rule.match);

export function whoText(match: RuleMatch): string {
  const said = saidOf(match);
  const named = said.map(({ key, value, joint, first }) => `${joint}${first && QUIET[key] ? `${QUIET[key]} ` : ''}${value}`).join('');
  const asked = factAnswers(match.facts).map(factWords);
  return [...(named ? [named] : []), ...(asked.length > 0 ? [`${said.length > 0 ? 'that' : 'mail that'} ${asked.join(' and ')}`] : [])].join(', ');
}

/** "Archive 20 as Marketing", and what a model must read first. */
function applyWords(rule: RuleSummary, deciding: number, reading: number): string {
  const action = outcomeName(rule.disposition ?? 'keep');
  const read = reading > 0 ? `read ${count(reading)}` : '';
  if (deciding === 0) return read.replace(/^r/, 'R');
  return `${action} ${count(deciding)}${rule.labelName ? ` as ${rule.labelName}` : ''}${read ? `, ${read}` : ''}`;
}

/**
 * What applying the rule would do in the inbox now, read from Gmail, and the press that does it. Nothing
 * moves until that press: then it is the user's, carried out whether Sift is on or off.
 */
function ApplyDialog({ rule, onClose }: { rule: RuleSummary; onClose: () => void }) {
  // Each look searches Gmail, so it is not repeated on a timer.
  const inbox = useLoaded(`rule-inbox ${rule.id}`, (signal) => api.ruleInbox(rule.id, signal), 0);
  const apply = useAction();
  const toast = useToast();
  const matches = inbox.data?.matches ?? [];
  const groups = [
    { title: 'Sift has seen', rows: matches.filter((m) => m.seen && !m.reads) },
    { title: 'Found in Gmail', rows: matches.filter((m) => !m.seen && !m.reads) },
    { title: 'Sift reads these first', rows: matches.filter((m) => m.reads) },
  ].filter((g) => g.rows.length > 0);
  const reading = matches.filter((m) => m.reads).length;
  const deciding = matches.length - reading;
  const cost = inbox.data?.costEach;
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
            disabled={matches.length === 0}
            onClick={() =>
              apply.run(
                () =>
                  api.applyRule(
                    rule.id,
                    matches.map((m) => m.messageId),
                  ),
                () => {
                  toast(`Applied to ${plural(matches.length, 'message')}`);
                  onClose();
                },
              )
            }
          >
            {matches.length === 0 ? 'Apply' : applyWords(rule, deciding, reading)}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Failure>{apply.error}</Failure>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Failure>{inbox.error}</Failure>
        {inbox.loading ? (
          <Loading rows={4}>
            <Td className="w-full max-w-0">
              <Blank />
            </Td>
            <Td num>
              <Blank word />
            </Td>
          </Loading>
        ) : inbox.data && matches.length === 0 ? (
          <Empty>Nothing in your inbox for this rule.</Empty>
        ) : (
          <Table>
            <tbody>
              {groups.map((group) => [
                <TrGroup key={group.title} title={`${group.title} · ${count(group.rows.length)}`} span={2} />,
                ...group.rows.map((m) => (
                  <Tr key={m.messageId}>
                    <Td className="w-full max-w-0 truncate">{m.subject || '(no subject)'}</Td>
                    <Td num quiet>
                      {ago(m.receivedAt)}
                    </Td>
                  </Tr>
                )),
              ])}
            </tbody>
          </Table>
        )}
        {reading > 0 ? (
          <p className="text-muted-foreground">
            A model reads each of these first{cost ? `, ${cost * reading < 0.01 ? 'under a cent' : `about ${money(cost * reading)}`} in all` : ''}. Those that
            are {rule.when ?? rule.labelName} are {willBe(rule.disposition ?? 'keep')}; the rest are treated as new mail.
          </p>
        ) : null}
        {inbox.data?.capped ? <p className="text-muted-foreground">Only the newest 300 in your inbox were looked at.</p> : null}
      </div>
    </Dialog>
  );
}

/** Mail the rule decided that is still waiting in the inbox, and the press that applies the rule there. */
function InInbox({ rule, onOpen }: { rule: RuleSummary; onOpen: OpenMessages }) {
  const waiting = useLoaded(`rule-waiting ${rule.id}`, (signal) => api.ruleWaiting(rule.id, signal));
  const [applying, setApplying] = useParam('apply');
  const { total = 0, messages = [] } = waiting.data ?? {};
  return (
    <Section
      title="Still in your inbox"
      meta={total > 0 ? count(total) : undefined}
      action={
        <Button variant="plain" onClick={() => setApplying('1')}>
          Apply to inbox…
        </Button>
      }
    >
      <Failure>{waiting.error}</Failure>
      {messages.length > 0 ? (
        <>
          <p className="text-muted-foreground">These came before the rule or while Sift was off, so they were not moved.</p>
          <Table>
            <tbody>
              {messages.map((m, index) => (
                <Tr key={m.messageId} onOpen={() => onOpen(messages, index)} holds={[messageKey(m)]}>
                  <Td className="w-full max-w-0 truncate">{m.subject || '(no subject)'}</Td>
                  <Td num quiet>
                    {ago(m.receivedAt)}
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
  const usage = useLoaded(`rule-usage ${rule.id}`, (signal) => api.ruleUsage(rule.id, signal));
  const daily = usage.data?.daily ?? [];
  const matched = daily.reduce((sum, day) => sum + day.changed + day.left, 0);
  const cost = daily.reduce((sum, day) => sum + day.costUsd, 0);
  return (
    <Reserve id="rule-use" ready={usage.data !== null || usage.error !== null} room={{ narrow: 280, wide: 260 }}>
      <div className="flex flex-col gap-5">
        <Failure>{usage.error}</Failure>
        <Figures>
          <Figure label="Matched, 30 days" value={count(matched)} note={rule.lastHitAt ? `last ${ago(rule.lastHitAt)}` : null} />
          {checked(rule) ? <Figure label="Cost, 30 days" value={money(rule.checkCost)} note={`${plural(rule.checks, 'message')} checked`} /> : null}
          <Figure label="All time" value={count(rule.hits)} note={`since ${shortDate(rule.createdAt)}`} />
        </Figures>
        {matched > 0 ? (
          <StackedBars
            compact
            series={HANDLED}
            rows={daily.map((day) => ({ key: day.day, label: shortDay(day.day), title: longDay(day.day), values: { changed: day.changed, left: day.left } }))}
            {...(cost > 0 ? { line: { name: 'Model cost', values: daily.map((day) => day.costUsd), format: money, tick: moneyTick } } : {})}
          />
        ) : null}
      </div>
    </Reserve>
  );
}

/** One rule, opened from the Rules list or wherever it was just made. */
export function RulePanel({
  rule,
  active,
  position,
  onPrevious,
  onNext,
  onOpen,
  onClose,
}: {
  rule: RuleSummary;
  /** Whether Sift is on, which writing a filter to Gmail needs. */
  active: boolean;
  position?: string;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  /** Opens a message the rule decided, over the rule. */
  onOpen: OpenMessages;
  onClose: () => void;
}) {
  const remove = useAction();
  const toast = useToast();
  const action = rule.disposition ?? 'keep';
  const labelId = rule.kind === 'label' ? rule.labelId : null;
  // Leave in inbox, or an action rule that keeps mail, changes nothing in the inbox.
  const moves = doesName(labelId, action) !== INBOX_NAME;
  return (
    <Panel narrow open onClose={onClose} title={ruleTitle(rule)} {...(position === undefined ? {} : { position })} onPrevious={onPrevious} onNext={onNext}>
      <div className="flex flex-col gap-8">
        <Use rule={rule} />
        <Facts>
          {rule.name ? (
            <Fact term="Mail">
              <Who accountId={rule.accountId} match={rule.match} />
            </Fact>
          ) : null}
          {rule.kind === 'when-label' ? <Fact term="When it is">{rule.labelName}</Fact> : null}
          {rule.when ? <Fact term="Only when it is">{rule.when}</Fact> : null}
          {rule.except.length > 0 ? (
            <Fact term="Unless">
              {rule.except.map((except, index) => (
                <span key={index} className="block">
                  <Who accountId={rule.accountId} match={except} />
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
        <div>
          <ConfirmButton
            question="Remove this rule?"
            variant="plain"
            disabled={remove.busy}
            onConfirm={() =>
              remove.run(
                () => api.removeRule(rule.id),
                () => {
                  toast(rule.name ?? `Mail ${describeMatch(rule.match)}`, { kind: 'Rule removed' });
                  onClose();
                },
              )
            }
          >
            Remove
          </ConfirmButton>
          <Failure>{remove.error}</Failure>
        </div>
      </div>
    </Panel>
  );
}

/** A rule opened by id away from the Rules list, as when one has just been made. */
export function RuleSheet({ id, onOpen, onClose }: { id: string; onOpen: OpenMessages; onClose: () => void }) {
  const rules = useLoaded('rules', (signal) => api.rules(signal));
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  const rule = rules.data?.rules.find((r) => r.id === id);
  return rule ? <RulePanel key={rule.id} rule={rule} active={manage.data?.active ?? false} onOpen={onOpen} onClose={onClose} /> : null;
}
