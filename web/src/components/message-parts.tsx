import type { ReactNode } from 'react';
import type { MessageDetail, SenderProfile } from '@/lib/api.ts';
import { dateTime, shortDate, willBe } from '@/lib/format.ts';
import { Code } from '@/system';

/** A heading inside a dialog or a card, over the few lines it names. */
export function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="slug text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

const people = (list: MessageDetail['to']) => list.map((p) => p.address).join(', ');

/** A message as far as sift holds it: who, when, and the text if it has it. `untitled` when the subject is already shown above. */
export function MessageBody({ detail, untitled }: { detail: MessageDetail; untitled?: boolean }) {
  return (
    <article className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-1">
        {untitled ? null : <h3 className="text-base font-semibold break-words">{detail.subject || '(no subject)'}</h3>}
        <p className="text-[13px] text-muted-foreground">
          {detail.fromName ? `${detail.fromName} <${detail.fromAddress}>` : detail.fromAddress}
          {detail.to.length > 0 ? ` to ${people(detail.to)}` : ''}
          {detail.cc.length > 0 ? `, cc ${people(detail.cc)}` : ''}
        </p>
        <p className="text-[13px] text-muted-foreground tabular-nums">{dateTime(detail.receivedAt)}</p>
      </header>
      {detail.body === null ? (
        <p className="text-[13px] text-muted-foreground">
          sift is not holding this message’s text. It keeps the text only while mail it would move, or could not place, is waiting on you.
        </p>
      ) : detail.body === '' ? (
        <p className="text-[13px] text-muted-foreground">This message has no readable text, or is no longer in Gmail.</p>
      ) : (
        <div className="max-w-[68ch] text-sm leading-relaxed break-words whitespace-pre-wrap">{detail.body}</div>
      )}
    </article>
  );
}

const CONDITIONS: Record<string, string> = { from: 'from', fromDomain: 'from domain', to: 'to', listId: 'list', subjectContains: 'subject contains' };

/** Where the sender stands on unsubscribing, as far as sift can tell. It says nothing when there is nothing to say. */
export function Unsubscribe({ detail }: { detail: MessageDetail }) {
  if (detail.unsubscribe === 'done') return <p className="text-[13px] text-muted-foreground">sift has unsubscribed you from this sender.</p>;
  if (detail.unsubscribe === 'available') return <p className="text-[13px] text-muted-foreground">This sender offers a one-click unsubscribe.</p>;
  if (detail.unsubscribe === 'manual')
    return <p className="text-[13px] text-muted-foreground">This sender has an unsubscribe link, but not one sift can use.</p>;
  return null;
}

/** What sift knows about a sender, as a few plain lines. */
export function SenderFacts({ sender }: { sender: SenderProfile }) {
  return (
    <ul className="flex flex-col gap-1.5 text-[13px]">
      <li>
        {sender.messages === 0
          ? 'No mail recorded from them.'
          : `${sender.messages} ${sender.messages === 1 ? 'message' : 'messages'}${sender.firstSeenAt ? `, the first on ${shortDate(sender.firstSeenAt)}` : ''}.`}
      </li>
      <li className={sender.userHasWritten ? 'font-medium' : 'text-muted-foreground'}>
        {sender.userHasWritten === null
          ? 'Not checked whether you have written to them.'
          : sender.userHasWritten
            ? 'You have written to them.'
            : 'You have never written to them.'}
      </li>
      {sender.labels.length > 0 ? <li className="text-muted-foreground">So far: {sender.labels.map((l) => `${l.name} ${l.messages}`).join(' · ')}</li> : null}
      {sender.rules.map((rule) => (
        <li key={rule.id} className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-muted-foreground">Rule:</span>
          {Object.entries(rule.match).map(([key, value]) => (
            <span key={key} className="inline-flex items-baseline gap-1">
              <span className="text-muted-foreground">{CONDITIONS[key] ?? key}</span>
              <Code>{value}</Code>
            </span>
          ))}
          <span>
            is {rule.labelName ?? 'a removed label'}
            {rule.disposition ? `: ${willBe(rule.disposition)}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
