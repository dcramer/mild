import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App.tsx';
import { queryClient } from './lib/api.ts';
import { Toaster } from './system/index.ts';
import { NoInlineStyles } from './system/csp.tsx';
import { ShortcutList } from './system/keys-help.tsx';

// Installed, the app opens from files the service worker kept, even when sift cannot be reached. Not
// under `sift dev`, where the page must always be the latest build: there, one left by `sift run` is removed.
if ('serviceWorker' in navigator) {
  if (document.querySelector('script[src="/dev/reload.js"]')) {
    void navigator.serviceWorker.getRegistrations().then((all) => all.forEach((registration) => void registration.unregister()));
  } else {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');
createRoot(root).render(
  <StrictMode>
    <NoInlineStyles>
      <QueryClientProvider client={queryClient}>
        <Toaster>
          <App />
          <ShortcutList />
        </Toaster>
      </QueryClientProvider>
    </NoInlineStyles>
  </StrictMode>,
);
