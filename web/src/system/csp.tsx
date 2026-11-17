import { CSPProvider } from '@base-ui/react/csp-provider';
import type { ReactNode } from 'react';

/** The dashboard's content security policy forbids inline <style>; index.css carries the one rule Base UI would inject. */
export function NoInlineStyles({ children }: { children: ReactNode }) {
  return <CSPProvider disableStyleElements>{children}</CSPProvider>;
}
