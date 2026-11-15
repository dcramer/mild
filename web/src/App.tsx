import { useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { type Days, type DecisionRow, api, useLoaded } from '@/lib/api.ts';
import { ago } from '@/lib/format.ts';
import { useRoute } from '@/lib/route.ts';
import { Button, Loading, Masthead, Note, Select } from '@/system';
import { ChangesView } from '@/views/changes.tsx';
import { Decisions } from '@/views/decisions.tsx';
import { type MessageRef, MessageSheet } from '@/views/message-sheet.tsx';
import { Overview } from '@/views/overview.tsx';
import { Rules } from '@/views/rules.tsx';
import { SendersView } from '@/views/senders.tsx';
import { SettingsView } from '@/views/settings.tsx';
import { SignInScreen } from '@/views/sign-in.tsx';
import { SuggestionsView } from '@/views/suggestions.tsx';
import { SystemView } from '@/views/system.tsx';

const PERIODS = [
  ['1', 'Last 24 hours'],
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
] as const;

const SECTIONS = ['suggestions', 'overview', 'decisions', 'rules', 'senders', 'changes', 'settings'] as const;
const NAMES: Record<(typeof SECTIONS)[number], string> = {
  suggestions: 'Suggestions',
  overview: 'Overview',
  decisions: 'Decisions',
  rules: 'Rules',
  senders: 'Senders',
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
                <Button variant="quiet" size="sm" onClick={() => void api.signOut().then(() => window.location.assign('/'))}>
                  Sign out
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <main className="pb-10">
        {section === 'suggestions' ? (
          <SuggestionsView onOpen={setOpen} onChanged={waiting.reload} />
        ) : section === 'overview' ? (
          <div className="flex flex-col gap-4">
            {summary.error ? <ErrorNote message={summary.error} /> : null}
            {summary.data ? <Overview data={summary.data} period={period} onOpen={openMessage} /> : summary.loading ? <Loading rows={6} /> : null}
          </div>
        ) : section === 'decisions' ? (
          <Decisions days={days} period={period} onOpen={openMessage} />
        ) : section === 'rules' ? (
          <Rules />
        ) : section === 'senders' ? (
          <SendersView />
        ) : section === 'changes' ? (
          <ChangesView onOpen={setOpen} />
        ) : (
          <SettingsView page={route[1]} />
        )}
      </main>
      <MessageSheet target={open} onClose={() => setOpen(null)} />
    </div>
  );
}
