import { useState } from 'react';
import { type RuleFilter, type RuleSummary, api, useAction } from '@/lib/api.ts';
import { dateTime } from '@/lib/format.ts';
import { Button, Code, Dialog, Fact, Facts, Failure, useToast } from '@/system';

type Plan = NonNullable<RuleFilter['plan']>;

/** In the words of Gmail's own list of filters, so the user can find it there. */
const matches = ({ criteria }: Plan) =>
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
          <Code>{matches(plan)}</Code>
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

/** Whether Gmail runs the rule as a filter, since when, and why not; with the press to add or remove it. */
export function InGmail({ rule, active }: { rule: RuleSummary; active: boolean }) {
  const [adding, setAdding] = useState(false);
  const remove = useAction();
  const toast = useToast();
  const { state, possible, reason, last } = rule.filter;
  const added = last?.type === 'filter' && last.status === 'done' ? last.at : null;
  const said = rule.filterId
    ? state === 'changed'
      ? 'A filter, since edited in Gmail. Sift leaves it as it is.'
      : state === 'outdated'
        ? 'A filter that still does what this rule used to. Sift updates it once it is on.'
        : added
          ? `A filter since ${dateTime(added)}.`
          : 'A filter does this too.'
    : state === 'gone'
      ? 'Its filter was deleted in Gmail.'
      : !possible
        ? `No. ${reason}`
        : state === 'outdated'
          ? 'Sift took its filter out of Gmail when the rule changed.'
          : active
            ? 'Gmail could run this by itself.'
            : 'Gmail could run this by itself once Sift is on.';
  const failed = last && last.status !== 'done' ? last : null;

  return (
    <div className="flex flex-col items-start gap-2">
      <span className={!rule.filterId && !possible ? 'text-muted-foreground' : undefined}>{said}</span>
      {failed ? (
        <Failure>
          {failed.type === 'filter' ? 'Could not add it to Gmail' : 'Could not take it out of Gmail'}
          {failed.error ? `: ${failed.error}` : '.'}
        </Failure>
      ) : null}
      {rule.filterId ? (
        <Button
          busy={remove.busy}
          onClick={() =>
            remove.run(
              () => api.ruleFilter(rule.id, false),
              () => toast('Taken out of Gmail'),
            )
          }
        >
          Take out of Gmail
        </Button>
      ) : possible && active ? (
        <Button onClick={() => setAdding(true)}>Add to Gmail…</Button>
      ) : null}
      <Failure>{remove.error}</Failure>
      {adding ? <FilterDialog rule={rule} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}
