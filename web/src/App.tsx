import { useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { type Days, type DecisionRow, api, useLoaded } from '@/lib/api.ts';
import { ago } from '@/lib/format.ts';
import { useRoute } from '@/lib/route.ts';
import { Button, Loading, Masthead, Note, Select } from '@/system';
import { ChangesView } from '@/views/changes.tsx';
import { Decisions, PERIODS } from '@/views/decisions.tsx';
import { MessageDialog, type MessageRef } from '@/views/message-dialog.tsx';
import { Overview } from '@/views/overview.tsx';
import { LabelsView } from '@/views/labels.tsx';
import { Rules } from '@/views/rules.tsx';
import { SettingsView } from '@/views/settings.tsx';
import { SignInScreen } from '@/views/sign-in.tsx';
import { SuggestionsView } from '@/views/suggestions.tsx';
import { SearchOptions } from '@/views/search-options.tsx';
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
  if (route[0] === 'system') return route[1] === 'search' ? <SearchOptionsPage /> : <SystemView />;
  return <Gate route={route} />;
}

function SearchOptionsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <SearchOptions />
    </main>
  );
}

function Gate({ route }: { route: string[] }) {
  const session = useLoaded('session', (signal) => api.session(signal), 300_000);
  if (!session.data) {
    return session.error ? (
      <div className="p-6">
        <Note tone="failure" title="Could not reach sift">
          <p>{session.error}</p>
        </Note>
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
  const [open, setOpen] = useState<MessageRef | null>(null);
  const summary = useLoaded(`summary-${days}`, (signal) => api.summary(days, signal));
  const waiting = useLoaded('waiting', (signal) => api.suggestions(false, signal));
  const openMessage = (row: DecisionRow) => setOpen({ accountId: row.accountId, messageId: row.messageId, subject: row.subject });
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
          <SuggestionsView onChanged={waiting.reload} />
        ) : section === 'overview' ? (
          <div className="flex flex-col gap-4">
            {summary.error ? <ErrorNote message={summary.error} /> : null}
            {summary.data ? <Overview data={summary.data} period={period} onOpen={openMessage} /> : summary.loading ? <Loading rows={6} /> : null}
          </div>
        ) : section === 'decisions' ? (
          <Decisions days={days} onDays={setDays} onOpen={openMessage} />
        ) : section === 'labels' ? (
          <LabelsView />
        ) : section === 'rules' ? (
          <Rules />
        ) : section === 'changes' ? (
          <ChangesView onOpen={setOpen} />
        ) : (
          <SettingsView page={route[1]} />
        )}
      </main>
      <MessageDialog target={open} onClose={() => setOpen(null)} />
    </div>
  );
}
