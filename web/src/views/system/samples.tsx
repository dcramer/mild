import { ActivityIcon, ListChecksIcon, TagIcon, WorkflowIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { INBOX, INBOX_NAME, TIERS } from '@/lib/words.ts';

/** The made-up mail, people and figures the specimens show, and the row each specimen is set in. */

export const DAILY_COST = [
  0.11, 0.14, 0.09, 0.21, 0.12, 0.08, 0.04, 0.13, 0.16, 0.1, 0.12, 0.31, 0.15, 0.09, 0.05, 0.12, 0.14, 0.11, 0.18, 0.13, 0.07, 0.06, 0.15, 0.17, 0.12, 0.19,
  0.14, 0.11, 0.16, 0.14,
];
const SAVED_DAILY = [52, 61, 70, 22, 18, 64, 58, 49, 73, 60, 24, 15, 57, 71, 63, 66, 51, 20, 19, 62, 68, 75, 55, 59, 27, 18, 64, 72, 60, 52];
const SAVED = (messages: number) => ({ messages, seconds: messages * 10 });
export const USAGE = {
  day: 0.14,
  week: 0.96,
  month: DAILY_COST.reduce((a, b) => a + b),
  daily: DAILY_COST,
  saved: {
    day: SAVED(52),
    week: SAVED(401),
    month: SAVED(SAVED_DAILY.reduce((a, b) => a + b)),
    daily: SAVED_DAILY.map((n) => n * 10),
    wouldHave: SAVED(0),
  },
};
export const SYNCED = Date.now() - 20_000;
export const SPECIMEN_ACCOUNTS = [
  { id: 'ada@example.org', email: 'ada@example.org', lastSyncedAt: SYNCED, primary: true, canSend: false, aliases: [], signInEnds: null },
];
export const NAV = [
  { to: 'system', label: 'For review', icon: ListChecksIcon, count: 12 },
  { to: 'system/activity', label: 'Activity', icon: ActivityIcon },
  { to: 'system/labels', label: 'Labels', icon: TagIcon },
  { to: 'system/rules', label: 'Rules', icon: WorkflowIcon },
];
export const SERIES = TIERS.map((t, index) => ({ key: String(index), name: t.name, color: t.color }));
export const DAYS = [
  [12, 5, 3, 1],
  [8, 9, 2, 0],
  [15, 4, 6, 2],
  [0, 0, 0, 0],
  [9, 11, 1, 0],
  [20, 6, 4, 3],
  [14, 7, 2, 1],
].map((counts, index) => ({
  key: String(index),
  label: `Nov ${index + 9}`,
  title: `Nov ${index + 9}`,
  values: Object.fromEntries(counts.map((n, i) => [String(i), n])),
}));
export const LABELS = [
  [INBOX, INBOX_NAME],
  ['newsletter', 'Newsletters'],
  ['marketing', 'Marketing'],
  ['phishing', 'Scams and phishing'],
] as const;
export const SHEET_LABELS = [
  [[INBOX, INBOX_NAME, 'keep']],
  [['marketing', 'Marketing', 'archive', 3]],
  [
    ['newsletter', 'Newsletters', 'archive'],
    ['receipts', 'Receipts and transactions', 'archive'],
    ['notifications', 'Notifications', 'archive'],
    ['alerts', 'Account alerts', 'keep'],
    ['outreach', 'Cold outreach', 'spam'],
    ['phishing', 'Scams and phishing', 'spam'],
  ],
] as const;
export const ROWS = [
  { sender: 'Example Weekly', address: 'news@example.com', subject: 'Five things to read', label: 'Newsletters', does: 'archive' },
  { sender: 'Ada at Example', address: 'ada@example.org', subject: 'Dinner on Saturday?', label: INBOX_NAME, does: 'keep' },
  { sender: 'founder@example.net', address: 'founder@example.net', subject: 'Quick question', label: null, does: 'review' },
];

export const INKS = [
  ['bg-background', 'background', 'The page.'],
  ['bg-rail', 'rail', 'The sections: the rail, and on a phone the tab bar.'],
  ['bg-popover', 'popover', 'What floats: a dialog, a menu, a failed toast.'],
  ['bg-foreground', 'foreground', 'Ink: text, the main action, and a toast.'],
  ['bg-supporting', 'supporting', 'What supports the text: a preview, a hint, Mild’s label.'],
  ['bg-faint', 'faint', 'What only places a row: when, an address, a count. A row’s quiet ink.'],
  ['bg-(--frame)', '--frame', 'A sheet’s edge.'],
  ['bg-(--rule)', '--rule', 'Lines between rows, dashed.'],
  ['bg-(--fill)', '--fill', 'What a control is filled with.'],
  ['bg-(--row-strong)', '--row', 'The row you are on: quieter than any control on it.'],
  ['bg-highlight', 'highlight', 'Look here. Nothing else is yellow.'],
  ['bg-destructive', 'destructive', 'A failure. Nothing else is red.'],
] as const;

export const VARIANTS = [
  ['mark', 'What the screen is waiting on. One per screen, at most, never down a list.'],
  ['ink', 'What finishes a dialog or a form. Never down a list.'],
  ['plain', 'A page’s own action, and everything else said once.'],
  ['quiet', 'Repeated down a list (firmer when its row is pointed at), and ways out.'],
  ['danger', 'Deleting what nothing brings back, said once. Only DeleteButton draws it.'],
  ['destroy', 'The press that deletes, once asked. Only DeleteButton draws it.'],
] as const;

/** A specimen, named, with what it is for under it. */
export function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="row grid items-center gap-x-4 gap-y-2 px-4 py-4 sm:grid-cols-[8rem_1fr]">
      <p className="slug text-muted-foreground">{label}</p>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">{children}</div>
        {note ? <p className="text-muted-foreground">{note}</p> : null}
      </div>
    </div>
  );
}
