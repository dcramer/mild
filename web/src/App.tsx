import { useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { type Days, api, useLoaded, useOnline } from '@/lib/api.ts';
import { ago } from '@/lib/format.ts';
import { setParams, useParam, useRoute } from '@/lib/route.ts';
import { Loading, Masthead, Note, Notice, Select, Wordmark } from '@/system';
import { ChangesView } from '@/views/changes.tsx';
import { Decisions, PERIODS } from '@/views/decisions.tsx';
import { MessagePanel, type MessageRef } from '@/views/message-panel.tsx';
import { Overview } from '@/views/overview.tsx';
import { LabelsView } from '@/views/labels.tsx';
import { Rules } from '@/views/rules.tsx';
import { SenderView } from '@/views/sender.tsx';
import { SettingsView } from '@/views/settings.tsx';
import { SignInScreen } from '@/views/sign-in.tsx';
import { SuggestionsView } from '@/views/suggestions.tsx';
import { SystemView } from '@/views/system.tsx';

const SECTIONS = ['suggestions', 'overview', 'decisions', 'labels', 'rules', 'changes', 'settings'] as const;
const NAMES: Record<(typeof SECTIONS)[number], string> = {
  suggestions: 'Suggestions',
  overview: 'Overview',
  decisions: 'Decisions',
  labels: 'Labels',
  rules: 'Rules',
  changes: 'Changes',
  settings: 'Settings',
};

/** Shows the sign-in screen until the viewer is signed in, then the dashboard. */
export function App() {
  const route = useRoute();
  // The specimen page is open to anyone and holds no data. It is rendered outside the gate so it asks the API for nothing, not even who is signed in.
  if (route[0] === 'system') return <SystemView />;
  return <Gate route={route} />;
}

function Gate({ route }: { route: string[] }) {
  const session = useLoaded('session', (signal) => api.session(signal), 300_000);
  const online = useOnline();
  if (!session.data) {
    // Nothing is kept between visits, so opened while sift is unreachable there is only this to show.
    return session.error || !online ? (
      <div className="flex flex-col items-start gap-6 p-6">
        <Wordmark />
        {session.error ? (
          <Note tone="failure" title="sift answered with an error">
            <p>{session.error}</p>
          </Note>
        ) : (
          <Note title="Offline">
            <p>sift cannot be reached. This page opens by itself when it can.</p>
          </Note>
        )}
      </div>
    ) : null;
  }
  if (session.data.required && session.data.email === null) {
    return <SignInScreen session={session.data} error={new URLSearchParams(window.location.search).get('signin')} />;
  }
  return <Dashboard signedInAs={session.data.email} route={route} />;
}

function Dashboard({ signedInAs, route }: { signedInAs: string | null; route: string[] }) {
  const section = SECTIONS.find((s) => s === route[0]) ?? 'suggestions';
  // A sender's or a domain's own page: `/sender/<account>/<address>`.
  const profile =
    (route[0] === 'sender' || route[0] === 'domain') && route[1] && route[2]
      ? { kind: route[0], accountId: decodeURIComponent(route[1]), key: decodeURIComponent(route[2]) }
      : null;
  const [period, setPeriod] = useParam('days');
  const days = (PERIODS.some(([key]) => key === period) ? Number(period) : 7) as Days;
  const setDays = (next: Days) => setPeriod(next === 7 ? '' : String(next));
  // The message panel. Which message is open is in the address, so it can be linked to and Back closes
  // it; the list it was opened from, for previous and next, is only known when it was opened from one here.
  const [list, setList] = useState<MessageRef[]>([]);
  const [messageId] = useParam('message');
  const [accountId] = useParam('account');
  const listed = list.findIndex((item) => item.messageId === messageId && item.accountId === accountId);
  const open = messageId === '' ? null : listed === -1 ? { items: [{ accountId, messageId, subject: '' }], index: 0 } : { items: list, index: listed };
  const show = (item: MessageRef | undefined, push?: { state: unknown }) => setParams({ message: item?.messageId ?? '', account: item?.accountId ?? '' }, push);
  const online = useOnline();
  const summary = useLoaded(`summary-${days}`, (signal) => api.summary(days, signal));
  const waiting = useLoaded('suggestions-false', (signal) => api.suggestions(false, signal));
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  const expired = manage.data?.activity.expired ?? [];
  const openMessages = (items: MessageRef[], index: number) => {
    setList(items);
    show(items[index], { state: { panel: true } });
  };
  const accounts = summary.data?.accounts ?? [];
  const synced = accounts.map((a) => a.lastSyncedAt).filter((at) => at !== null);
  const periodSelect = (
    <Select label="Period" value={String(days) as (typeof PERIODS)[number][0]} options={PERIODS} onChange={(value) => setDays(Number(value) as Days)} />
  );

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-7xl flex-col px-4">
      <Masthead
        current={profile ? '' : section}
        items={SECTIONS.map((to) => ({ to, label: NAMES[to], ...(to === 'suggestions' && waiting.data?.waiting ? { count: waiting.data.waiting } : {}) }))}
        status={
          !online ? (
            <Notice>Offline</Notice>
          ) : expired.length > 0 ? (
            // Signing in again is what renews sift's access; Google asks which account. Named when it is one that is not the viewer's own.
            <Notice tone="look" href="/auth/login" action="Reconnect">
              Google sign-in expired{expired.length > 1 ? ` for ${expired.length} accounts` : expired[0] === signedInAs ? '' : ` for ${expired[0]}`}
            </Notice>
          ) : null
        }
        aside={
          summary.data ? (
            <span className="whitespace-nowrap">
              {accounts.length === 0 ? 'No account connected' : synced.length > 0 ? `Synced ${ago(Math.min(...synced))}` : 'Not synced yet'}
            </span>
          ) : null
        }
        account={
          signedInAs
            ? {
                name: signedInAs,
                items: [
                  {
                    label: 'Sign out',
                    onSelect: () => void api.signOut().then(() => window.location.assign('/')),
                    ...(online ? {} : { disabled: true, note: 'Not while sift is unreachable.' }),
                  },
                ],
              }
            : undefined
        }
      />

      <main className="pb-10">
        {profile ? (
          <SenderView
            accountId={profile.accountId}
            who={profile.kind === 'sender' ? { address: profile.key } : { domain: profile.key }}
            onOpen={openMessages}
          />
        ) : section === 'suggestions' ? (
          <SuggestionsView onOpen={openMessages} />
        ) : section === 'overview' ? (
          <div className="flex flex-col gap-4">
            {summary.error ? <ErrorNote message={summary.error} /> : null}
            {summary.data ? <Overview data={summary.data} period={periodSelect} onOpen={openMessages} /> : summary.loading ? <Loading rows={6} /> : null}
          </div>
        ) : section === 'decisions' ? (
          <Decisions days={days} onDays={setDays} onOpen={openMessages} />
        ) : section === 'labels' ? (
          <LabelsView />
        ) : section === 'rules' ? (
          <Rules />
        ) : section === 'changes' ? (
          <ChangesView onOpen={openMessages} />
        ) : (
          <SettingsView page={route[1]} />
        )}
      </main>
      {open ? (
        <MessagePanel
          items={open.items}
          index={open.index}
          onIndex={(index) => show(open.items[index])}
          // Opened from a list here, the entry before this one is that list: go back to it, so Back and Close agree.
          onClose={() => ((window.history.state as { panel?: boolean } | null)?.panel ? window.history.back() : show(undefined))}
        />
      ) : null}
    </div>
  );
}
