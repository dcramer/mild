'use client';
import { type DehydratedState, HydrationBoundary, useIsFetching } from '@tanstack/react-query';
import { ActivityIcon, ListChecksIcon, TagIcon, WorkflowIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { SetUp } from '@/components/set-up.tsx';
import { SiftStatus, UsageDetail } from '@/components/status.tsx';
import { api, useLoaded, useOnline } from '@/lib/api.ts';
import { OpenMessagesContext } from '@/lib/open-messages.ts';
import { isMessageKey, panelEntry, setParams, useHere, useParam } from '@/lib/params.ts';
import { useHidden } from '@/lib/action.ts';
import { subscription } from '@/lib/prices.ts';
import { startTelemetry } from '@/lib/telemetry.ts';
import { Cloud, LoadingBar, Masthead, Notice, PageFoot, Rail, useGoing } from '@/system';
import { Boot } from '@/views/boot.tsx';
import { SignInScreen } from '@/views/sign-in.tsx';
import type { MessageRef } from '@/views/message-panel.tsx';

// What opens over a screen is fetched when first needed and, once the page is idle, ahead of need.
const loadSettings = () => import('@/views/settings.tsx');
const loadMessage = () => import('@/views/message-panel.tsx');
// Opened together from the address (`?message=…&settings=1`), each waits for both, so they open in the order they are
// drawn, the last on top, whichever arrived first.
const loadPanels = () => Promise.all([loadSettings(), loadMessage()]);
const SettingsPanel = dynamic(() => loadPanels().then(([m]) => m.SettingsPanel), { ssr: false });
const MessagePanel = dynamic(() => loadPanels().then(([, m]) => m.MessagePanel), { ssr: false });

function usePanelsAhead() {
  useEffect(() => {
    const ahead = () => {
      for (const load of [loadSettings, loadMessage]) void load().catch(() => {});
    };
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(ahead, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(ahead, 1500);
    return () => clearTimeout(timer);
  }, []);
}

const SECTIONS = [
  { to: '', label: 'For review', icon: ListChecksIcon },
  { to: 'activity', label: 'Activity', icon: ActivityIcon },
  { to: 'labels', label: 'Labels', icon: TagIcon },
  { to: 'rules', label: 'Rules', icon: WorkflowIcon },
] as const;

/** Settings opens over whatever is showing, setting up included, so nothing has to be finished to reach it. */
const openSettings = () => setParams({ settings: '1' }, { state: { panel: true } });
// A failed sign-in said in Settings (`signin`) goes with it.
const closeSettings = () => (panelEntry() ? window.history.back() : setParams({ settings: '', signin: '' }));

/**
 * The dashboard around `children`, the screen the address names, for whoever the server read the session as (`drawn`,
 * `src/sift/page-data.ts`, with what else it holds that is not encrypted): the sign-in screen for nobody, the
 * setting-up steps until there is something to show, and otherwise the sections, the screen and its foot.
 */
export function Dashboard({ drawn, children }: { drawn: DehydratedState | null; children: ReactNode }) {
  if (!drawn) return <Signed>{children}</Signed>;
  return (
    <HydrationBoundary state={drawn}>
      <Signed>{children}</Signed>
    </HydrationBoundary>
  );
}

function Signed({ children }: { children: ReactNode }) {
  const [settings] = useParam('settings');
  const [signin] = useParam('signin');
  const session = useLoaded('session', (signal) => api.session(signal), 300_000);
  const online = useOnline();
  const known = session.data;
  const telemetry = known?.telemetry ?? null;
  useEffect(() => startTelemetry(telemetry), [telemetry]);
  const nobody = known?.required === true && known.email === null;
  // Drawn for everyone (`drawn` null), or the server could not read the session: only the opening until the browser has, so a
  // sign-in screen is not drawn over a dashboard, nor one over the other. Not set up, or not answering, it says so.
  if (!known) return session.missing || session.error || !online ? <Boot missing={session.missing} error={session.error} online={online} /> : <Opening />;
  if (nobody)
    return (
      <Cloud value={known.cloud}>
        <SignInScreen session={known} error={signin || null} />
      </Cloud>
    );
  return (
    <Cloud value={known.cloud}>
      <SetUp signedInAs={known.email} onSettings={openSettings}>
        <Frame signedInAs={known.email}>{children}</Frame>
      </SetUp>
      {settings === '1' ? <SettingsPanel onClose={closeSettings} /> : null}
    </Cloud>
  );
}

/**
 * The page while the server draws its frame, or the browser asks who is signed in: the name where the rail, the
 * masthead and the sign-in page have it, and the loading bar. Built once for everyone, so nothing that only someone signed in sees.
 */
export function Opening() {
  return (
    <div className="md:flex">
      <Rail current="" items={[]} />
      <div className="mx-auto flex min-h-svh w-full max-w-7xl min-w-0 flex-col px-4 md:px-6">
        <LoadingBar on />
        <Masthead current="" items={[]} />
      </div>
    </div>
  );
}

/** Data a screen or panel has none of yet: a search, a sender's page, a message just opened. Not a list read again. */
const firstLoad = { predicate: (query: { state: { data: unknown } }) => query.state.data === undefined };

function Frame({ signedInAs, children }: { signedInAs: string | null; children: ReactNode }) {
  usePanelsAhead();
  const [, section] = usePathname().split('/');
  // The message panel. Which message is open is in the address, so it can be linked to and Back closes
  // it; the list it was opened from, for previous and next, is only known when it was opened from one here.
  const [list, setList] = useState<MessageRef[]>([]);
  // The address names the message alone: the server finds which mailbox holds it.
  const [messageId] = useParam('message');
  const listed = list.findIndex((item) => item.messageId === messageId);
  const open = messageId === '' ? null : listed === -1 ? { items: [{ accountId: '', messageId, subject: null }], index: 0 } : { items: list, index: listed };
  const show = (item: MessageRef | undefined, push?: { state: { panel: boolean } }) => setParams({ message: item?.messageId ?? '' }, push);
  const online = useOnline();
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  const expired = manage.data?.activity.expired ?? [];
  const here = useHere();
  // A list can be pressed while the last panel is still sliding away, its message still in the address. That
  // press gets a panel of its own, since the closing one would only finish closing and then go Back; and it
  // takes over the closing one's history entry, or closing it would go Back to the message just closed.
  // A message opened over one still open (from a rule made from it) gets an entry of its own, so Back returns there.
  const [opened, setOpened] = useState(0);
  const closing = useRef(false);
  const openMessages = (items: MessageRef[], index: number) => {
    const takeOver = closing.current;
    closing.current = false;
    setList(items);
    setOpened((n) => n + 1);
    show(items[index], takeOver ? undefined : { state: { panel: true } });
  };
  const accounts = manage.data?.accounts ?? [];
  // Who they are, not which mailbox they happened to sign in with.
  const name = accounts.find((a) => a.primary)?.email ?? signedInAs;
  const usage = useLoaded('usage', (signal) => api.usage(signal), 60_000);
  const plan = manage.data ? subscription(manage.data.model) : null;
  // An answer on its way has left the list, so it leaves the count with it until the count is read again.
  const waiting = Math.max(0, (manage.data?.waiting ?? 0) - [...useHidden(manage.at)].filter(isMessageKey).length);

  const going = useGoing();
  const fetching = useIsFetching(firstLoad);
  const items = SECTIONS.map((s) => ({ ...s, ...(s.to === '' && waiting ? { count: waiting } : {}) }));
  const notice = !online ? (
    <Notice>Sift cannot be reached</Notice>
  ) : expired.length > 0 ? (
    // Signing in again is what renews sift's access; Google asks which account. Named when it is one that is not the viewer's own.
    <Notice tone="look" href={`/auth/login?to=${encodeURIComponent(here)}`} action="Reconnect">
      Google sign-in expired{expired.length > 1 ? ` for ${expired.length} accounts` : expired[0] === name ? '' : ` for ${expired[0]}`}
    </Notice>
  ) : null;
  const status = (stacked: boolean) => (manage.data ? <SiftStatus accounts={accounts} usage={usage.data} plan={plan} stacked={stacked} /> : null);
  const account = name
    ? {
        name,
        items: [
          { label: 'Settings', onSelect: openSettings },
          {
            label: 'Sign out',
            onSelect: () => void api.signOut().then(() => window.location.assign('/')),
            ...(online ? {} : { disabled: true, note: 'Not while Sift is unreachable.' }),
          },
        ],
      }
    : undefined;

  return (
    <OpenMessagesContext value={openMessages}>
      <div className="md:flex">
        <Rail current={section ?? ''} items={items} aside={status(true)} account={account} />
        <div className="mx-auto flex min-h-svh w-full max-w-7xl min-w-0 flex-col px-4 md:px-6 md:pt-6">
          <LoadingBar on={going || fetching > 0} />
          <Masthead
            current={section ?? ''}
            items={items}
            aside={status(false)}
            detail={usage.data ? <UsageDetail usage={usage.data} plan={plan} /> : null}
            account={account}
          />
          {notice ? <div className="flex flex-wrap gap-x-4 gap-y-1 pb-5">{notice}</div> : null}
          <main className="pb-16">{children}</main>
          <PageFoot />
        </div>
        {open ? (
          <MessagePanel
            key={opened}
            items={open.items}
            index={open.index}
            onIndex={(index) => show(open.items[index])}
            onClosing={() => (closing.current = true)}
            // Opened from a list here, the entry before this one is that list: go back to it, so Back and Close agree.
            onClose={() => {
              closing.current = false;
              if (panelEntry()) window.history.back();
              else show(undefined);
            }}
          />
        ) : null}
      </div>
    </OpenMessagesContext>
  );
}
