'use client';
import { ArchiveIcon, BanIcon, CircleHelpIcon, ShieldAlertIcon, TagIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import type { AnswerLabel } from '@/components/answer.tsx';
import { useLabelEnding } from '@/components/label-ending.tsx';
import { WhoWrote } from '@/components/mail.tsx';
import { messageStart } from '@/lib/rule-start.ts';
import { messageKey } from '@/lib/rows.ts';
import { reveal } from '@/lib/reveal.ts';
import { readMessageAhead } from '@/lib/api/reads.ts';
import { Arrived, Button, Hint, RowCheck, RowPresses, Swipe, type SwipePress, Td, Tooltip, Tr } from '@/system';
import type { Hands } from './hands.ts';
import { Label, LabelSheetFor } from './label.tsx';
import { type Listed, newest } from './listed.ts';

/** Its newest message read ahead of a press that opens it, which then waits on nothing. */
const ahead = (t: Listed) => readMessageAhead(t.accountId, newest(t).messageId, true);

/** Where a conversation a search found is, when that is not the inbox, in front of its subject as Gmail puts a label. */
function Place({ thread }: { thread: Listed }) {
  if (thread.place === 'inbox') return null;
  return <span className="mr-2 font-normal text-muted-foreground">{thread.place === 'sent' ? 'Sent' : 'Archived'}</span>;
}

/** Mild looked at the newest message and could not say which label it is. */
const unplaced = (t: Listed) => t.thinks?.disposition === 'review' && t.thinks.labelId === null;

/**
 * One conversation, on one line as Gmail lists it: who wrote and how many messages, the subject and the start of the
 * newest, and when, marked where Mild could not place it; pointed at, its label, Archive, Spam and Block take the time's
 * place. Unread is bold and bright, read is plain and dimmer. On a phone it reads as a mail app's: who and when, the subject, then a line of
 * the text, with no label.
 */
export const ThreadRow = memo(function ThreadRow({
  thread,
  labels,
  selected,
  hands,
}: {
  thread: Listed;
  labels: readonly AnswerLabel[];
  selected: boolean;
  hands: Hands;
}) {
  const { press, block } = hands;
  const subject = reveal(thread.subject) || '(no subject)';
  const { who } = thread;
  const many = thread.messageIds.length > 1 ? <span className="font-normal text-muted-foreground tabular-nums">{thread.messageIds.length}</span> : null;
  const ink = thread.unread ? 'font-semibold text-foreground' : 'text-foreground/70';
  // Swiped right it is labelled, from a sheet of every label; swiped left, archived. Neither acts on its sender.
  const [labelling, setLabelling] = useState(false);
  const { ending, dialogs } = useLabelEnding(labels, () => messageStart(reveal(thread.from), thread.thinks?.labelId ?? null));
  const start = useMemo<SwipePress>(() => ({ label: 'Label', icon: <TagIcon />, onPress: () => setLabelling(true) }), []);
  const end = useMemo<SwipePress>(
    () => ({ label: 'Archive', icon: <ArchiveIcon />, onPress: () => press([thread], 'archive'), leaves: true }),
    [thread, press],
  );
  return (
    <Tr
      selected={selected}
      onOpen={() => hands.open(thread)}
      onHold={() => hands.hold(thread)}
      onPointerEnter={() => ahead(thread)}
      onFocusCapture={() => ahead(thread)}
      holds={thread.messageIds.map((messageId) => messageKey({ accountId: thread.accountId, messageId }))}
    >
      <RowCheck checked={selected} onChange={(on) => hands.select(thread, on)} label={`Select ${subject}`} />
      <Td className="max-w-0 phone:py-2 md:w-[18%] md:min-w-40">
        <span className={`flex min-w-0 items-baseline gap-1.5 phone:hidden ${ink}`}>
          <span className="truncate">
            <WhoWrote writers={who} />
          </span>
          {many}
        </span>
        {/* On a phone, a mail app's three lines set close: who and when, the subject, the start of the text. */}
        <div className="md:hidden">
          <Swipe start={start} end={end}>
            <span className="flex flex-col leading-snug">
              <span className="flex items-baseline gap-3">
                <span className={`flex min-w-0 flex-1 items-baseline gap-1.5 ${thread.unread ? 'name leading-snug' : 'text-foreground/85'}`}>
                  <span className="truncate">
                    <WhoWrote writers={who} />
                  </span>
                  {many}
                </span>
                <span className={`shrink-0 text-sm tabular-nums ${thread.unread ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                  <Arrived at={thread.newestAt} />
                </span>
              </span>
              <span className={`truncate ${thread.unread ? 'font-semibold text-foreground' : 'text-foreground/85'}`}>
                <Place thread={thread} />
                {subject}
              </span>
              <span className="flex items-baseline gap-3 text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">{thread.preview ? reveal(thread.preview) : null}</span>
                {unplaced(thread) ? <Hint icon={CircleHelpIcon} says="Unlabelled" tone="look" /> : null}
              </span>
            </span>
          </Swipe>
          {labelling ? <LabelSheetFor thread={thread} labels={labels} ending={ending} onClose={() => setLabelling(false)} /> : null}
          {dialogs}
        </div>
      </Td>
      <Td phone="hide" className="max-w-0 md:w-full">
        <span className="block truncate">
          <Place thread={thread} />
          <span className={ink}>{subject}</span>
          {thread.preview ? <span className="text-muted-foreground"> — {reveal(thread.preview)}</span> : null}
        </span>
      </Td>
      <RowPresses
        lead={<Label thread={thread} labels={labels} ending={ending} />}
        mark={unplaced(thread) ? <Hint icon={CircleHelpIcon} says="Unlabelled" tone="look" /> : null}
        presses={
          <>
            <Tooltip says="Archive">
              <Button variant="bare" size="tray" aria-label="Archive" onClick={() => press([thread], 'archive')}>
                <ArchiveIcon aria-hidden />
              </Button>
            </Tooltip>
            <Tooltip says="Spam">
              <Button variant="bare" size="tray" aria-label="Spam" onClick={() => press([thread], 'spam')}>
                <ShieldAlertIcon aria-hidden />
              </Button>
            </Tooltip>
            <Tooltip says="Block sender">
              <Button variant="bare" size="tray" aria-label="Block sender" onClick={() => block([thread])}>
                <BanIcon aria-hidden />
              </Button>
            </Tooltip>
          </>
        }
      >
        <span className={thread.unread ? 'font-semibold text-foreground' : undefined}>
          <Arrived at={thread.newestAt} />
        </span>
      </RowPresses>
    </Tr>
  );
});
