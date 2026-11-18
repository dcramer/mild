import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { App } from './App.tsx';
import { queryClient } from './lib/api.ts';
import { Toaster } from './system/index.ts';
import { EmptyBefore, emptyIn } from './system/reserve.tsx';
import { NoInlineStyles } from './system/csp.tsx';
import { ShortcutList } from './system/keys-help.tsx';

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

export function Dashboard() {
  useServiceWorker();
  return (
    <StrictMode>
      <NoInlineStyles>
        <QueryClientProvider client={queryClient}>
          <EmptyBefore value={emptyIn(document.cookie)}>
            <Toaster>
              <App />
              <ShortcutList />
            </Toaster>
          </EmptyBefore>
        </QueryClientProvider>
      </NoInlineStyles>
    </StrictMode>
  );
}
