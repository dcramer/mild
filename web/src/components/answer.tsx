import { ArrowRightIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FeedbackRequest } from '@/lib/api.ts';
import { willBe } from '@/lib/format.ts';
import { Button, Check, Input, Select } from '@/system';

export interface AnswerLabel {
  id: string;
  name: string;
  disposition: string;
  /** The label already unsubscribes, so the answer need not ask for it. */
  unsubscribe?: boolean;
}

type Scope = FeedbackRequest['scope'];
type Exception = '' | 'keep' | 'archive' | 'spam';
export type AnswerValue = Pick<FeedbackRequest, 'label' | 'scope' | 'contains' | 'disposition' | 'unsubscribe'>;

const EXCEPTIONS = [
  ['', 'as the label says'],
  ['keep', 'but keep it'],
  ['archive', 'but archive it'],
  ['spam', 'but mark it spam'],
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
  const label = labels.find((l) => l.id === chosen);
  const domain = sender.split('@')[1] ?? '';
  const ready = label !== undefined && (scope !== 'subject' || contains.trim() !== '');
  const answer: AnswerValue | null = label
    ? {
        label: label.id,
        scope,
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
        : scope === 'once'
          ? 'this message'
          : `mail from ${sender}`;
  const does = label ? willBe(exception || label.disposition) : '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="slug text-muted-foreground">It is</p>
        <div className="flex flex-wrap gap-1.5">
          {labels.map((l, index) => (
            <Button key={l.id} variant={chosen === l.id ? 'ink' : 'plain'} aria-pressed={chosen === l.id} onClick={() => setChosen(l.id)}>
              {index < 9 ? <span className="hidden font-mono text-[13px] font-normal opacity-60 md:inline">{index + 1}</span> : null}
              {l.name}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="slug text-muted-foreground">For</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Select
            label="How far this answer reaches"
            value={scope}
            options={[
              ['sender', 'Everything from this sender'],
              ['domain', `Anyone at ${domain}`],
              ['subject', 'This sender, when the subject contains…'],
              ['once', 'Only this message'],
            ]}
            onChange={setScope}
          />
          {scope === 'subject' ? (
            <Input
              autoFocus
              aria-label="Words the subject must contain"
              placeholder="words in the subject"
              className="w-48"
              value={contains}
              onChange={(event) => setContains(event.target.value)}
            />
          ) : null}
          <Select label="Exception to the label's action" value={exception} options={EXCEPTIONS} onChange={setException} />
        </div>
        {/* A rule can carry this itself; for a label that already unsubscribes there is nothing to add. */}
        {label && !label.unsubscribe && scope !== 'once' ? (
          <Check checked={unsubscribe} onChange={setUnsubscribe}>
            and unsubscribe, when the sender offers a safe way
          </Check>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <p className={label ? undefined : 'text-muted-foreground'}>
          {!label
            ? 'Choose what this is.'
            : scope === 'once'
              ? `Only ${whose}: ${label.name}, ${does}. No rule is made.`
              : `From now on, ${whose} is ${label.name}: ${does}${label.unsubscribe || unsubscribe ? ', and unsubscribed from' : ''}.`}
        </p>
        {acted && label && label.id !== guess ? <p className="text-sm text-muted-foreground">This message is put right in Gmail too.</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="mark" busy={busy} disabled={!ready} onClick={() => answer && onSubmit(answer)}>
            {label && label.id === guess && scope === 'sender' && !exception ? 'Right' : 'Teach sift'}
            <ArrowRightIcon aria-hidden />
          </Button>
          <p className="slug hidden text-muted-foreground md:block">Enter · 1–{Math.min(labels.length, 9)} label</p>
        </div>
      </div>
    </div>
  );
}
