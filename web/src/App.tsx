import { Component, type ReactNode, Suspense, useEffect, useState } from 'react';
import { api, useLoaded, useOnline } from '@/lib/api.ts';
import { ago } from '@/lib/format.ts';
import { navigate, setParams, useParam, useRoute } from '@/lib/route.ts';
import { lazyView } from '@/lib/lazy.tsx';
import { Loading, Masthead, Note, Notice, PageHeader, Wordmark } from '@/system';
import type { MessageRef } from '@/views/message-panel.tsx';
import { SuggestionsView } from '@/views/suggestions.tsx';
import { ModelWall } from '@/components/model-wall.tsx';

// The home page comes with the app. Every other screen is its own file, fetched when first needed and,
// once the page is idle, ahead of need, so that going to one does not wait on the network.
const ActivityView = lazyView(() => import('@/views/activity.tsx').then((m) => m.ActivityView));
const LabelsView = lazyView(() => import('@/views/labels.tsx').then((m) => m.LabelsView));
const Rules = lazyView(() => import('@/views/rules.tsx').then((m) => m.Rules));
const SettingsPanel = lazyView(() => import('@/views/settings.tsx').then((m) => m.SettingsPanel));
const SenderView = lazyView(() => import('@/views/sender.tsx').then((m) => m.SenderView));
const MessagePanel = lazyView(() => import('@/views/message-panel.tsx').then((m) => m.MessagePanel));
const SignInScreen = lazyView(() => import('@/views/sign-in.tsx').then((m) => m.SignInScreen));
// The specimen page is the largest screen and no part of using sift, so it is never fetched ahead.
const SystemView = lazyView(() => import('@/views/system.tsx').then((m) => m.SystemView));
const PrivacyView = lazyView(() => import('@/views/legal.tsx').then((m) => m.PrivacyView));
const TermsView = lazyView(() => import('@/views/legal.tsx').then((m) => m.TermsView));

const SCREENS: Record<string, { preload: () => Promise<unknown> }> = {
  activity: ActivityView,
  labels: LabelsView,
  rules: Rules,
  sender: SenderView,
  domain: SenderView,
  system: SystemView,
  privacy: PrivacyView,
  terms: TermsView,
};
// The screen the address asks for starts loading with the app, not after its first render.
void SCREENS[window.location.pathname.split('/')[1] ?? '']?.preload().catch(() => {});
if (new URLSearchParams(window.location.search).has('message')) void MessagePanel.preload().catch(() => {});

/** Fetch the rest once the first screen is up and the browser has nothing better to do. */
function useScreensAhead() {
  useEffect(() => {
    const ahead = () => {
      for (const screen of [ActivityView, LabelsView, Rules, SettingsPanel, SenderView, MessagePanel]) void screen.preload().catch(() => {});
    };
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(ahead, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(ahead, 1500);
    return () => clearTimeout(timer);
  }, []);
}

/** What a screen shows while its code is on its way: its own header and the rows it will fill, so nothing moves when it arrives. */
function ScreenLoading({ title }: { title: string }) {
  return (
    <section className="flex flex-col gap-6">
      <PageHeader title={title} meta={null} />
      <Loading rows={6} />
    </section>
  );
}

/** A screen whose code could not be fetched says so in place, and the rest of the page keeps working. */
class ScreenBoundary extends Component<{ at: string; children: ReactNode }, { failedAt: string | null }> {
  override state: { failedAt: string | null } = { failedAt: null };
  static getDerivedStateFromError() {
    return { failedAt: '' };
  }
  override componentDidCatch() {
    this.setState({ failedAt: this.props.at });
  }
  override render() {
    // Going somewhere else tries again.
    if (this.state.failedAt !== null && (this.state.failedAt === '' || this.state.failedAt === this.props.at))
      return (
        <Note tone="failure" title="This screen could not be loaded">
          <p>sift may be unreachable, or it was updated while this page was open. Reload the page.</p>
        </Note>
      );
    return this.props.children;
  }
}

const SECTIONS = ['suggestions', 'activity', 'labels', 'rules'] as const;
const NAMES: Record<(typeof SECTIONS)[number], string> = {
  suggestions: 'Suggestions',
  activity: 'Activity',
  labels: 'Labels',
  rules: 'Rules',
};
/** Sections that were folded into others, so links to them still land somewhere. Settings was a page; it is a panel over any. */
const MOVED: Record<string, string> = {
  overview: '/suggestions',
  decisions: '/activity',
  changes: '/activity',
  settings: '/suggestions?settings=1',
  'settings/running': '/suggestions?settings=1',
};

/** Settings opens over whatever is showing, the model wall included, so nothing has to be finished to reach it. */
const openSettings = () => setParams({ settings: '1' }, { state: { panel: true } });
const closeSettings = () => ((window.history.state as { panel?: boolean } | null)?.panel ? window.history.back() : setParams({ settings: '' }));

/** Shows the sign-in screen until the viewer is signed in, then the dashboard. */
export function App() {
  const route = useRoute();
  // These are open to anyone and hold no data, so they are rendered outside the gate and ask the API for nothing, not even who is signed in.
  // Google reads the privacy policy and the terms before it lets anyone outside a test list sign in.
  const Open = route[0] === 'system' ? SystemView : route[0] === 'privacy' ? PrivacyView : route[0] === 'terms' ? TermsView : null;
  if (Open)
    return (
      <Suspense fallback={null}>
        <Open />
      </Suspense>
    );
  return <Gate route={route} />;
}

function Gate({ route }: { route: string[] }) {
  const moved = MOVED[route.join('/')] ?? MOVED[route[0] ?? ''];
  useEffect(() => {
    if (moved) navigate(moved.includes('?') ? moved : moved + window.location.search, { replace: true });
  }, [moved]);
  const [settings] = useParam('settings');
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
    return (
      <Suspense fallback={null}>
        <SignInScreen session={session.data} error={new URLSearchParams(window.location.search).get('signin')} />
      </Suspense>
    );
  }
  return (
    <>
      <ModelWall signedInAs={session.data.email} onSettings={openSettings}>
        <Dashboard signedInAs={session.data.email} route={route} />
      </ModelWall>
      {settings === '1' ? (
        <Suspense fallback={null}>
          <SettingsPanel onClose={closeSettings} />
        </Suspense>
      ) : null}
    </>
  );
}

function Dashboard({ signedInAs, route }: { signedInAs: string | null; route: string[] }) {
  useScreensAhead();
  const section = SECTIONS.find((s) => s === route[0]) ?? 'suggestions';
  // A sender's or a domain's own page: `/sender/<account>/<address>`.
  const profile =
    (route[0] === 'sender' || route[0] === 'domain') && route[1] && route[2]
      ? { kind: route[0], accountId: decodeURIComponent(route[1]), key: decodeURIComponent(route[2]) }
      : null;
  // The message panel. Which message is open is in the address, so it can be linked to and Back closes
  // it; the list it was opened from, for previous and next, is only known when it was opened from one here.
  const [list, setList] = useState<MessageRef[]>([]);
  const [messageId] = useParam('message');
  const [accountId] = useParam('account');
  const listed = list.findIndex((item) => item.messageId === messageId && item.accountId === accountId);
  const open = messageId === '' ? null : listed === -1 ? { items: [{ accountId, messageId, subject: '' }], index: 0 } : { items: list, index: listed };
  const show = (item: MessageRef | undefined, push?: { state: unknown }) => setParams({ message: item?.messageId ?? '', account: item?.accountId ?? '' }, push);
  const online = useOnline();
  const waiting = useLoaded('suggestions-false', (signal) => api.suggestions(false, '', signal));
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  const expired = manage.data?.activity.expired ?? [];
  const openMessages = (items: MessageRef[], index: number) => {
    setList(items);
    show(items[index], { state: { panel: true } });
  };
  const accounts = manage.data?.accounts ?? [];
  const synced = accounts.map((a) => a.lastSyncedAt).filter((at) => at !== null);

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-7xl flex-col px-4 md:px-6">
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
          manage.data ? (
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
                  { label: 'Settings', onSelect: openSettings },
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

      <main className="pb-16">
        <ScreenBoundary at={route.join('/')}>
          <Suspense fallback={<ScreenLoading title={profile ? profile.key : NAMES[section]} />}>
            {profile ? (
              <SenderView
                accountId={profile.accountId}
                who={profile.kind === 'sender' ? { address: profile.key } : { domain: profile.key }}
                onOpen={openMessages}
              />
            ) : section === 'suggestions' ? (
              <SuggestionsView onOpen={openMessages} />
            ) : section === 'activity' ? (
              <ActivityView onOpen={openMessages} />
            ) : section === 'labels' ? (
              <LabelsView />
            ) : (
              <Rules />
            )}
          </Suspense>
        </ScreenBoundary>
      </main>
      {open ? (
        // The panel lies over the page, so nothing moves while its code arrives.
        <Suspense fallback={null}>
          <MessagePanel
            items={open.items}
            index={open.index}
            onIndex={(index) => show(open.items[index])}
            // Opened from a list here, the entry before this one is that list: go back to it, so Back and Close agree.
            onClose={() => ((window.history.state as { panel?: boolean } | null)?.panel ? window.history.back() : show(undefined))}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
