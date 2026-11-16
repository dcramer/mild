import { ArrowRightIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FeedbackRequest } from '@/lib/api.ts';
import { willBe } from '@/lib/format.ts';
import { Button, Check, ChoiceGroup, Failure, Field, Form, Input, Kbd, Select } from '@/system';

export interface AnswerLabel {
  id: string;
  name: string;
  disposition: string;
  /** The label already unsubscribes, so the answer need not ask for it. */
  unsubscribe?: boolean;
}

/** `when` is a sender rule narrowed by a condition in words, which only the model can apply. */
type Scope = FeedbackRequest['scope'] | 'when';
type Tier = NonNullable<FeedbackRequest['tier']>;
type Exception = '' | 'keep' | 'archive' | 'spam';
export type AnswerValue = Pick<FeedbackRequest, 'label' | 'scope' | 'contains' | 'disposition' | 'unsubscribe' | 'tier' | 'when'>;

const EXCEPTIONS = [
  ['', 'As the label says'],
  ['keep', 'Keep it instead'],
  ['archive', 'Archive it instead'],
  ['spam', 'Spam it instead'],
] as const;

/**
 * The user's answer about one message: what it is, how far that reaches beyond it, and any exception.
 * The sentence above the button is what sift will be taught, word for word. Labels can be chosen with
 * the number keys and the answer sent with Enter.
 */
export function Answer({
  labels,
  guess,
  sender,
  acted,
  busy,
  error,
  onSubmit,
}: {
  labels: readonly AnswerLabel[];
  /** The label sift gave, if it gave one. */
  guess: string | null;
  sender: string;
  /** sift has already carried out a decision on this message, so a different answer also puts the message right. */
  acted: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (answer: AnswerValue) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(guess);
  const [scope, setScope] = useState<Scope>('sender');
  const [contains, setContains] = useState('');
  const [exception, setException] = useState<Exception>('');
  const [unsubscribe, setUnsubscribe] = useState(false);
  const [tierChoice, setTier] = useState<Tier | null>(null);
  const [condition, setCondition] = useState('');
  const label = labels.find((l) => l.id === chosen);
  const domain = sender.split('@')[1] ?? '';
  const outcome = exception || (label?.disposition ?? '');
  // The same default the server applies: a rule that would hide everything from a sender is checked, not blind.
  const wide = scope === 'sender' || scope === 'domain';
  const tier: Tier = scope === 'when' ? 'usually' : (tierChoice ?? (wide && (outcome === 'archive' || outcome === 'spam') ? 'usually' : 'always'));
  const ready = label !== undefined && (scope !== 'subject' || contains.trim() !== '') && (scope !== 'when' || condition.trim() !== '');
  const answer: AnswerValue | null = label
    ? {
        label: label.id,
        scope: scope === 'when' ? 'sender' : scope,
        ...(scope === 'when' ? { when: condition.trim() } : {}),
        ...(scope !== 'once' && scope !== 'when' ? { tier } : {}),
        ...(scope === 'subject' ? { contains: contains.trim() } : {}),
        ...(exception ? { disposition: exception } : {}),
        ...(unsubscribe && scope !== 'once' ? { unsubscribe } : {}),
      }
    : null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.getAttribute('role') === 'option');
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      const picked = labels[Number(event.key) - 1];
      if (picked) setChosen(picked.id);
      else if (event.key === 'Enter' && ready && answer && !busy && !(target instanceof HTMLButtonElement)) onSubmit(answer);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const whose =
    scope === 'domain'
      ? `mail from anyone at ${domain}`
      : scope === 'subject'
        ? `mail from ${sender} with “${contains.trim() || '…'}” in the subject`
        : scope === 'when'
          ? `mail from ${sender}, when it is ${condition.trim() || '…'},`
          : scope === 'once'
            ? 'this message'
            : `mail from ${sender}`;
  const does = label ? willBe(exception || label.disposition) : '';

  const right = label !== undefined && label.id === guess && scope === 'sender' && !exception && tierChoice === null;
  const sentence = !label
    ? 'Choose what this is.'
    : scope === 'once'
      ? `Only ${whose}: ${label.name}, ${does}. No rule is made.`
      : `From now on, ${whose} is ${tier === 'usually' && scope !== 'when' ? 'usually ' : ''}${label.name}: ${does}${label.unsubscribe || unsubscribe ? ', and unsubscribed from' : ''}.${
          tier === 'usually' ? ' sift still reads each one and asks about any that is something else.' : ''
        }`;

  return (
    <Form onSubmit={() => ready && answer && onSubmit(answer)}>
      <Field label="It is">
        <ChoiceGroup label="What this message is" value={chosen} options={labels.map((l) => [l.id, l.name] as const)} onChange={setChosen} numbered />
      </Field>

      <div className="flex flex-col gap-2.5">
        <Field inline label="Covers">
          <Select
            label="How far this answer reaches"
            value={scope}
            options={[
              ['sender', 'Everything from this sender'],
              ['domain', `Anyone at ${domain}`],
              ['subject', 'This sender, subject contains…'],
              ['when', 'This sender, when it is…'],
              ['once', 'Only this message'],
            ]}
            onChange={setScope}
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
        </Field>
        {/* The default depends on what the label does, so there is nothing to show before one is chosen. */}
        {!label || scope === 'once' || scope === 'when' ? null : (
          <Field inline label="Reading">
            <Select
              label="Whether sift checks each message"
              value={tier}
              options={[
                ['usually', 'sift reads each one to check'],
                ['always', 'sift does not read them'],
              ]}
              onChange={setTier}
            />
          </Field>
        )}
        <Field inline label="Then">
          <Select label="Exception to the label's action" value={exception} options={EXCEPTIONS} onChange={setException} />
          {/* A rule can carry this itself; for a label that already unsubscribes there is nothing to add. */}
          {label && !label.unsubscribe && scope !== 'once' ? (
            <Check checked={unsubscribe} onChange={setUnsubscribe}>
              and unsubscribe
            </Check>
          ) : null}
        </Field>
      </div>

      <div className="flex flex-col gap-3">
        <p className={label ? undefined : 'text-muted-foreground'}>{sentence}</p>
        {acted && label && label.id !== guess ? <p className="text-muted-foreground">This message is put right in Gmail too.</p> : null}
        <Failure>{error}</Failure>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="mark" busy={busy} disabled={!ready}>
            {right ? 'Right' : 'Teach sift'}
            <ArrowRightIcon aria-hidden />
          </Button>
          <span className="hidden text-muted-foreground md:inline">
            <Kbd>Enter</Kbd> to send · <Kbd>1</Kbd>–<Kbd>{Math.min(labels.length, 9)}</Kbd> to choose
          </span>
        </div>
      </div>
    </Form>
  );
}
