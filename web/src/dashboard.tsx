'use client';
import { type DehydratedState, HydrationBoundary, useIsFetching } from '@tanstack/react-query';
import { ActivityIcon, ContactRoundIcon, InboxIcon, ListChecksIcon, TagIcon, WorkflowIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { Activity, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SetUp } from '@/components/set-up.tsx';
import { SiftStatus, UsageDetail } from '@/components/status.tsx';
import { api, useLoaded, useOnline } from '@/lib/api.ts';
import { ComposeContext, closeComposer, openComposer } from '@/lib/compose.ts';
import { chooseMailbox, useChosenMailbox } from '@/lib/mailbox.ts';
import { Mailbox } from '@/lib/narrowed.ts';
import { type MessageRef, OpenMessagesContext } from '@/lib/open-messages.ts';
import { isMessageKey, panelEntry, setParams, useHere, useParam } from '@/lib/params.ts';
import { useHidden } from '@/lib/action.ts';
import { subscription } from '@/lib/prices.ts';
import { startTelemetry } from '@/lib/telemetry.ts';
import { Cloud, Loading, LoadingBar, Masthead, Notice, PageFoot, Rail, rowHolding, useGoing } from '@/system';
import { Boot } from '@/views/boot.tsx';
import { SignInScreen } from '@/views/sign-in.tsx';

// What opens over a screen, or in its place, is fetched when first needed and, once the page is idle, ahead of need.
const loadSettings = () => import('@/views/settings.tsx');
const loadReader = () => import('@/views/reader.tsx');
const loadComposer = () => import('@/views/composer.tsx');
// Opened together from the address (`?compose=new&settings=1`), each waits for both, so they open in the order they are
// drawn, the last on top, whichever arrived first.
const loadPanels = () => Promise.all([loadSettings(), loadComposer()]);
const SettingsPanel = dynamic(() => loadPanels().then(([m]) => m.SettingsPanel), { ssr: false });
const Composer = dynamic(() => loadPanels().then(([, m]) => m.Composer), { ssr: false });
const MessageReader = dynamic(() => loadReader().then((m) => m.MessageReader), { ssr: false, loading: () => <Loading rows={6} /> });

/** What the reader's Back says, by the section a list is in; a sender's or a domain's page by its address. */
const LISTS: Record<string, string> = { '': 'For review', inbox: 'Inbox', activity: 'Activity', rules: 'Rules', labels: 'Labels' };
const listName = (path: string) => {
  const [, section = '', item = ''] = path.split('/');
  return LISTS[section] ?? (decodeURIComponent(item) || 'Back');
};

function usePanelsAhead() {
  useEffect(() => {
    const ahead = () => {
      for (const load of [loadSettings, loadReader, loadComposer]) void load().catch(() => {});
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
  { to: 'inbox', label: 'Inbox', icon: InboxIcon },
  { to: 'contacts', label: 'Contacts', icon: ContactRoundIcon },
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
  const pathname = usePathname();
  const [, page] = pathname.split('/');
  // A sender's and a domain's page are a contact's.
  const section = page === 'sender' || page === 'domain' ? 'contacts' : page;
  // The reader, in the screen's place. Which message is open is in the address, so it can be linked to and Back
  // returns to the list; the list it was opened from, for previous and next, is only known when it was opened from one here.
  const [list, setList] = useState<MessageRef[]>([]);
  // The address names the message alone: the server finds which mailbox holds it.
  const [messageId] = useParam('message');
  // A conversation, opened on its newest message; the server finds which mailbox holds it, as it does a message.
  const [threadId] = useParam('thread');
  const [compose] = useParam('compose');
  const [to] = useParam('to');
  const listed = list.findIndex((item) => item.messageId === messageId);
  const open =
    messageId === ''
      ? null
      : listed === -1
        ? { items: [{ accountId: '', messageId, subject: null, ...(threadId ? { threadId } : {}) }], index: 0 }
        : { items: list, index: listed };
  const show = (item: MessageRef | undefined, push?: { state: { panel: boolean } }) =>
    setParams({ message: item?.messageId ?? '', thread: item?.threadId ?? '' }, push);
  const online = useOnline();
  // Drawn above the `Mailbox` it provides, so for all of them: whose mailboxes these are, and whose sign-in expired.
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  const mailboxes = (manage.data?.accounts ?? []).map((a) => a.email);
  const mailbox = useChosenMailbox(mailboxes);
  const inMailbox = useLoaded('manage', (signal) => api.manage(signal), 60_000, mailbox);
  const expired = manage.data?.activity.expired ?? [];
  const here = useHere();
  // Each opening is a reader of its own, with a history entry of its own, so Back returns to the list.
  const [opened, setOpened] = useState(0);
  // Where the list was, and the row of the message last shown, for Back to return to.
  const place = useRef<{ y: number; row: string | null }>({ y: 0, row: null });
  const openMessages = (items: MessageRef[], index: number) => {
    place.current = { y: window.scrollY, row: null };
    setList(items);
    setOpened((n) => n + 1);
    show(items[index], { state: { panel: true } });
  };
  const reading = open !== null;
  useLayoutEffect(() => {
    if (reading) return;
    const { y, row } = place.current;
    if (!row) return;
    place.current = { y: 0, row: null };
    window.scrollTo(0, y);
    const to = rowHolding(row);
    to?.focus({ preventScroll: true });
    to?.scrollIntoView({ block: 'nearest' });
  }, [reading]);
  const shown = useCallback((row: string) => {
    place.current.row = row;
  }, []);
  const accounts = manage.data?.accounts ?? [];
  // Who they are, not which mailbox they happened to sign in with.
  const name = accounts.find((a) => a.primary)?.email ?? signedInAs;
  const usage = useLoaded('usage', (signal) => api.usage(signal), 60_000);
  const plan = manage.data ? subscription(manage.data.model) : null;
  // An answer on its way has left the list, so it leaves the count with it until the count is read again.
  const waiting = Math.max(0, (inMailbox.data?.waiting ?? 0) - [...useHidden(inMailbox.at)].filter(isMessageKey).length);

  const going = useGoing();
  const fetching = useIsFetching(firstLoad);
  // Inbox is a section only while it is on.
  const items = SECTIONS.filter((s) => s.to !== 'inbox' || manage.data?.mail).map((s) => ({ ...s, ...(s.to === '' && waiting ? { count: waiting } : {}) }));
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
  const choice = { mailboxes, value: mailbox, onChange: chooseMailbox };
  // Writing mail is offered only with Inbox on.
  const composer = manage.data?.mail ? openComposer : null;
  // A reply and a forward are written in the reader.
  const writingNew = composer !== null && compose === 'new';

  return (
    <OpenMessagesContext value={openMessages}>
      <ComposeContext value={composer}>
        <Mailbox value={mailbox}>
          <div className="md:flex">
            <Rail
              current={section ?? ''}
              items={items}
              aside={status(true)}
              mailbox={choice}
              account={account}
              compose={composer ? () => composer() : undefined}
            />
            <div className="mx-auto flex min-h-svh w-full max-w-7xl min-w-0 flex-col px-4 md:px-6 md:pt-6">
              <LoadingBar on={going || fetching > 0} />
              <Masthead
                current={section ?? ''}
                items={items}
                aside={status(false)}
                detail={usage.data ? <UsageDetail usage={usage.data} plan={plan} /> : null}
                mailbox={choice}
                account={account}
              />
              {notice ? <div className="flex flex-wrap gap-x-4 gap-y-1 pb-5">{notice}</div> : null}
              <main className="pb-16">
                {/* Kept while the reader is open, as it was, and deaf: its keys and effects stop until it shows again. */}
                <Activity mode={open ? 'hidden' : 'visible'}>{children}</Activity>
                {open ? (
                  <MessageReader
                    key={opened}
                    items={open.items}
                    index={open.index}
                    back={listName(pathname)}
                    onIndex={(index) => show(open.items[index])}
                    onShown={shown}
                    // Opened from a list here, the entry before this one is that list: go back to it, so Back here and the browser's agree.
                    onBack={() => {
                      if (panelEntry()) window.history.back();
                      else show(undefined);
                    }}
                  />
                ) : null}
              </main>
              <PageFoot />
            </div>
            {writingNew ? <Composer key={to} to={to} onClose={closeComposer} /> : null}
          </div>
        </Mailbox>
      </ComposeContext>
    </OpenMessagesContext>
  );
}
