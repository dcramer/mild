'use client';
import Link from 'next/link';
import type { ComponentProps, MouseEvent } from 'react';
import { goToQuery } from '@/lib/params.ts';

/** Paths Sift's server answers itself (the API, signing in); a link to one loads it. */
const SERVER = /^\/(api|auth)(\/|$)/;

/** A link to this page with another query (a name on its sender's page), which only narrows what it shows. */
const samePath = (href: string) => typeof window !== 'undefined' && href.startsWith(`${window.location.pathname}?`);

const plainPress = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * Every link a part draws. To a screen of the dashboard it is Next.js's `Link`, which goes there without loading the
 * page again. Nothing is fetched ahead: a screen is drawn for whoever asks, so each fetch is a call to the server
 * (docs/runtime.md, "What it costs"). A link that only changes the query (`?settings=1`) opens what it names over the
 * page, and Back closes it, without asking the server for anything. Anything else is a plain link. A press with a
 * modifier key, or on a link that opens a new tab, is the browser's.
 */
export function Anchor({ href, onClick, children, ...props }: ComponentProps<'a'> & { href: string }) {
  if (href.startsWith('?') || samePath(href))
    return (
      <a
        href={href}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented || !plainPress(event) || props.target) return;
          event.preventDefault();
          goToQuery(href.slice(href.indexOf('?') + 1), { state: null });
        }}
        {...props}
      >
        {children}
      </a>
    );
  if (href.startsWith('/') && !SERVER.test(href) && !props.target)
    return (
      <Link href={href} prefetch={false} {...(onClick ? { onClick } : {})} {...props}>
        {children}
      </Link>
    );
  return (
    <a href={href} {...(onClick ? { onClick } : {})} {...props}>
      {children}
    </a>
  );
}
