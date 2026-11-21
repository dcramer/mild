'use client';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { api, useLoaded } from '@/lib/api.ts';

/**
 * The terms, privacy policy and security page exist only on a Mild run as a service (`MILD_CLOUD`), which the page
 * learns from Mild. On someone's own copy they would speak to its owner, so their address goes to the dashboard.
 */
export function ServiceOnly({ children }: { children: ReactNode }) {
  const session = useLoaded('session', (signal) => api.session(signal), 300_000);
  const router = useRouter();
  const own = session.data !== null && !session.data.cloud;
  useEffect(() => {
    if (own) router.replace('/');
  }, [own, router]);
  return own ? null : children;
}
