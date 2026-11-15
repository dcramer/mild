import { CSPProvider } from '@base-ui/react/csp-provider';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');
createRoot(root).render(
  <StrictMode>
    {/* The dashboard's content security policy forbids inline <style>; index.css carries the one rule Base UI would inject. */}
    <CSPProvider disableStyleElements>
      <App />
    </CSPProvider>
  </StrictMode>,
);
