'use client';
import dynamic from 'next/dynamic';

// Only in the browser: the dashboard reads the address and the clock as it starts, and draws some parts with
// inline styles, which the policy allows from script but not in the page's HTML.
const Dashboard = dynamic(() => import('./main.tsx').then((m) => m.Dashboard), { ssr: false });

export function Client() {
  return <Dashboard />;
}
