import { ErrorNote } from '@/components/bits.tsx';
import { DecisionTable } from '@/components/decision-table.tsx';
import { SenderFacts, SenderLink, StandingStamp } from '@/components/sender.tsx';
import { api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, count, percent } from '@/lib/format.ts';
import { ChoiceGroup, Empty, Figure, Figures, Loading, PageHeader, Section, Sub, Table, Td, Th, Tr } from '@/system';
import type { OpenMessages } from '@/views/message-panel.tsx';

const GIVE = [
  ['trusted', 'Trust'],
  ['unwanted', 'Unwanted'],
  ['blocked', 'Block'],
] as const;
const FOLLOWS = {
  trusted: 'Their mail always stays in your inbox.',
  unwanted: 'Their mail is archived without being read by a model.',
  blocked: 'Their mail is marked as spam.',
} as const;
type Given = (typeof GIVE)[number][0];

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
  const given: Given | null = profile.standing === 'trusted' || profile.standing === 'unwanted' || profile.standing === 'blocked' ? profile.standing : null;
  const top = profile.labels[0];
  const labelled = profile.labels.reduce((sum, l) => sum + l.messages, 0);
  const answered = profile.answers.right + profile.answers.wrong;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title={data.name ?? key}
        badge={<StandingStamp standing={profile.standing} />}
        meta={data.name ? key : data.kind === 'domain' ? 'Everyone writing from this domain' : null}
      />

      <Figures>
        <Figure label="Last 30 days" value={count(profile.recent)} note={profile.lastSeenAt ? `latest ${ago(profile.lastSeenAt)}` : null} />
        {top ? <Figure label="Mostly" value={top.name} note={labelled > 0 ? `${percent(top.messages, labelled)} of their mail` : null} /> : null}
        {answered > 0 ? <Figure label="sift was right" value={percent(profile.answers.right, answered)} note={`of ${count(answered)} you checked`} /> : null}
        {data.waiting > 0 ? <Figure label="Waiting on you" value={count(data.waiting)} tone="look" /> : null}
      </Figures>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-10 lg:grid-cols-2">
        <Section title="What sift knows">
          <SenderFacts accountId={accountId} profile={profile} />
        </Section>
        <Section title="Your say">
          <ChoiceGroup
            label={`Where ${data.name ?? key} stands`}
            value={given}
            options={GIVE}
            clearable
            disabled={give.busy}
            onChange={(standing) => give.run(() => api.setStanding(accountId, who, standing ?? 'none'), reload)}
          />
          <p className="text-muted-foreground">
            {given ? `${FOLLOWS[given]} Press it again to take it back.` : 'None given: sift judges each message as it comes.'}
          </p>
          {give.error ? <p className="text-destructive">{give.error}</p> : null}
        </Section>
      </div>

      {data.senders.length > 0 ? (
        <Section title="Who writes from here" meta={count(data.senders.length)}>
          <Table>
            <thead>
              <Tr>
                <Th>Sender</Th>
                <Th>Standing</Th>
                <Th num>Messages</Th>
                <Th phone="hide" num>
                  Latest
                </Th>
              </Tr>
            </thead>
            <tbody>
              {data.senders.map((sender) => (
                <Tr key={sender.address}>
                  <Td className="max-w-0 md:w-1/2">
                    <SenderLink accountId={accountId} address={sender.address} className="font-medium">
                      {sender.name ?? sender.address}
                    </SenderLink>
                    {sender.name ? <Sub>{sender.address}</Sub> : null}
                  </Td>
                  <Td>
                    <StandingStamp standing={sender.standing} />
                  </Td>
                  <Td num>{count(sender.messages)}</Td>
                  <Td phone="hide" num quiet>
                    {ago(sender.lastSeenAt)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>
      ) : null}

      <Section title="Their mail" meta={count(profile.messages)}>
        {data.decisions.length === 0 ? (
          <Empty>No mail recorded from them.</Empty>
        ) : (
          <DecisionTable rows={data.decisions} onOpen={onOpen} oneSender={data.kind === 'sender'} />
        )}
      </Section>
    </div>
  );
}
