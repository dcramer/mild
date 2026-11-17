import { TextLink } from './type.tsx';

/** The terms, the privacy policy and the security page, as links in a line: wherever someone may look for them. `source` adds the code. */
export function FinePrint({ source = false }: { source?: boolean }) {
  return (
    <>
      <TextLink href="/terms">Terms</TextLink>
      <TextLink href="/privacy">Privacy</TextLink>
      <TextLink href="/security">Security</TextLink>
      {source ? <TextLink href="https://github.com/dcramer/sift">Open source</TextLink> : null}
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
