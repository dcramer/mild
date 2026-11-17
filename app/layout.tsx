import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import '@/index.css';
import { Client } from '@/client.tsx';

export const metadata: Metadata = {
  title: 'Sift',
  manifest: '/manifest.webmanifest',
  icons: { icon: { url: '/icons/icon.svg', type: 'image/svg+xml' }, apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, colorScheme: 'dark', themeColor: '#111110' };

/** The page's frame. The dashboard in it runs in the browser and gets everything from the API. */
export default async function Layout({ children }: { children: ReactNode }) {
  // Next's scripts carry the nonce proxy.ts puts in each request's policy, so the page is made per request.
  await connection();
  return (
    <html lang="en" className="dark">
      <body>
        <Client />
        {children}
      </body>
    </html>
  );
}
