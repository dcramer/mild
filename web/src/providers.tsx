'use client';
import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { queryClientFor } from '@/lib/api.ts';
import { useQueryFollowsScreens } from '@/lib/params.ts';
import { Toaster } from '@/system';
import { ShortcutList } from '@/system/keys-help.tsx';

/**
 * Installed, the app opens from what the service worker kept, even when Sift cannot be reached. Not while
 * developing, where the page must be the one just built: there, one left by `sift run` is removed.
 */
function useServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV === 'development')
      void navigator.serviceWorker.getRegistrations().then((all) => all.forEach((registration) => void registration.unregister()));
    else void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
}

/** What every page stands in: where loaded data is kept, toasts, the list of keys. */
export function Providers({ children }: { children: ReactNode }) {
  useServiceWorker();
  useQueryFollowsScreens();
  return (
    <QueryClientProvider client={queryClientFor()}>
      <Toaster>
        {children}
        <ShortcutList />
      </Toaster>
    </QueryClientProvider>
  );
}
