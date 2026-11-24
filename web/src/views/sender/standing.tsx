'use client';
import { useAction } from '@/components/action.ts';
import type { AnswerLabel } from '@/components/answer.tsx';
import { RuleWords } from '@/components/sender.tsx';
import { type Given, type SenderPage, api } from '@/lib/api/endpoints.ts';
import { rulePath, useOpenRule } from '@/lib/params.ts';
import { type RuleStart, addedWords, messageStart, standingStart } from '@/lib/rule-start.ts';
import { STANDINGS } from '@/lib/words.ts';
import { Button, ChoiceGroup, Failure, TextLink, useToast } from '@/system';
import { type Who, keyOf } from './who.ts';

const GIVE = STANDINGS.map(([key, press]) => [key, press] as const);

type Profile = SenderPage['profile'];

/** The rules that name them, each a link to itself. */
function Rules({ rules }: { rules: Profile['rules'] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="slug text-muted-foreground">{rules.length === 1 ? 'Rule' : 'Rules'}</p>
      <ul className="flex flex-col gap-1">
        {rules.map((r) => (
          <li key={r.id}>
            <TextLink href={rulePath(r.id)}>
              <RuleWords rule={r} />
            </TextLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What Mild will do with their next mail and why: the rules that name them, where they stand, and a rule to start on them. */
export function Standing({
  who,
  title,
  profile,
  labels,
  reload,
  onStart,
}: {
  who: Who;
  title: string | null;
  profile: Profile;
  labels: readonly AnswerLabel[];
  reload: () => void;
  onStart: (s: RuleStart) => void;
}) {
  const key = keyOf(who);
  const give = useAction();
  const openRule = useOpenRule();
  // Undo is pressed after the standing is given, so what it reports goes to a toast.
  const later = useAction();
  const toast = useToast();
  // A standing is a rule for exactly them that says only what happens to their mail, so it is given in one press, with Undo.
  const giveStanding = (standing: Given) =>
    give.run(async () => {
      const given = await api.giveStanding(who, standing);
      // Their own rule says more than a standing would: the dialog shows what replacing it loses.
      if ('theirs' in given) return onStart(standingStart(who, standing));
      const takeBack = () =>
        later.run(
          () =>
            (given.was ? api.giveStanding(who, given.was) : api.clearStanding(who)).catch((failure: unknown) => {
              toast('Could not take the rule back', { tone: 'failure', description: failure instanceof Error ? failure.message : String(failure) });
              throw failure;
            }),
          reload,
        );
      toast(addedWords(standingStart(who, standing), labels), {
        kind: given.was ? 'Rule replaced' : 'Rule added',
        undo: takeBack,
        // Mail already in the inbox stays until the rule is applied there, as the dialog offers.
        ...(standing === 'trusted' ? {} : { action: { label: 'Apply to inbox…', onPress: () => openRule(given.id, true) } }),
      });
    }, reload);
  const [top] = profile.labels;
  return (
    <div className="flex flex-col gap-5">
      {profile.rules.length > 0 ? <Rules rules={profile.rules} /> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ChoiceGroup
          label={`Where ${title ?? key} stands`}
          value={profile.given}
          options={GIVE}
          clearable
          disabled={give.busy}
          onChange={(standing) => (standing ? giveStanding(standing) : give.run(() => api.clearStanding(who), reload))}
        />
        <Button variant="quiet" onClick={() => onStart(messageStart(key, top?.id ?? null))}>
          Make a rule…
        </Button>
      </div>
      <Failure>{give.error}</Failure>
    </div>
  );
}
