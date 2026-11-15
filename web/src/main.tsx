import { QueryClientProvider } from '@tanstack/react-query';
import { CSPProvider } from '@base-ui/react/csp-provider';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App.tsx';
import { queryClient } from './lib/api.ts';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');
createRoot(root).render(
  <StrictMode>
    {/* The dashboard's content security policy forbids inline <style>; index.css carries the one rule Base UI would inject. */}
    <CSPProvider disableStyleElements>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </CSPProvider>
  </StrictMode>,
);
