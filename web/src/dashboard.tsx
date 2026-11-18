'use client';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { SetUp } from '@/components/set-up.tsx';
import { SiftStatus, UsageDetail } from '@/components/status.tsx';
import { MayLoad, api, useLoaded, useOnline } from '@/lib/api.ts';
import { keepSignedIn, leave, signedInBefore } from '@/lib/before-paint.ts';
import { OpenMessagesContext } from '@/lib/open-messages.ts';
import { panelEntry, setParams, useParam } from '@/lib/params.ts';
import { subscription } from '@/lib/prices.ts';
import { Cloud, Masthead, Notice, PageFoot } from '@/system';
import { useStarted } from '@/system/started.ts';
import { Boot } from '@/views/boot.tsx';
import type { MessageRef } from '@/views/message-panel.tsx';

// What opens over a screen, and the sign-in screen, are fetched when first needed and, once the page is idle, ahead of need.
const loadSettings = () => import('@/views/settings.tsx');
const loadMessage = () => import('@/views/message-panel.tsx');
const loadRule = () => import('@/views/rule-panel.tsx');
const SettingsPanel = dynamic(() => loadSettings().then((m) => m.SettingsPanel), { ssr: false });
const MessagePanel = dynamic(() => loadMessage().then((m) => m.MessagePanel), { ssr: false });
const RuleSheet = dynamic(() => loadRule().then((m) => m.RuleSheet), { ssr: false });
const SignInScreen = dynamic(() => import('@/views/sign-in.tsx').then((m) => m.SignInScreen), { ssr: false });

function usePanelsAhead() {
  useEffect(() => {
    const ahead = () => {
      for (const load of [loadSettings, loadMessage, loadRule]) void load().catch(() => {});
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
  { to: '', label: 'For review' },
  { to: 'activity', label: 'Activity' },
  { to: 'labels', label: 'Labels' },
  { to: 'rules', label: 'Rules' },
] as const;

/** Settings opens over whatever is showing, setting up included, so nothing has to be finished to reach it. */
const openSettings = () => setParams({ settings: '1' }, { state: { panel: true } });
// A failed sign-in said in Settings (`signin`) goes with it.
const closeSettings = () => (panelEntry() ? window.history.back() : setParams({ settings: '', signin: '' }));

/**
 * The dashboard around `children`, the screen the address names, once Sift says who is signed in: the sign-in screen
 * for nobody, the setting-up steps until there is something to show, and otherwise the masthead, the screen and its
 * foot. The server draws that last for everyone, since most who open it are signed in and set up. A browser where
 * someone was signed in last time shows it and loads the screen at once, alongside asking who is signed in; any other
 * keeps it hidden and asks for nothing more until Sift answers (`web/src/lib/before-paint.ts`).
 */
export function Dashboard({ children }: { children: ReactNode }) {
  const [settings] = useParam('settings');
  const [signin] = useParam('signin');
  const session = useLoaded('session', (signal) => api.session(signal), 300_000);
  const online = useOnline();
  const known = session.data;
  const nobody = known?.required === true && known.email === null;
  const before = useStarted() && signedInBefore();
  useEffect(() => {
    if (known) keepSignedIn(!nobody);
  }, [known, nobody]);
  // Nothing is kept between visits, so opened while Sift is unreachable there is only this to show.
  if (!known && (session.missing || session.error || !online)) return <Boot missing={session.missing} error={session.error} online={online} />;
  if (nobody)
    return (
      <Cloud value={known.cloud}>
        <SignInScreen session={known} error={signin || null} />
      </Cloud>
    );
  const signedInAs = known?.email ?? null;
  return (
    <Cloud value={known?.cloud ?? false}>
      <MayLoad value={known ? !nobody : before}>
        <SetUp signedInAs={signedInAs} onSettings={openSettings}>
          <Frame signedInAs={signedInAs}>{children}</Frame>
        </SetUp>
        {known && settings === '1' ? <SettingsPanel onClose={closeSettings} /> : null}
      </MayLoad>
    </Cloud>
  );
}

function Frame({ signedInAs, children }: { signedInAs: string | null; children: ReactNode }) {
  usePanelsAhead();
  const [, section] = usePathname().split('/');
  // The message panel. Which message is open is in the address, so it can be linked to and Back closes
  // it; the list it was opened from, for previous and next, is only known when it was opened from one here.
  const [list, setList] = useState<MessageRef[]>([]);
  const [messageId] = useParam('message');
  // A rule opened away from the Rules list, as when one has just been made; the list opens its own.
  const [ruleId] = useParam('rule');
  const [accountId] = useParam('account');
  const listed = list.findIndex((item) => item.messageId === messageId && item.accountId === accountId);
  const open = messageId === '' ? null : listed === -1 ? { items: [{ accountId, messageId, subject: '' }], index: 0 } : { items: list, index: listed };
  const show = (item: MessageRef | undefined, push?: { state: { panel: boolean } }) =>
    setParams({ message: item?.messageId ?? '', account: item?.accountId ?? '' }, push);
  const online = useOnline();
  const waiting = useLoaded('suggestions-false', (signal) => api.suggestions(false, '', signal));
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  const expired = manage.data?.activity.expired ?? [];
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

  return (
    <OpenMessagesContext value={openMessages}>
      <div data-frame className="mx-auto flex min-h-svh w-full max-w-7xl flex-col px-4 md:px-6">
        <Masthead
          current={section ?? ''}
          items={SECTIONS.map((s) => ({ ...s, ...(s.to === '' && waiting.data?.waiting ? { count: waiting.data.waiting } : {}) }))}
          status={
            !online ? (
              <Notice>Sift cannot be reached</Notice>
            ) : expired.length > 0 ? (
              // Signing in again is what renews sift's access; Google asks which account. Named when it is one that is not the viewer's own.
              <Notice tone="look" href="/auth/login" action="Reconnect">
                Google sign-in expired{expired.length > 1 ? ` for ${expired.length} accounts` : expired[0] === name ? '' : ` for ${expired[0]}`}
              </Notice>
            ) : null
          }
          aside={manage.data ? <SiftStatus accounts={accounts} usage={usage.data} plan={plan} /> : null}
          detail={usage.data ? <UsageDetail usage={usage.data} plan={plan} /> : null}
          account={
            name
              ? {
                  name,
                  items: [
                    { label: 'Settings', onSelect: openSettings },
                    {
                      label: 'Sign out',
                      onSelect: () => void api.signOut().then(() => leave('/')),
                      ...(online ? {} : { disabled: true, note: 'Not while Sift is unreachable.' }),
                    },
                  ],
                }
              : undefined
          }
        />

        <main className="pb-16">{children}</main>
        <PageFoot />
        {ruleId !== '' && section !== 'rules' ? <RuleSheet id={ruleId} onOpen={openMessages} onClose={() => setParams({ rule: '', apply: '' })} /> : null}
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
