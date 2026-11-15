import { useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { Picker } from '@/components/picker.tsx';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type Days, type DecisionRow, api, useLoaded } from '@/lib/api.ts';
import { ago } from '@/lib/format.ts';
import { Decisions } from '@/views/decisions.tsx';
import { type MessageRef, MessageSheet } from '@/views/message-sheet.tsx';
import { Overview } from '@/views/overview.tsx';
import { ChangesView } from '@/views/changes.tsx';
import { Rules } from '@/views/rules.tsx';
import { SendersView } from '@/views/senders.tsx';
import { SettingsView } from '@/views/settings.tsx';
import { SuggestionsView } from '@/views/suggestions.tsx';

const PERIODS = [
  ['1', 'Last 24 hours'],
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
] as const;

export function App() {
  const [days, setDays] = useState<Days>(7);
  const [tab, setTab] = useState('suggestions');
  const [open, setOpen] = useState<MessageRef | null>(null);
  const summary = useLoaded(`summary-${days}`, (signal) => api.summary(days, signal));
  const waiting = useLoaded('waiting', (signal) => api.suggestions(false, signal));
  const waitingCount = waiting.data?.waiting ?? 0;
  const openMessage = (row: DecisionRow) => setOpen({ accountId: row.accountId, messageId: row.messageId, subject: row.subject });
  const accounts = summary.data?.accounts ?? [];

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="min-h-svh gap-0">
      {/* No bar: the name and the sections sit straight on the page, the dateline opposite. */}
      <header className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-5">
        <h1 className="wordmark">
          <span className="hl mx-0 px-2 py-0.5">sift</span>
        </h1>
        <TabsList variant="line" className="h-9 flex-wrap gap-x-4 p-0">
          <TabsTrigger value="suggestions">
            Suggestions
            {waitingCount > 0 ? <span className="tabular-nums opacity-60">{waitingCount}</span> : null}
          </TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="decisions">Decisions</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="senders">Senders</TabsTrigger>
          <TabsTrigger value="changes">Changes</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <div className="ml-auto flex items-center gap-3">
          {tab !== 'overview' && tab !== 'decisions' ? null : (
            <Picker label="Period" value={String(days) as (typeof PERIODS)[number][0]} options={PERIODS} onChange={(value) => setDays(Number(value) as Days)} />
          )}
          <p className="slug hidden text-muted-foreground md:block">
            {summary.data
              ? accounts.length === 0
                ? 'No account connected'
                : accounts.map((a) => `${a.email} · ${a.lastSyncedAt ? `synced ${ago(a.lastSyncedAt)}` : 'not synced yet'}`).join('   ')
              : ''}
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-5">
        <TabsContent value="suggestions">
          <SuggestionsView onOpen={setOpen} onChanged={waiting.reload} />
        </TabsContent>
        <TabsContent value="overview" className="flex flex-col gap-3">
          {summary.error ? <ErrorNote message={summary.error} /> : null}
          {summary.data ? (
            <Overview data={summary.data} onOpen={openMessage} onViewAll={() => setTab('decisions')} />
          ) : summary.loading ? (
            <Skeleton className="h-96 w-full" />
          ) : null}
        </TabsContent>
        <TabsContent value="decisions">
          <Decisions days={days} onOpen={openMessage} />
        </TabsContent>
        <TabsContent value="rules">
          <Rules />
        </TabsContent>
        <TabsContent value="senders">
          <SendersView />
        </TabsContent>
        <TabsContent value="changes">
          <ChangesView onOpen={setOpen} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsView />
        </TabsContent>
      </main>
      <MessageSheet target={open} onClose={() => setOpen(null)} />
    </Tabs>
  );
}
