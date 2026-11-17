import { type RuleMatch, type RuleSummary, api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, saidOf, count, describeMatch, factAnswers, factWords, madeBy, money, outcomeName, plural, shortDate, willBe } from '@/lib/format.ts';
import { setParams, useParam } from '@/lib/route.ts';
import { InGmail } from '@/views/gmail-filter.tsx';
import { Blank, Button, ConfirmButton, Dialog, Does, Empty, Fact, Facts, Failure, Loading, Panel, Section, Table, Td, Tr, TrGroup, useToast } from '@/system';

const QUIET: Record<string, string> = {
  fromDomain: 'anyone at',
  fromName: 'named',
  fromNameContains: 'name has',
  to: 'sent to',
  listId: 'the list',
  subjectContains: 'subject has',
};

/** What a rule matches: an address alone, or a quiet word and the value; then what the mail must be, in words. */
export function Who({ match }: { match: RuleMatch }) {
  const named = saidOf(match);
  const asked = factAnswers(match.facts).map(factWords);
  return (
    <span className="name">
      {named.map(({ key, value, joint, first }) => (
        <span key={`${key} ${value}`}>
          {joint ? <span className="font-normal text-muted-foreground">{joint}</span> : null}
          {first && QUIET[key] ? <span className="font-normal text-muted-foreground">{QUIET[key]} </span> : null}
          {value}
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

/** A message opened over the rule, in the panel every list opens one in. */
const openMessage = (accountId: string, messageId: string) => setParams({ message: messageId, account: accountId }, { state: { panel: true } });

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
function InInbox({ rule }: { rule: RuleSummary }) {
  const waiting = useLoaded(`rule-waiting ${rule.id}`, (signal) => api.ruleWaiting(rule.id, signal));
  const [applying, setApplying] = useParam('apply');
  const { total = 0, messages = [] } = waiting.data ?? {};
  return (
    <Section
      title="In your inbox"
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
          <p className="text-muted-foreground">This rule decided these, but they came before it or while Sift was off, so they were not moved.</p>
          <Table>
            <tbody>
              {messages.map((m) => (
                <Tr key={m.messageId} onOpen={() => openMessage(m.accountId, m.messageId)}>
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

/** One rule, opened from the Rules list or wherever it was just made. */
export function RulePanel({
  rule,
  active,
  position,
  onPrevious,
  onNext,
  onClose,
}: {
  rule: RuleSummary;
  /** Whether Sift is on, which writing a filter to Gmail needs. */
  active: boolean;
  position?: string;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  onClose: () => void;
}) {
  const remove = useAction();
  const toast = useToast();
  const action = rule.disposition;
  // An action rule that keeps mail changes nothing in the inbox.
  const moves = !(rule.kind === 'action' && action === 'keep');
  return (
    <Panel open onClose={onClose} title={ruleTitle(rule)} {...(position === undefined ? {} : { position })} onPrevious={onPrevious} onNext={onNext}>
      <div className="flex flex-col gap-10">
        <Facts>
          {rule.name ? (
            <Fact term="Mail">
              <Who match={rule.match} />
            </Fact>
          ) : null}
          {rule.kind === 'action' ? null : <Fact term={rule.kind === 'when-label' ? 'When it is' : 'Is'}>{rule.labelName}</Fact>}
          {action ? (
            <Fact term="Then">
              <Does action={action}>{outcomeName(action)}</Does>
              {rule.override && rule.kind === 'label' ? <span className="text-muted-foreground"> instead of the label’s</span> : null}
              {[rule.markRead ? 'marked read' : null, rule.unsubscribe ? 'unsubscribed' : null].filter(Boolean).map((extra) => (
                <span key={extra} className="text-muted-foreground">
                  , {extra}
                </span>
              ))}
            </Fact>
          ) : null}
          {rule.when ? <Fact term="Only when it is">{rule.when}</Fact> : null}
          {rule.except.length > 0 ? (
            <Fact term="Unless">
              {rule.except.map((except, index) => (
                <span key={index} className="block">
                  <Who match={except} />
                </span>
              ))}
            </Fact>
          ) : null}
          {rule.kind === 'when-label' || rule.when ? <Fact term="Reading">Sift reads each message it matches.</Fact> : null}
          <Fact term="Used">{rule.hits === 0 ? 'Never' : `${plural(rule.hits, 'time')}${rule.lastHitAt ? `, last ${ago(rule.lastHitAt)}` : ''}`}</Fact>
          <Fact term="Made by">
            {madeBy(rule.source)}, {shortDate(rule.createdAt)}
          </Fact>
        </Facts>
        <InGmail rule={rule} active={active} />
        {moves ? <InInbox rule={rule} /> : null}
        <div>
          <ConfirmButton
            question="Remove this rule?"
            variant="plain"
            disabled={remove.busy}
            onConfirm={() =>
              remove.run(
                () => api.removeRule(rule.id),
                () => {
                  toast(`Rule removed: ${rule.name ?? describeMatch(rule.match)}`);
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
export function RuleSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const rules = useLoaded('rules', (signal) => api.rules(signal));
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  const rule = rules.data?.rules.find((r) => r.id === id);
  return rule ? <RulePanel key={rule.id} rule={rule} active={manage.data?.active ?? false} onClose={onClose} /> : null;
}
