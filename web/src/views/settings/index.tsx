'use client';
import { ErrorNote } from '@/components/bits.tsx';
import { Loading, Panel } from '@/system';
import { useSession, useManage } from '@/lib/api/reads.ts';
import { Account } from './account.tsx';
import { Active } from './active.tsx';
import { Keys } from './keys.tsx';
import { Mail } from './mail.tsx';
import { Mailboxes } from './mailboxes.tsx';
import { Model } from './model.tsx';

/** How mild runs, most used first. What it does with mail is under Labels and Rules. */
/** Settings, over whatever is showing. Opened from the account menu, or from the setting-up page, so nothing has to be set up first. */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { data, error, loading, reload } = useManage({ refreshMs: 10_000 });
  const session = useSession();
  const signedInAs = session.data?.email ?? null;
  return (
    <Panel open onClose={onClose} title="Settings">
      <div className="flex flex-col gap-10">
        {error ? <ErrorNote message={error} /> : null}
        {loading ? (
          <Loading rows={6} />
        ) : data ? (
          <>
            {/* Whether sift is on, the model and its sign-in are each person's own. */}
            <Active state={data} reload={reload} />
            <Mail state={data} reload={reload} />
            <Model state={data} reload={reload} onConnect={onClose} />
            <Mailboxes state={data} signedInAs={signedInAs} reload={reload} />
            <Keys />
            <Account state={data} signedInAs={signedInAs} />
          </>
        ) : null}
      </div>
    </Panel>
  );
}
