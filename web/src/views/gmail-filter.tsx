import { useState } from 'react';
import { type RuleFilter, type RuleSummary, api, useAction } from '@/lib/api.ts';
import { dateTime } from '@/lib/format.ts';
import { Button, Code, Dialog, Fact, Facts, Failure, Section, Timeline, TimelineEvent, useToast } from '@/system';

type Plan = NonNullable<RuleFilter['plan']>;

/** In the words of Gmail's own list of filters, so the user can find it there. */
const gmailMatches = (criteria: Plan['criteria']) =>
  [criteria.from && `from:(${criteria.from})`, criteria.to && `to:(${criteria.to})`, criteria.subject && `subject:(${criteria.subject})`]
    .filter(Boolean)
    .join(' ');
const doThis = (plan: Plan) => [plan.archive ? 'Skip Inbox' : null, plan.gmailLabel ? `Apply label “${plan.gmailLabel}”` : null].filter(Boolean).join(', ');

/**
 * Asking to write a rule to Gmail as a filter, showing the filter first: the props of a `Dialog`, so the
 * rule dialog can turn into it once the rule is added. `decline` names the press that does not.
 */
export function useFilterOffer(onDone: () => void) {
  const { busy, error, run } = useAction();
  const toast = useToast();
  return (ruleId: string, { plan, differs }: RuleFilter, decline: string) => ({
    title: 'Add it to Gmail as a filter?',
    subtitle: 'Gmail then runs it on new mail itself, even while Sift is not running.',
    children: plan ? (
      <Facts>
        <Fact term="Matches">
          <Code>{gmailMatches(plan.criteria)}</Code>
        </Fact>
        <Fact term="Do this">{doThis(plan)}</Fact>
        {differs.length > 0 ? (
          <Fact term="Unlike the rule">
            {differs.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </Fact>
        ) : null}
      </Facts>
    ) : null,
    footer: (
      <>
        <Button
          variant="ink"
          busy={busy}
          onClick={() =>
            run(
              () => api.ruleFilter(ruleId, true),
              () => {
                toast('Added to Gmail as a filter');
                onDone();
              },
            )
          }
        >
          Add to Gmail
        </Button>
        <Button variant="quiet" onClick={onDone}>
          {decline}
        </Button>
        <Failure>{error}</Failure>
      </>
    ),
  });
}

function FilterDialog({ rule, onClose }: { rule: RuleSummary; onClose: () => void }) {
  const offer = useFilterOffer(onClose);
  return <Dialog open onClose={onClose} {...offer(rule.id, rule.filter, 'Cancel')} />;
}

/** Where a rule stands as a Gmail filter, for the Rules list: `failed` and `look` need the user. */
export function filterStanding(rule: RuleSummary): 'failed' | 'look' | 'filter' | 'could' | 'cannot' {
  const { state, possible, history } = rule.filter;
  if ((history.at(-1)?.status ?? 'done') !== 'done') return 'failed';
  if (rule.filterId ? state === 'changed' || state === 'outdated' : state === 'gone') return 'look';
  return rule.filterId ? 'filter' : possible ? 'could' : 'cannot';
}

/** The rule's standing in a word or two, for a list. Empty for a rule that is no filter. */
export function standingWords(rule: RuleSummary): string {
  const { state } = rule.filter;
  switch (filterStanding(rule)) {
    case 'failed':
      return rule.filter.history.at(-1)?.type === 'unfilter' ? 'Not removed from Gmail' : 'Not added to Gmail';
    case 'look':
      return state === 'changed' ? 'Edited in Gmail' : state === 'gone' ? 'Deleted in Gmail' : 'Filter out of date';
    case 'filter':
      return 'In Gmail';
    default:
      return '';
  }
}

/** Whether Gmail runs the rule as a filter, and why not; what Sift did about it, and the press to add or remove it. */
export function InGmail({ rule, active }: { rule: RuleSummary; active: boolean }) {
  const [adding, setAdding] = useState(false);
  const remove = useAction();
  const toast = useToast();
  const { state, possible, reason, history, checkedAt } = rule.filter;
  const said = rule.filterId
    ? state === 'changed'
      ? 'Its filter was edited in Gmail. Sift leaves it as it is.'
      : state === 'outdated'
        ? 'Its filter still does what this rule used to. Sift updates it once it is on.'
        : 'Gmail runs this rule as a filter.'
    : state === 'gone'
      ? 'Its filter was deleted in Gmail. Sift will not put it back.'
      : !possible
        ? reason
        : active
          ? 'Gmail could run this by itself.'
          : 'Gmail could run this by itself once Sift is on.';
  const events = [
    ...history.map((change) => ({
      at: change.at,
      title:
        change.status === 'done' ? (
          <span className="font-medium">{change.type === 'filter' ? 'Added to Gmail' : 'Removed from Gmail'}</span>
        ) : (
          <Failure inline>{change.type === 'filter' ? 'Not added to Gmail' : 'Not removed from Gmail'}</Failure>
        ),
      detail: change.status === 'done' ? null : change.error,
    })),
    // Noticed by a check, not done by Sift, so the audit log has no row for it.
    ...(state === 'gone' && checkedAt !== null ? [{ at: checkedAt, title: <span className="font-medium">Deleted in Gmail</span>, detail: null }] : []),
  ].toSorted((a, b) => a.at - b.at);

  return (
    <Section
      title="In Gmail"
      action={
        rule.filterId ? (
          <Button
            variant="plain"
            busy={remove.busy}
            onClick={() =>
              remove.run(
                () => api.ruleFilter(rule.id, false),
                () => toast('Removed from Gmail'),
              )
            }
          >
            Remove from Gmail
          </Button>
        ) : possible && active ? (
          <Button variant="plain" onClick={() => setAdding(true)}>
            Add to Gmail…
          </Button>
        ) : undefined
      }
    >
      <p className={!rule.filterId && !possible ? 'text-muted-foreground' : undefined}>{said}</p>
      {events.length > 0 ? (
        <Timeline>
          {events.map((event) => (
            <TimelineEvent key={`${event.at}-${String(event.detail)}`} at={dateTime(event.at)} title={event.title}>
              {event.detail}
            </TimelineEvent>
          ))}
        </Timeline>
      ) : null}
      <Failure>{remove.error}</Failure>
      {adding ? <FilterDialog rule={rule} onClose={() => setAdding(false)} /> : null}
    </Section>
  );
}
