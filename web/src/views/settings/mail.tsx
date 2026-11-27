'use client';
import { useState } from 'react';
import { timeLeft } from '@/components/go-through-inbox.tsx';
import { count } from '@/lib/format.ts';
import { MailWindowDialog, TurnInboxOn, windowName } from '@/components/inbox-switch.tsx';
import { type ManageState, api } from '@/lib/api/endpoints.ts';
import { useAction } from '@/components/action.ts';
import { Button, Failure, SettingRow, SettingsGroup, Share, Sheet, useNow } from '@/system';

/** Inbox: reading and handling mail in Mild, with what Mild thinks of each message beside it. */
export function Mail({ state, reload }: { state: ManageState; reload: () => void }) {
  const { busy, error, run } = useAction();
  const [changing, setChanging] = useState(false);
  const now = useNow(10_000);
  const { copying } = state;
  return (
    <SettingsGroup title="Inbox" note="Read and handle your mail in Mild.">
      <Sheet>
        <SettingRow
          title={state.mail ? 'On' : 'Off'}
          note={
            state.mail
              ? 'Mild keeps a copy of your mail to show it here. Turning Inbox off deletes that copy.'
              : 'Mild keeps the text only of mail waiting on you, and of the mail you answered for.'
          }
        >
          {state.mail ? (
            <Button busy={busy} onClick={() => run(() => api.setMail(false), reload)}>
              Turn off
            </Button>
          ) : (
            <TurnInboxOn label="Turn on" />
          )}
        </SettingRow>
        {state.mail ? (
          <SettingRow
            title={copying ? `Copying ${windowName(state.mailWindow).toLowerCase()}` : windowName(state.mailWindow)}
            note={
              copying ? (
                <div className="flex flex-col gap-2 pt-1">
                  <Share part={copying.done} whole={copying.counted ? Math.max(copying.total, copying.done) : null} />
                  <span className="tabular-nums">
                    {copying.counted
                      ? [`${count(copying.done)} of ${count(Math.max(copying.total, copying.done))}`, now === null ? null : timeLeft(copying, now)]
                          .filter(Boolean)
                          .join(' · ')
                      : ['Counting your mail', copying.total > 0 ? `${count(copying.total)} found` : null].filter(Boolean).join(' · ')}
                  </span>
                </div>
              ) : (
                'Kept, and whatever is in your inbox however old.'
              )
            }
          >
            <Button onClick={() => setChanging(true)}>Change…</Button>
          </SettingRow>
        ) : null}
      </Sheet>
      <Failure>{error}</Failure>
      {changing ? <MailWindowDialog current={state.mailWindow} onClose={() => setChanging(false)} onDone={reload} /> : null}
    </SettingsGroup>
  );
}
