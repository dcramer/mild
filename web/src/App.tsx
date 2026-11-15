import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { Picker } from '@/components/picker.tsx';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type Days, type DecisionRow, api, useLoaded } from '@/lib/api.ts';
import { ago } from '@/lib/format.ts';
import { useTheme } from '@/lib/theme.ts';
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
const THEME_ICONS = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };
const THEME_NAMES = { system: 'Theme: follow system', light: 'Theme: light', dark: 'Theme: dark' };

export function App() {
  const [days, setDays] = useState<Days>(7);
  const [tab, setTab] = useState('suggestions');
  const [open, setOpen] = useState<MessageRef | null>(null);
  const { theme, cycle } = useTheme();
  const summary = useLoaded(`summary-${days}`, (signal) => api.summary(days, signal));
  const waiting = useLoaded('waiting', (signal) => api.suggestions(false, signal));
  const waitingCount = waiting.data?.waiting ?? 0;
  const ThemeIcon = THEME_ICONS[theme];
  const openMessage = (row: DecisionRow) => setOpen({ accountId: row.accountId, messageId: row.messageId, subject: row.subject });
  const accounts = summary.data?.accounts ?? [];

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="paper min-h-svh gap-0">
      <header className="sticky top-0 z-10 border-b border-foreground/25 bg-card">
        <div className="mx-auto flex min-h-12 max-w-7xl flex-wrap items-center gap-x-5 px-4">
          <h1 className="font-heading text-[26px] leading-none italic">
            <span className="hl mx-0 px-2">sift</span>
          </h1>
          <TabsList variant="line" className="h-12 gap-4 p-0">
            <TabsTrigger value="suggestions">
              Suggestions
              {waitingCount > 0 ? <span className="ml-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">{waitingCount}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="decisions">Decisions</TabsTrigger>
            <TabsTrigger value="rules">Rules</TabsTrigger>
            <TabsTrigger value="senders">Senders</TabsTrigger>
            <TabsTrigger value="changes">Changes</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <p className="hidden min-w-0 flex-1 truncate text-right text-[13px] text-muted-foreground md:block">
            {summary.data
              ? accounts.length === 0
                ? 'No account connected. Run sift auth.'
                : accounts.map((a) => `${a.email} · ${a.lastSyncedAt ? `synced ${ago(a.lastSyncedAt)}` : 'not synced yet'}`).join('   ')
              : ''}
          </p>
          <div className="ml-auto flex items-center gap-1 py-2 md:ml-0">
            {tab !== 'overview' && tab !== 'decisions' ? null : (
              <Picker
                label="Period"
                value={String(days) as (typeof PERIODS)[number][0]}
                options={PERIODS}
                onChange={(value) => setDays(Number(value) as Days)}
              />
            )}
            <Button variant="ghost" size="icon-sm" aria-label={THEME_NAMES[theme]} title={THEME_NAMES[theme]} onClick={cycle}>
              <ThemeIcon />
            </Button>
          </div>
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
