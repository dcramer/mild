import { ArrowRightIcon } from 'lucide-react';
import { useState } from 'react';
import type { FeedbackRequest } from '@/lib/api.ts';
import { willBe } from '@/lib/format.ts';
import { Button, Check, ChoiceGroup, Failure, Field, Form, Input, Select } from '@/system';

export interface AnswerLabel {
  id: string;
  name: string;
  disposition: string;
  /** The label already unsubscribes, so the answer need not ask for it. */
  unsubscribe?: boolean;
}

type Does = 'keep' | 'archive' | 'spam';
/** `when` is a rule for the sender narrowed by a condition in words, which only the model can apply. */
type Scope = FeedbackRequest['scope'] | 'when';
export type AnswerValue = Pick<FeedbackRequest, 'label' | 'scope' | 'contains' | 'disposition' | 'unsubscribe' | 'when'>;

const DOES = [
  ['keep', 'Keep'],
  ['archive', 'Archive'],
  ['spam', 'Spam'],
] as const;
// Gmail's own keys where it has one: E archives, ! is spam. I for the inbox.
const DOES_KEYS = ['i', 'e', '!'] as const;
const does = (action: string | undefined): Does | null =>
  action === 'keep' || action === 'archive' || action === 'spam' ? action : action === 'block' ? 'spam' : null;

/**
 * The user's answer about one message, in the order they think of it: what should happen, how far that
 * reaches, and only then what the mail is, which is sift's guess to correct if it is wrong. How far it
 * reaches decides what is learned: the sender's mail of this kind (a rule that waits for the label),
 * all their mail (a rule that names no label), or this message alone (no rule; correcting what a message
 * is teaches the model by example). The sentence above the button is what sift will be taught, word for
 * word.
 */
export function Answer({
  labels,
  guess,
  proposed,
  sender,
  acted,
  busy,
  error,
  onSubmit,
}: {
  labels: readonly AnswerLabel[];
  /** The label sift gave, if it gave one. */
  guess: string | null;
  /** What sift did or would do with the message. */
  proposed: string;
  sender: string;
  /** sift has already carried out a decision on this message, so a different answer also puts the message right. */
  acted: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (answer: AnswerValue) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(guess);
  // Until the user says otherwise, what happens follows the label, and how far the answer reaches follows what was changed.
  const [picked, setPicked] = useState<Does | null>(null);
  const [reach, setReach] = useState<Scope | null>(null);
  const [contains, setContains] = useState('');
  const [condition, setCondition] = useState('');
  const [unsubscribe, setUnsubscribe] = useState(false);

  const label = labels.find((l) => l.id === chosen);
  const domain = sender.split('@')[1] ?? '';
  const relabelled = label !== undefined && label.id !== guess;
  const labelDoes = does(label?.disposition);
  const action = picked ?? (relabelled || guess === null ? labelDoes : does(proposed)) ?? labelDoes;
  // Agreeing is about this kind of mail from them. Saying only what a message is teaches by example, with no rule.
  const scope: Scope = reach ?? (relabelled && picked === null ? 'once' : label ? 'label' : 'sender');
  const wide = scope === 'sender' || scope === 'domain' || scope === 'subject';
  const ready =
    action !== null &&
    (label !== undefined || wide || scope === 'once') &&
    (scope !== 'subject' || contains.trim() !== '') &&
    (scope !== 'when' || condition.trim() !== '');
  const answer: AnswerValue | null =
    action === null
      ? null
      : {
          ...(label ? { label: label.id } : {}),
          scope: scope === 'when' ? 'sender' : scope,
          ...(scope === 'when' ? { when: condition.trim() } : {}),
          ...(scope === 'subject' ? { contains: contains.trim() } : {}),
          // What happens is sent whenever it is not simply what the label does.
          ...(!label || wide || action !== labelDoes ? { disposition: action } : {}),
          ...(unsubscribe && scope !== 'once' ? { unsubscribe } : {}),
        };

  const whose =
    scope === 'domain'
      ? `mail from anyone at ${domain}`
      : scope === 'subject'
        ? `mail from ${sender} with “${contains.trim() || '…'}” in the subject`
        : `mail from ${sender}`;
  const will = action ? willBe(action) : '';
  const also = (fromLabel: boolean) => ((fromLabel && label?.unsubscribe) || unsubscribe ? ', and unsubscribed from' : '');
  const sentence =
    action === null
      ? 'Choose what should happen to it.'
      : scope === 'once'
        ? `Only this message${label ? `: ${label.name}, ${will}` : ` is ${will}`}. No rule is made${relabelled ? '; sift is shown it as an example next time' : ''}.`
        : scope === 'label'
          ? label
            ? `From now on, mail from ${sender} that is ${label.name} is ${will}${also(true)}. sift still reads each message, and asks about anything else from them.`
            : 'Choose what kind of mail this is.'
          : scope === 'when'
            ? label
              ? `From now on, mail from ${sender}, when it is ${condition.trim() || '…'}, is ${label.name}: ${will}${also(true)}. sift reads each one to tell.`
              : 'Choose what kind of mail this is.'
            : `From now on, ${whose} is ${will}${also(false)}, whatever it is. sift will not ask about it again.`;
  const agreeing = !relabelled && picked === null && reach === null && guess !== null && !unsubscribe;

  return (
    <Form onSubmit={() => ready && answer && onSubmit(answer)}>
      <Field label="Do">
        <ChoiceGroup label="What should happen to it" value={action} options={DOES} onChange={setPicked} keys={DOES_KEYS} />
      </Field>

      <Field label="For">
        <Select
          label="How far this answer reaches"
          value={scope}
          options={[
            ...(label ? [['label', `Their ${label.name}`] as const] : []),
            ['sender', 'Everything from them'],
            ['domain', `Everyone at ${domain}`],
            ['subject', 'Subject contains…'],
            ...(label ? [['when', 'When it is… (your words)'] as const] : []),
            ['once', 'Only this message'],
          ]}
          onChange={setReach}
        />
        {scope === 'subject' ? (
          <Input
            autoFocus
            aria-label="Words the subject must contain"
            placeholder="words in the subject"
            className="w-full"
            value={contains}
            onChange={(event) => setContains(event.target.value)}
          />
        ) : null}
        {scope === 'when' ? (
          <Input
            autoFocus
            aria-label="What the mail must be, in your words"
            placeholder="a notice for a lot I did not bid on"
            className="w-full"
            value={condition}
            onChange={(event) => setCondition(event.target.value)}
          />
        ) : null}
        {/* A rule can carry this itself; for a label that already unsubscribes there is nothing to add. */}
        {scope !== 'once' && !((scope === 'label' || scope === 'when') && label?.unsubscribe) ? (
          <Check checked={unsubscribe} onChange={setUnsubscribe}>
            and unsubscribe
          </Check>
        ) : null}
      </Field>

      <Field label="It is" hint={guess === null ? 'sift could not say. You need not either.' : relabelled ? null : 'sift’s guess. Change it if it is wrong.'}>
        <ChoiceGroup label="What this message is" value={chosen} options={labels.map((l) => [l.id, l.name] as const)} onChange={setChosen} numbered clearable />
      </Field>

      <div className="flex flex-col gap-3">
        <p className={ready ? undefined : 'text-muted-foreground'}>{sentence}</p>
        {acted && (relabelled || (action !== null && action !== does(proposed))) ? (
          <p className="text-muted-foreground">This message is put right in Gmail too.</p>
        ) : null}
        <Failure>{error}</Failure>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="mark" busy={busy} disabled={!ready} shortcut={{ key: 'Enter', label: 'Save this answer' }}>
            {agreeing ? 'Agree' : 'Save answer'}
            <ArrowRightIcon aria-hidden />
          </Button>
        </div>
      </div>
    </Form>
  );
}
