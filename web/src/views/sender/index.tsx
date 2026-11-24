'use client';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { SenderFacts } from '@/components/sender.tsx';
import type { ListedDecision } from '@/lib/api/endpoints.ts';
import { count } from '@/lib/format.ts';
import type { RuleStart } from '@/lib/rule-start.ts';
import { useParam } from '@/lib/params.ts';
import { RuleDialog } from '@/components/rule-dialog.tsx';
import { Empty, Loading, PageHeader, Section, Select, Blank } from '@/system';
import { useOpenMessages } from '@/lib/open-messages.ts';
import { useStarted } from '@/lib/started.ts';
import { reveal } from '@/lib/reveal.ts';
import { useManage, useWhoPage, useSenderUnder } from '@/lib/api/reads.ts';
import { Labels, Names, People } from './breakdown.tsx';
import { SenderHeader, ToContacts } from './header.tsx';
import { Mail, Volume } from './mail.tsx';
import { Standing } from './standing.tsx';
import { type Who, keyOf } from './who.ts';

/** One row per message, its latest decision, newest mail first: a message answered or decided again has several. */
function byMessage(rows: readonly ListedDecision[]): ListedDecision[] {
  const seen = new Set<string>();
  return rows.filter((row) => !seen.has(row.messageId) && seen.add(row.messageId)).toSorted((a, b) => b.receivedAt - a.receivedAt);
}

/** Mail no rule placed that Mild has not carried out and the reader has not answered. */
const isWaiting = (row: ListedDecision) => !row.byUser && !row.carryOut && row.outcome === null && row.stage !== 'rules';

/** Below this many messages a chart of them is a bar or two in an empty frame; the line above it says as much. */
const CHARTED = 5;

/**
 * A sender's or a domain's page, `/sender/<address>` or `/domain/<domain>`, from all of the person's mailboxes. The
 * server draws the same page for every one of them, so no address is in its HTML: the page reads it from the address bar.
 */
export function WhoView({ kind, shell }: { kind: 'sender' | 'domain'; shell: ReactNode }) {
  // The server drew this page once for every address, so the address is read only once the page has started.
  const path = usePathname();
  const [, , key] = (useStarted() ? path : '').split('/');
  if (!key) return shell;
  const value = decodeURIComponent(key);
  return <SenderView key={`${kind}/${value}`} who={kind === 'sender' ? { address: value } : { domain: value }} />;
}

/**
 * Everything about one sender, or one domain: what Mild will do with their next mail and why, the one
 * place to change that, how much they send and what it is, and their mail.
 */
function SenderView({ who }: { who: Who }) {
  const onOpen = useOpenMessages();
  const key = keyOf(who);
  const { data, error, loading, reload } = useWhoPage(who);
  // Every other rule this page starts opens the rule dialog on it, to see and change before adding.
  const [starting, setStarting] = useState<RuleStart | null>(null);
  const manage = useManage();
  const [now] = useState(() => Date.now());
  // Their mail under one name; the rest of the page is the whole address. A link names the name it was
  // pressed on, which only narrows the mail where there is a From to show it.
  const [named, setUnder] = useParam('name');
  const under = data && data.names.length > 1 ? named : '';
  const narrowed = useSenderUnder(who, under);
  if (error && !data) return 'domain' in who ? <Empty>{error}</Empty> : <ErrorNote message={error} />;
  if (loading || !data)
    return (
      <div className="flex flex-col gap-10">
        <ToContacts />
        <PageHeader title={key} meta={null} />
        <Loading />
      </div>
    );

  const { profile } = data;
  const several = data.names.length > 1;
  // One name would stand for all their mail; with several, the address is who they are.
  const title = several ? null : reveal(data.name);
  const mail = byMessage(data.decisions);
  const listed = under !== '' && narrowed.data ? byMessage(narrowed.data.decisions) : mail;
  const charted = profile.messages >= CHARTED;

  return (
    <div className="flex flex-col gap-10">
      <SenderHeader who={who} title={title} profile={profile} waiting={mail.filter(isWaiting)} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-16 gap-y-12 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-8">
          <Standing who={who} title={title} profile={profile} labels={manage.data?.labels ?? []} reload={reload} onStart={setStarting} />
          <SenderFacts profile={profile} page />
          {charted ? <Volume rows={mail} firstSeenAt={profile.firstSeenAt} now={now} /> : null}
        </div>

        <div className="flex min-w-0 flex-col gap-12">
          {data.senders.length > 0 ? (
            <Section title="People here" meta={count(data.senders.length)}>
              <People senders={data.senders} />
            </Section>
          ) : null}

          <Section
            title="Their mail"
            meta={count(listed.length)}
            action={
              several ? (
                <Select
                  label="From"
                  value={under}
                  options={[['', 'Every name'] as const, ...data.names.flatMap((n) => (n.name === null ? [] : [[reveal(n.name), reveal(n.name)] as const]))]}
                  onChange={setUnder}
                />
              ) : undefined
            }
          >
            {listed.length === 0 ? (
              <Empty>No mail recorded from them.</Empty>
            ) : (
              <Mail rows={listed} onOpen={onOpen} from={data.kind === 'domain' ? 'sender' : several && under === '' ? 'name' : null} />
            )}
          </Section>

          {several ? (
            <Section title="Names" meta={count(data.names.length)}>
              <Names data={data} onStart={setStarting} />
            </Section>
          ) : profile.labels.length > 1 ? (
            <Section title="What it is" meta={count(profile.labels.length)}>
              <Labels data={data} onStart={setStarting} />
            </Section>
          ) : null}
        </div>
      </div>

      {starting ? <RuleDialog labels={manage.data?.labels ?? []} start={starting} onClose={() => setStarting(null)} onAdded={reload} /> : null}
    </div>
  );
}

/** A sender's or a domain's page until its address is read and its data comes. */
export function WhoLoading() {
  return (
    <div className="flex flex-col gap-10">
      <PageHeader title={<Blank className="w-2/5" />} meta={null} />
      <Loading />
    </div>
  );
}
