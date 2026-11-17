import { createContext, useContext } from 'react';
import { TextLink } from './type.tsx';

const LINKS = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/security', label: 'Security' },
];
const SOURCE = { href: 'https://github.com/dcramer/sift', label: 'Open source' };

/**
 * Whether this Sift is run as a service for other people (`SIFT_CLOUD`). Only then are there terms, a
 * privacy policy and a security page: on someone's own copy they would be addressed to themselves.
 */
export const Cloud = createContext(false);

/**
 * The terms, the privacy policy and the security page, wherever someone may look for them: as links in a
 * line, or as a `list`, one a row at the reading size, where they sit under bigger links (the phone menu).
 * `source` adds the code. Off `Cloud`, only the code.
 */
export function FinePrint({ source = false, list = false }: { source?: boolean; list?: boolean }) {
  const links = [...(useContext(Cloud) ? LINKS : []), ...(source ? [SOURCE] : [])];
  if (links.length === 0) return null;
  if (list)
    return (
      <ul className="flex flex-col text-muted-foreground">
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href} className="flex min-h-11 items-center hover:text-foreground">
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    );
  return (
    <>
      {links.map((link) => (
        <TextLink key={link.href} href={link.href}>
          {link.label}
        </TextLink>
      ))}
    </>
  );
}

/** The foot of every dashboard screen, under everything: `FinePrint` and the source. */
export function PageFoot() {
  return (
    <footer className="rule-above mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-5 pb-8 text-sm text-muted-foreground">
      <FinePrint source />
    </footer>
  );
}
