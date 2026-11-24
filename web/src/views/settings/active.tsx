'use client';
import { useState } from 'react';
import { GoThroughInbox, InboxRow } from '@/components/go-through-inbox.tsx';
import { type ManageState, api } from '@/lib/api/endpoints.ts';
import { useAction } from '@/components/action.ts';
import { Ago, Button, ConfirmButton, Failure, Note, Select, SettingRow, SettingsGroup, Sheet, TextLink } from '@/system';

/** Whether Mild is on for the reader's own mail: what they come to Settings for first. */
export function Active({ state, reload }: { state: ManageState; reload: () => void }) {
  const { busy, error, run } = useAction();
  const { active, activity } = state;
  const [goingThrough, setGoingThrough] = useState(false);
  const save = (active: boolean) =>
    run(
      () => api.setActive(active),
      () => {
        reload();
        // What is already in the inbox stays as it was unless Mild goes through it now.
        if (active && !state.inbox.going) setGoingThrough(true);
      },
    );

  return (
    <SettingsGroup title="Active" note="Whether Mild changes your Gmail.">
      {activity.problems.length > 0 ? (
        <Note tone="failure" title="Not working">
          {activity.problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </Note>
      ) : null}
      <Sheet>
        <SettingRow
          title={active ? 'On' : 'Off'}
          note={
            active ? (
              <>
                Mild carries out its decisions in Gmail as each label says. Each change can be undone from <TextLink href="/activity">Activity</TextLink>.
              </>
            ) : (
              'Nothing in Gmail changes. Mild suggests, and learns from your answers.'
            )
          }
        >
          {active ? (
            <Button busy={busy} onClick={() => save(false)}>
              Turn off
            </Button>
          ) : (
            <ConfirmButton variant="plain" question="Archive, label and mark spam on new mail by itself?" busy={busy} onConfirm={() => save(true)}>
              Turn on
            </ConfirmButton>
          )}
        </SettingRow>
        <InboxRow state={state} reload={reload} onGoThrough={() => setGoingThrough(true)} />
        <DigestRow state={state} reload={reload} />
        {activity.running ? (
          <SettingRow
            title="Check for mail"
            note={
              activity.lastPassAt ? (
                <>
                  Last checked <Ago at={activity.lastPassAt} />.
                </>
              ) : (
                'Starting.'
              )
            }
          >
            <Button disabled={busy} onClick={() => run(() => api.checkNow(), reload)}>
              Check now
            </Button>
          </SettingRow>
        ) : null}
      </Sheet>
      <Failure>{error}</Failure>
      {goingThrough ? <GoThroughInbox model={state.model} onClose={() => setGoingThrough(false)} onStarted={reload} /> : null}
    </SettingsGroup>
  );
}

/** The hours of a day, as a clock in any zone reads them: "7:00 AM". */
const HOURS = Array.from({ length: 24 }, (_, hour) => [String(hour), `${hour % 12 || 12}:00 ${hour < 12 ? 'AM' : 'PM'}`] as const);

/** A time zone as its place reads: "Los Angeles" for `America/Los_Angeles`. */
const placeOf = (zone: string) => (zone.split('/').at(-1) ?? zone).replace(/_/g, ' ');

/** When the digests arrive, while some label puts its mail in one. Saving it takes this browser's time zone too. */
function DigestRow({ state, reload }: { state: ManageState; reload: () => void }) {
  const { busy, error, run } = useAction();
  const digesting = state.labels.filter((label) => label.disposition === 'digest').map((label) => label.name);
  if (digesting.length === 0) return null;
  const primary = state.accounts.find((a) => a.primary)?.email ?? state.accounts[0]?.email;
  return (
    <SettingRow
      title="Daily digest"
      note={
        <>
          One email each for {digesting.join(', ')}, in {primary}, on {placeOf(state.digest.timeZone ?? 'UTC')} time.
          <Failure>{error}</Failure>
        </>
      }
    >
      <Select
        label="Digest time"
        value={String(state.digest.hour)}
        options={HOURS}
        disabled={busy}
        onChange={(hour) => run(() => api.setDigestTime(Number(hour)), reload)}
      />
    </SettingRow>
  );
}
