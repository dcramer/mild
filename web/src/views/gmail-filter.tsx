'use client';
import { useState } from 'react';
import { type RuleFilter, type RuleSummary, api } from '@/lib/api/endpoints.ts';
import { useAction } from '@/lib/action.ts';
import { dateTime } from '@/lib/format.ts';
import { Button, Code, DeleteButton, Dialog, Fact, Facts, Failure, Section, Timeline, TimelineEvent, useToast } from '@/system';
import { reveal } from '@/lib/reveal.ts';

type Plan = NonNullable<RuleFilter['plan']>;

/** In the words of Gmail's own list of filters, so the user can find it there. */
const gmailMatches = (held: Plan['criteria']) => {
  const criteria = reveal(held);
  return [criteria.from && `from:(${criteria.from})`, criteria.to && `to:(${criteria.to})`, criteria.subject && `subject:(${criteria.subject})`]
    .filter(Boolean)
    .join(' ');
};
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
    subtitle: 'Gmail then runs it on new mail itself, even while Mild is not running.',
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
/**
 * Whether Gmail runs the rule as a filter, or could. A filter the user edited or deleted in Gmail is their
 * choice, one out of date is brought into line once Mild is on, and a change Gmail did not take is tried
 * again: none of them is the reader's to look at.
 */
export function filterStanding(rule: RuleSummary): 'filter' | 'could' | 'cannot' {
  return rule.filterId ? 'filter' : rule.filter.possible ? 'could' : 'cannot';
}

/**
 * Whether Gmail runs the rule itself, as one of its own filters, or could, and if not why; what Mild did about
 * it, and the press to add or remove it. Said so that someone who has never made a Gmail filter knows what one is.
 */
export function GmailFilter({ rule, active }: { rule: RuleSummary; active: boolean }) {
  const [adding, setAdding] = useState(false);
  const remove = useAction();
  const toast = useToast();
  const { state, possible, reason, history, checkedAt } = rule.filter;
  const said = rule.filterId
    ? state === 'changed'
      ? 'Its Gmail filter was edited in Gmail, so Mild leaves it as it is.'
      : state === 'outdated'
        ? 'Its Gmail filter still does what this rule used to. Mild updates it once it is on.'
        : 'Gmail runs this rule itself, as one of your Gmail filters, so it applies the moment mail arrives, even when Mild isn’t running.'
    : state === 'gone'
      ? 'Its Gmail filter was deleted in Gmail. Mild will not put it back.'
      : !possible
        ? `Gmail can’t run this rule as one of its filters. ${reason ?? ''}`
        : active
          ? 'Gmail could run this rule itself, as one of your Gmail filters, so it applies the moment mail arrives, even when Mild isn’t running.'
          : 'Once Mild is on, Gmail could run this rule itself, as one of your Gmail filters, so it applies even when Mild isn’t running.';
  // A press writes to every mailbox, so with several each row has to say whose Gmail it was.
  const several = new Set(history.map((change) => change.mailbox)).size > 1;
  const events = [
    ...history.map((change) => ({
      key: `${change.at}/${change.mailbox}/${change.type}`,
      at: change.at,
      mailbox: several ? change.mailbox : null,
      title:
        change.status === 'done' ? (
          <span className="font-medium">{change.type === 'filter' ? 'Filter added' : 'Filter removed'}</span>
        ) : (
          <span className="text-muted-foreground">{change.type === 'filter' ? 'Gmail did not take the filter' : 'Gmail did not remove the filter'}</span>
        ),
    })),
    // Noticed by a check, not done by Mild, so the audit log has no row for it.
    ...(state === 'gone' && checkedAt !== null
      ? [{ key: 'gone', at: checkedAt, mailbox: null, title: <span className="font-medium">Filter deleted in Gmail</span> }]
      : []),
  ].toSorted((a, b) => a.at - b.at);

  return (
    <Section
      title="Gmail filter"
      action={
        rule.filterId ? (
          <DeleteButton
            question="Remove the Gmail filter?"
            says={`The rule stays, and applies only while Mild is on.${state === 'changed' ? ' What you changed in the filter in Gmail goes with it.' : ''}`}
            onDelete={async () => {
              await remove.settle(() => api.ruleFilter(rule.id, false));
              toast('Gmail filter removed');
            }}
          >
            Remove filter
          </DeleteButton>
        ) : active && possible ? (
          <Button variant="plain" onClick={() => setAdding(true)}>
            Add as a Gmail filter…
          </Button>
        ) : undefined
      }
    >
      <p className={rule.filterId || (active && possible) ? undefined : 'text-muted-foreground'}>{said}</p>
      {events.length > 0 ? (
        <Timeline>
          {events.map((event) => (
            <TimelineEvent key={event.key} at={dateTime(event.at)} title={event.title}>
              {event.mailbox}
            </TimelineEvent>
          ))}
        </Timeline>
      ) : null}
      {adding ? <FilterDialog rule={rule} onClose={() => setAdding(false)} /> : null}
    </Section>
  );
}
