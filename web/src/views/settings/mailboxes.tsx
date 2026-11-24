'use client';
import { Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { type ManageState, api } from '@/lib/api/endpoints.ts';
import { useAction } from '@/components/action.ts';
import { useParam } from '@/lib/params.ts';
import { Ago, Button, DeleteButton, Failure, Note, Select, SettingRow, SettingsGroup, Sheet } from '@/system';
import { FILTERS_STAY, removed } from './removal.ts';

/**
 * A person's only mailbox is how they sign in, so it is never removed on its own: that is deleting the
 * account. Removing the one they are signed in as, with others left, ends their session.
 */
function RemoveMailbox({
  email,
  signedIn,
  last,
  onRemoved,
}: {
  email: string;
  signedIn: boolean;
  last: boolean;
  onRemoved: (notRevoked: string | null) => void;
}) {
  const { settle } = useAction();
  return (
    <DeleteButton
      question={`Remove ${email}?`}
      action="Remove mailbox"
      typed={email}
      icon={<Trash2Icon aria-hidden />}
      disabled={last}
      {...(last ? { why: 'You cannot delete your only remaining mailbox.' } : {})}
      says={
        <>
          Mild stops reading it, revokes its access at Google, and deletes everything it recorded about its mail: decisions and answers. Your labels and rules
          stay, for your other mailboxes.
          {signedIn ? ' You are signed in as it, so you will be signed out.' : ''}
          {FILTERS_STAY}
        </>
      }
      onDelete={() => settle(() => removed(api.removeMailbox(email), onRemoved))}
    >
      Remove
    </DeleteButton>
  );
}

export function Mailboxes({ state, signedInAs, reload }: { state: ManageState; signedInAs: string | null; reload: () => void }) {
  // Kept on the page, not in a toast: it asks the reader to do something at Google, and a toast would go before it was done.
  const [notRevoked, setNotRevoked] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const primary = state.accounts.find((a) => a.primary)?.email;
  // Google's return, when adding one did not work out.
  const [failed] = useParam('signin');
  return (
    <SettingsGroup title="Mailboxes" note="Anyone signed in as one of these sees all of them.">
      <Sheet>
        {state.accounts.map((account) => (
          <SettingRow
            key={account.id}
            title={account.email}
            note={
              <>
                {account.lastSyncedAt ? (
                  <>
                    Synced <Ago at={account.lastSyncedAt} />
                  </>
                ) : (
                  'Not synced yet'
                )}
                {account.email === signedInAs ? ' · Signed in as this one' : ''}
              </>
            }
          >
            <RemoveMailbox
              email={account.email}
              signedIn={account.email === signedInAs}
              last={state.accounts.length === 1}
              onRemoved={(note) => {
                setNotRevoked(note);
                reload();
              }}
            />
          </SettingRow>
        ))}
        <SettingRow title="Another Gmail account" note={failed ? <Failure>{failed}</Failure> : undefined}>
          <Button href="/auth/login?add=1">Connect</Button>
        </SettingRow>
      </Sheet>
      {state.accounts.length > 1 && primary ? (
        <Sheet>
          <SettingRow
            title="Primary mailbox"
            note={
              <>
                Your account goes by it, whichever one you sign in with. If it is removed, the one connected longest takes its place.
                <Failure>{error}</Failure>
              </>
            }
          >
            <Select
              label="Primary mailbox"
              value={primary}
              options={state.accounts.map((a) => [a.email, a.email] as const)}
              disabled={busy}
              onChange={(email) => run(() => api.makePrimary(email), reload)}
            />
          </SettingRow>
        </Sheet>
      ) : null}
      {notRevoked ? (
        <Note tone="failure" title="Mild still has access at Google">
          <p>{notRevoked}</p>
        </Note>
      ) : null}
    </SettingsGroup>
  );
}
