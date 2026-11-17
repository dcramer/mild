import { Blank, Copyable, Failure, Splash, Sub, TextLink } from '@/system';

const GUIDE = 'https://github.com/dcramer/sift/blob/main/docs/vercel.md';

/** In place of everything while Sift cannot say who is signed in: what it still needs, what went wrong, or that it is on its way. */
export function Boot({ missing, error, online }: { missing: string[] | null; error: string | null; online: boolean }) {
  if (missing)
    return (
      <Splash title="Not set up yet.">
        <div className="flex max-w-[36rem] flex-col gap-3">
          <p>Add {missing.length === 1 ? 'this' : `these ${missing.length}`} under the project's Environment Variables, for Production, then redeploy.</p>
          {missing.map((name) => (
            <Copyable key={name} value={name} label={name} />
          ))}
          <Sub>
            <TextLink href={GUIDE}>What each one is</TextLink>
          </Sub>
        </div>
      </Splash>
    );
  if (error)
    return (
      <Splash title="Something went wrong.">
        <Failure className="max-w-[36rem]">{error}</Failure>
      </Splash>
    );
  if (!online)
    return (
      <Splash title="Can't reach Sift.">
        <p className="text-muted-foreground">This page opens by itself when it can.</p>
      </Splash>
    );
  return (
    <div aria-busy="true" aria-label="Loading">
      <Splash title={<Blank className="w-2/5" />}>{null}</Splash>
    </div>
  );
}
