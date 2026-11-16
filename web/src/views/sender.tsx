import { ErrorNote, Sub } from '@/components/bits.tsx';
import { DecisionTable } from '@/components/decision-table.tsx';
import { SenderFacts } from '@/components/message-parts.tsx';
import { SenderLink, StandingStamp, domainHref } from '@/components/sender.tsx';
import { api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, count, percent, shortDate } from '@/lib/format.ts';
import { Button, Empty, Figure, Figures, Loading, Table, Td, Th, Tr } from '@/system';
import type { OpenMessages } from '@/views/message-panel.tsx';

const GIVE = [
  ['trusted', 'Trust', 'Their mail always stays in your inbox.'],
  ['unwanted', 'Unwanted', 'Their mail is archived without being read by a model.'],
  ['blocked', 'Block', 'Their mail is marked as spam.'],
] as const;

/**
 * Everything about one sender, or one domain: where they stand and why, what they send, what sift does
 * with it, and the one place to change that.
 */
export function SenderView({ accountId, who, onOpen }: { accountId: string; who: { address: string } | { domain: string }; onOpen: OpenMessages }) {
  const key = 'address' in who ? who.address : who.domain;
  const { data, error, loading, reload } = useLoaded(`${'address' in who ? 'sender' : 'domain'}-page-${accountId}-${key}`, (signal) =>
    'address' in who ? api.sender(accountId, who.address, signal) : api.domain(accountId, who.domain, signal),
  );
  const give = useAction();
  if (error && !data)
    return 'domain' in who ? <Empty>Anyone can get an address at {who.domain}, so it has no standing of its own.</Empty> : <ErrorNote message={error} />;
  if (loading || !data) return <Loading rows={6} />;

  const { profile } = data;
  const given = profile.standing === 'trusted' || profile.standing === 'unwanted' || profile.standing === 'blocked' ? profile.standing : null;
  const top = profile.labels[0];
  const labelled = profile.labels.reduce((sum, l) => sum + l.messages, 0);
  const answered = profile.answers.right + profile.answers.wrong;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="statement break-all">{data.name ?? key}</h1>
          <StandingStamp standing={profile.standing} />
        </div>
        <p className="text-muted-foreground">
          {data.name ? `${key} · ` : ''}
          {profile.why}
          {profile.domain ? (
            <>
              {' · '}
              <a className="underline-offset-4 hover:underline" href={domainHref(accountId, profile.domain.name)}>
                {profile.domain.name}
              </a>{' '}
              is {profile.domain.standing}
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {GIVE.map(([standing, label]) => (
            <Button
              key={standing}
              variant={given === standing ? 'ink' : 'plain'}
              aria-pressed={given === standing}
              disabled={give.busy}
              onClick={() => give.run(() => api.setStanding(accountId, who, given === standing ? 'none' : standing), reload)}
            >
              {label}
            </Button>
          ))}
          <span className="ml-2 text-sm text-muted-foreground">
            {given ? `${GIVE.find(([s]) => s === given)?.[2]} Press again to take it back.` : 'sift judges each message as it comes.'}
          </span>
        </div>
        {give.error ? <p className="text-sm text-destructive">{give.error}</p> : null}
      </header>

      <Figures>
        <Figure label="Messages" value={count(profile.messages)} note={profile.firstSeenAt ? `since ${shortDate(profile.firstSeenAt)}` : null} />
        <Figure label="Last 30 days" value={count(profile.recent)} note={profile.lastSeenAt ? `latest ${ago(profile.lastSeenAt)}` : null} />
        {top ? <Figure label="Mostly" value={top.name} note={labelled > 0 ? `${percent(top.messages, labelled)} of what was labelled` : null} /> : null}
        {answered > 0 ? <Figure label="sift was right" value={percent(profile.answers.right, answered)} note={`of ${count(answered)} you checked`} /> : null}
        {data.waiting > 0 ? <Figure label="Waiting on you" value={count(data.waiting)} tone="look" /> : null}
      </Figures>

      <section className="flex flex-col gap-2">
        <h2 className="slug text-muted-foreground">What sift knows</h2>
        <SenderFacts sender={profile} />
      </section>

      {data.senders.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="slug text-muted-foreground">Who writes from here</h2>
          <Table>
            <thead>
              <Tr>
                <Th>Sender</Th>
                <Th>Standing</Th>
                <Th num>Messages</Th>
                <Th className="text-right">Latest</Th>
              </Tr>
            </thead>
            <tbody>
              {data.senders.map((sender) => (
                <Tr key={sender.address}>
                  <Td>
                    <SenderLink accountId={accountId} address={sender.address} className="font-medium">
                      {sender.name ?? sender.address}
                    </SenderLink>
                    {sender.name ? <Sub>{sender.address}</Sub> : null}
                  </Td>
                  <Td>
                    <StandingStamp standing={sender.standing} />
                  </Td>
                  <Td num>{count(sender.messages)}</Td>
                  <Td quiet className="text-right whitespace-nowrap">
                    {ago(sender.lastSeenAt)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="slug text-muted-foreground">Their mail</h2>
        {data.decisions.length === 0 ? (
          <Empty>No mail recorded from them.</Empty>
        ) : (
          <DecisionTable rows={data.decisions} onOpen={onOpen} oneSender={data.kind === 'sender'} />
        )}
      </section>
    </div>
  );
}
