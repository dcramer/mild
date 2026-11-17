import { type ReactNode, useState } from 'react';
import { ErrorNote, StatusWord, Verdict } from '@/components/bits.tsx';
import { ContactHint, SenderCell } from '@/components/sender.tsx';
import { type ListedDecision, type SenderPage, api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, count, dateTime, describeMatch, longDay, outcomeName, percent, shortDay } from '@/lib/format.ts';
import { type RuleStart, messageStart, standingStart } from '@/lib/rule-start.ts';
import { AddRuleDialog } from '@/views/rule-dialog.tsx';
import {
  Button,
  ChoiceGroup,
  Empty,
  Failure,
  Loading,
  OnPhone,
  PageHeader,
  RowActions,
  Section,
  Share,
  StackedBars,
  Table,
  Td,
  TextLink,
  Th,
  Tr,
} from '@/system';
import type { OpenMessages } from '@/views/message-panel.tsx';

const GIVE = [
  ['trusted', 'Trust'],
  ['unwanted', 'Unwanted'],
  ['blocked', 'Block'],
] as const;

type Who = { address: string } | { domain: string };
type Rule = SenderPage['profile']['rules'][number];

/** One row per message, its latest decision, newest mail first: a message answered or decided again has several. */
function byMessage(rows: readonly ListedDecision[]): ListedDecision[] {
  const seen = new Set<string>();
  return rows.filter((row) => !seen.has(row.messageId) && seen.add(row.messageId)).toSorted((a, b) => b.receivedAt - a.receivedAt);
}

/** Mail no rule placed that Sift has not carried out and the reader has not answered. */
const isWaiting = (row: ListedDecision) => !row.byUser && !row.carryOut && row.outcome === null && row.stage !== 'rules';

/** A rule for all their mail, not some of it (under one name, say). */
const forAll = (rule: Rule) => Object.keys(rule.match).length === 1;

const forExactly = (data: SenderPage, rule: Rule) =>
  forAll(rule) && (data.kind === 'sender' ? rule.match['from'] === data.profile.address : rule.match['fromDomain'] === data.profile.address);

/** The rule that decides their next message: one for exactly them wins over one for their domain. */
const decidingRule = (data: SenderPage): Rule | null => data.profile.rules.find((r) => forExactly(data, r)) ?? data.profile.rules.find(forAll) ?? null;

const ruleHref = (id: string) => `/rules?rule=${encodeURIComponent(id)}`;

const ruleWords = (rule: Rule) =>
  `Mail ${describeMatch(rule.match)}${
    rule.kind === 'action'
      ? `: ${rule.disposition ? outcomeName(rule.disposition) : 'nothing'}`
      : `${rule.kind === 'when-label' ? ', when it is ' : ' is '}${rule.labelName ?? ''}`
  }`;

/** What happens to their next message, and what says so: a rule, or the model, with how often it has been right. */
function NextMail({ data, rule, more }: { data: SenderPage; rule: Rule | null; more: ReactNode }) {
  const last = data.decisions.find((d) => !d.byUser);
  const decides = rule !== null && rule.kind !== 'when-label';
  const { right, wrong } = data.profile.answers;
  const others = data.profile.rules.filter((r) => r !== rule);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="slug text-muted-foreground">Their next mail</p>
      <p className="heading">
        {decides ? (
          <Verdict labelName={rule.labelName} disposition={rule.disposition ?? 'keep'} />
        ) : last ? (
          <Verdict labelName={last.labelName} disposition={last.disposition} />
        ) : (
          <Verdict labelName={null} disposition="review" />
        )}
      </p>
      <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
        {rule ? (
          <li>
            <TextLink href={ruleHref(rule.id)}>{ruleWords(rule)}</TextLink>
          </li>
        ) : null}
        {decides ? null : (
          <li>
            {rule ? 'Otherwise the model decides each one' : 'The model decides each one'}
            {right + wrong > 0 ? `; right ${count(right)} of ${count(right + wrong)} times you checked` : ''}
          </li>
        )}
        {others.map((r) => (
          <li key={r.id}>
            <TextLink href={ruleHref(r.id)}>{ruleWords(r)}</TextLink>
          </li>
        ))}
        {more ? <li>{more}</li> : null}
      </ul>
    </div>
  );
}

const DAY = 24 * 3_600_000;
const WEEK = 7 * DAY;

/** Below this many messages a chart of them is a bar or two in an empty frame; the line above it says as much. */
const CHARTED = 5;

/** Their mail over time: twelve weeks, or two weeks by day for someone new. */
function Volume({ rows, firstSeenAt, now }: { rows: ListedDecision[]; firstSeenAt: number | null; now: number }) {
  const daily = firstSeenAt !== null && now - firstSeenAt < 3 * WEEK;
  const step = daily ? DAY : WEEK;
  const length = daily ? 14 : 12;
  const start = now - length * step;
  const columns = Array.from({ length }, (_, i) => {
    const day = new Date(start + (i + 1) * step - DAY).toISOString().slice(0, 10);
    const values: Record<string, number> = {};
    return { key: day, label: shortDay(day), title: daily ? longDay(day) : `Week to ${shortDay(day)}`, values };
  });
  for (const row of rows) {
    const column = columns[Math.floor((row.receivedAt - start) / step)];
    if (column) column.values['mail'] = (column.values['mail'] ?? 0) + 1;
  }
  return <StackedBars series={[{ key: 'mail', name: 'Messages', color: 'var(--handled-changed)' }]} rows={columns} compact />;
}

/** What their mail is, label by label, each with a rule to start on it. */
function Labels({ data, onStart }: { data: SenderPage; onStart: (s: RuleStart) => void }) {
  const whole = data.profile.labels.reduce((sum, l) => sum + l.messages, 0);
  return (
    <Table>
      <thead className="sr-only">
        <Tr>
          <Th>Label</Th>
          <Th phone="hide">Share</Th>
          <Th num>Messages</Th>
          <Th>Rule</Th>
        </Tr>
      </thead>
      <tbody>
        {data.profile.labels.map((label) => (
          <Tr key={label.id}>
            <Td className="font-medium whitespace-nowrap">{label.name}</Td>
            <Td phone="hide" className="w-full">
              <Share part={label.messages} whole={whole} />
            </Td>
            <Td num className="whitespace-nowrap">
              {count(label.messages)} <span className="text-muted-foreground">· {percent(label.messages, whole)}</span>
            </Td>
            <RowActions>
              <Button variant="quiet" onClick={() => onStart(messageStart(data.profile.address, label.id))}>
                Make a rule…
              </Button>
            </RowActions>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Their mail, one row per message: what it is, what Sift said, where it got to, when it came. On a domain's page, who sent each first, as in every list of mail. */
function Mail({ rows, onOpen, oneSender }: { rows: ListedDecision[]; onOpen: OpenMessages; oneSender: boolean }) {
  const items = rows.map((r) => ({ accountId: r.accountId, messageId: r.messageId, subject: r.subject }));
  return (
    <Table>
      <thead>
        <Tr>
          {oneSender ? null : <Th>Sender</Th>}
          <Th {...(oneSender ? {} : { phone: 'hide' as const })}>Message</Th>
          <Th phone="hide">Sift said</Th>
          <Th phone="hide">Status</Th>
          <Th phone="hide" num>
            Received
          </Th>
        </Tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const subject = row.subject || '(no subject)';
          const onPhone = (
            <OnPhone>
              {oneSender ? null : <span className="w-full truncate text-base text-foreground">{subject}</span>}
              <Verdict labelName={row.labelName} disposition={row.disposition} />
              <span>{ago(row.receivedAt)}</span>
            </OnPhone>
          );
          return (
            <Tr key={row.id} onOpen={() => onOpen(items, index)}>
              {oneSender ? (
                <Td className="max-w-0 md:w-1/2">
                  <span className="block truncate font-medium">{subject}</span>
                  {onPhone}
                </Td>
              ) : (
                <>
                  <SenderCell accountId={row.accountId} address={row.fromAddress} name={row.fromName} contact={row.contact}>
                    {onPhone}
                  </SenderCell>
                  <Td phone="hide" className="max-w-0 md:w-full">
                    <span className="block truncate">{subject}</span>
                  </Td>
                </>
              )}
              <Td phone="hide" className="whitespace-nowrap">
                <Verdict labelName={row.labelName} disposition={row.disposition} />
              </Td>
              <Td phone="hide" className="whitespace-nowrap">
                <StatusWord row={row} />
              </Td>
              <Td phone="hide" num quiet title={dateTime(row.receivedAt)}>
                {ago(row.receivedAt)}
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}

/**
 * Everything about one sender, or one domain: what Sift will do with their next mail and why, the one
 * place to change that, how much they send and what it is, and their mail.
 */
export function SenderView({ accountId, who, onOpen }: { accountId: string; who: Who; onOpen: OpenMessages }) {
  const key = 'address' in who ? who.address : who.domain;
  const { data, error, loading, reload } = useLoaded(`${'address' in who ? 'sender' : 'domain'}-page-${accountId}-${key}`, (signal) =>
    'address' in who ? api.sender(accountId, who.address, signal) : api.domain(accountId, who.domain, signal),
  );
  const give = useAction();
  // Every rule this page starts opens the rule dialog on it, to see and change before adding.
  const [starting, setStarting] = useState<RuleStart | null>(null);
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  const [now] = useState(() => Date.now());
  if (error && !data)
    return 'domain' in who ? <Empty>Anyone can get an address at {who.domain}, so it has no standing of its own.</Empty> : <ErrorNote message={error} />;
  if (loading || !data)
    return (
      <div className="flex flex-col gap-10">
        <PageHeader title={key} meta={null} />
        <Loading />
      </div>
    );

  const { profile } = data;
  const mail = byMessage(data.decisions);
  const waiting = mail.filter(isWaiting);
  const items = waiting.map((r) => ({ accountId: r.accountId, messageId: r.messageId, subject: r.subject }));
  const rule = decidingRule(data);
  const [top] = profile.labels;
  // A standing is an action rule for exactly them; a label rule that happens to archive is not one.
  const given = rule?.kind === 'action' && forExactly(data, rule) ? profile.given : null;
  const charted = profile.messages >= CHARTED;
  const volume = (
    <span>
      {count(profile.recent)} in the last 30 days{profile.lastSeenAt ? `, latest ${ago(profile.lastSeenAt)}` : ''}
    </span>
  );

  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        title={data.name ?? key}
        badge={<ContactHint contact={profile.contact} />}
        meta={
          data.name || profile.domain ? (
            <>
              {data.name ? <span>{key}</span> : null}
              {profile.domain ? (
                <>
                  {data.name ? <span aria-hidden>·</span> : null}
                  <TextLink href={`/domain/${encodeURIComponent(accountId)}/${encodeURIComponent(profile.domain.name)}`}>{profile.domain.name}</TextLink>
                  <ContactHint contact={profile.domain.contact} />
                </>
              ) : null}
            </>
          ) : undefined
        }
        actions={
          waiting.length > 0 ? (
            <Button variant="mark" onClick={() => onOpen(items, 0)}>
              Answer {count(waiting.length)} waiting
            </Button>
          ) : undefined
        }
      />

      <div className={charted ? 'grid grid-cols-[minmax(0,1fr)] gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]' : ''}>
        <div className="flex flex-col gap-5">
          <NextMail data={data} rule={rule} more={charted ? null : volume} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <ChoiceGroup
              label={`Where ${data.name ?? key} stands`}
              value={given}
              options={GIVE}
              clearable
              disabled={give.busy}
              onChange={(standing) => (standing ? setStarting(standingStart(who, standing)) : give.run(() => api.clearStanding(accountId, who), reload))}
            />
            <Button variant="quiet" onClick={() => setStarting(messageStart(key, top?.id ?? null))}>
              Make a rule…
            </Button>
          </div>
          <Failure>{give.error}</Failure>
        </div>
        {charted ? (
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-sm text-muted-foreground">{volume}</p>
            <Volume rows={mail} firstSeenAt={profile.firstSeenAt} now={now} />
          </div>
        ) : null}
      </div>

      {profile.labels.length > 1 ? (
        <Section title="What it is" meta={count(profile.labels.length)}>
          <Labels data={data} onStart={setStarting} />
        </Section>
      ) : null}

      {data.senders.length > 0 ? (
        <Section title="Who writes from here" meta={count(data.senders.length)}>
          <Table>
            <thead>
              <Tr>
                <Th>Sender</Th>
                <Th num>Messages</Th>
                <Th phone="hide" num>
                  Latest
                </Th>
              </Tr>
            </thead>
            <tbody>
              {data.senders.map((sender) => (
                <Tr key={sender.address}>
                  <SenderCell accountId={accountId} address={sender.address} name={sender.name} contact={sender.contact} />
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

      <Section title="Their mail" meta={count(mail.length)}>
        {mail.length === 0 ? <Empty>No mail recorded from them.</Empty> : <Mail rows={mail} onOpen={onOpen} oneSender={data.kind === 'sender'} />}
      </Section>

      {starting ? (
        <AddRuleDialog
          accountId={accountId}
          labels={manage.data?.labels[accountId] ?? []}
          start={starting}
          onClose={() => setStarting(null)}
          onAdded={reload}
        />
      ) : null}
    </div>
  );
}
