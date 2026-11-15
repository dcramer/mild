import { useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { type Days, api, useLoaded, useOnline } from '@/lib/api.ts';
import { ago } from '@/lib/format.ts';
import { useRoute } from '@/lib/route.ts';
import { Button, Loading, Masthead, Note, Notice, Select, Wordmark } from '@/system';
import { ChangesView } from '@/views/changes.tsx';
import { Decisions, PERIODS } from '@/views/decisions.tsx';
import { MessagePanel, type MessageRef } from '@/views/message-panel.tsx';
import { Overview } from '@/views/overview.tsx';
import { LabelsView } from '@/views/labels.tsx';
import { Rules } from '@/views/rules.tsx';
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
  const [days, setDays] = useState<Days>(7);
  // The message panel: the list it was opened from and which item is showing.
  const [open, setOpen] = useState<{ items: MessageRef[]; index: number } | null>(null);
  const online = useOnline();
  const summary = useLoaded(`summary-${days}`, (signal) => api.summary(days, signal));
  const waiting = useLoaded('suggestions-false', (signal) => api.suggestions(false, signal));
  const openMessages = (items: MessageRef[], index: number) => setOpen({ items, index });
  const accounts = summary.data?.accounts ?? [];
  const synced = accounts.map((a) => a.lastSyncedAt).filter((at) => at !== null);
  const period = (
    <Select label="Period" value={String(days) as (typeof PERIODS)[number][0]} options={PERIODS} onChange={(value) => setDays(Number(value) as Days)} />
  );

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-7xl flex-col px-4">
      <Masthead
        current={section}
        items={SECTIONS.map((to) => ({ to, label: NAMES[to], ...(to === 'suggestions' && waiting.data?.waiting ? { count: waiting.data.waiting } : {}) }))}
        status={online ? null : <Notice>Offline</Notice>}
        aside={
          <>
            {summary.data ? (
              <span>{accounts.length === 0 ? 'No account connected' : synced.length > 0 ? `Synced ${ago(Math.min(...synced))}` : 'Not synced yet'}</span>
            ) : null}
            {signedInAs ? (
              <>
                <span>{signedInAs}</span>
                <Button variant="quiet" onClick={() => void api.signOut().then(() => window.location.assign('/'))}>
                  Sign out
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <main className="pb-10">
        {section === 'suggestions' ? (
          <SuggestionsView onOpen={openMessages} />
        ) : section === 'overview' ? (
          <div className="flex flex-col gap-4">
            {summary.error ? <ErrorNote message={summary.error} /> : null}
            {summary.data ? <Overview data={summary.data} period={period} onOpen={openMessages} /> : summary.loading ? <Loading rows={6} /> : null}
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
        <MessagePanel items={open.items} index={open.index} onIndex={(index) => setOpen({ items: open.items, index })} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}
