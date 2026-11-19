'use client';
import { useState } from 'react';
import { usePlan } from '@/components/model-connect.tsx';
import { type MailConversation, type MailSummary, type MessageDetail, api } from '@/lib/api.ts';
import { useAction } from '@/lib/action.ts';
import { count, dateTime, money } from '@/lib/format.ts';
import { AT_API_PRICES } from '@/lib/prices.ts';
import { reveal } from '@/lib/reveal.ts';
import { Button, Failure, TimelineEvent } from '@/system';

/** A single message this long is worth summarizing; a shorter one reads faster than its summary. */
const LONG = 1500;

/**
 * What the model said a conversation says, above the answer: the one recorded for it as it is now, or a quiet press
 * that asks, for a conversation of several messages or one long one. One call a press; nothing asks by itself.
 */
export function Summary({ conversation, newest }: { conversation: MailConversation; newest: MessageDetail }) {
  const summarizing = useAction();
  const [made, setMade] = useState<MailSummary | null>(null);
  const current = [...conversation.summaries, ...(made ? [made] : [])].findLast((s) => s.newestId === newest.messageId && s.summary !== null);
  if (current) return <p className="text-foreground">{reveal(current.summary)}</p>;
  if (conversation.messages.length < 2 && (reveal(newest.body)?.length ?? 0) < LONG) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="-ml-3">
        <Button
          variant="quiet"
          busy={summarizing.busy}
          onClick={() => summarizing.run(async () => setMade(await api.summarize(conversation.accountId, conversation.threadId)))}
        >
          Summarize
        </Button>
      </div>
      <Failure>{summarizing.error}</Failure>
    </div>
  );
}

/** A Summarize in the message's history, with what it cost. */
export function SummaryEvent({ summary }: { summary: MailSummary }) {
  // Through a plan, the call was paid for by it: its cost is only what the API would have charged.
  const plan = usePlan(summary.model);
  return (
    <TimelineEvent
      at={dateTime(summary.at)}
      title={<span className={summary.failed ? 'text-muted-foreground' : 'font-medium'}>{summary.failed ? 'Not summarized' : 'Summarized'}</span>}
    >
      <p>
        {summary.model}, {count(summary.inputTokens + summary.outputTokens)} tokens, {money(summary.costUsd)}
        {plan ? ` ${AT_API_PRICES}` : ''}
      </p>
    </TimelineEvent>
  );
}
