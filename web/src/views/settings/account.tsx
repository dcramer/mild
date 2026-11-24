'use client';
import { type ManageState, api } from '@/lib/api/endpoints.ts';
import { useAction } from '@/components/action.ts';
import { DeleteButton, SettingRow, SettingsGroup, Sheet } from '@/system';
import { FILTERS_STAY, removed } from './removal.ts';

export function Account({ state, signedInAs }: { state: ManageState; signedInAs: string | null }) {
  const { settle } = useAction();
  const email = state.accounts.find((a) => a.primary)?.email ?? signedInAs ?? state.accounts[0]?.email ?? '';
  return (
    <SettingsGroup title="Your account">
      <Sheet>
        <SettingRow
          title="Delete your account"
          note={`Mild stops reading every mailbox, and everything it recorded is deleted.${state.owner ? ' Others signed in to this Mild keep theirs.' : ''}`}
        >
          <DeleteButton
            question="Delete your account?"
            action="Delete everything"
            typed={email}
            says={
              <>
                Mild stops reading every mailbox, revokes its access at Google, and deletes everything it recorded: decisions, answers, rules, labels and your
                model sign-in.{FILTERS_STAY}
              </>
            }
            onDelete={() => settle(() => removed(api.deleteAccount(email)))}
          >
            Delete account
          </DeleteButton>
        </SettingRow>
      </Sheet>
    </SettingsGroup>
  );
}
