'use client';
import { useState } from 'react';
import { ContactHint } from '@/components/sender.tsx';
import { Avatar, Button, Fact, Facts, HoverCard, Menu, Notice, Popover, Section, TextLink, Tooltip, useToast } from '@/system';

/** What a press did, and what opens from one: toasts, menus, popovers, notices and hover cards. */
export function Feedback() {
  const toast = useToast();
  const [view, setView] = useState('all');
  const answer = () =>
    toast('Archive as Marketing', {
      undo: () => toast('Back in the inbox'),
      action: { label: 'Same for 2 more', onPress: () => toast('Archive as Marketing: 2 more') },
    });
  return (
    <>
      <div className="grid gap-14 lg:grid-cols-2">
        <Section title="Toast" meta="what a press did, after the list moved on: one line, the newest replacing the last">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => toast('12 messages pulled in', { description: 'They show under For review as Mild decides them.' })}>A result</Button>
            <Button onClick={answer}>With Undo</Button>
            <Button
              onClick={() =>
                toast('Mail from notifications@code.example.com: send it to spam', {
                  kind: 'Rule added',
                  action: { label: 'Apply to inbox…', onPress: () => toast('Applied to 3 messages') },
                  undo: () => toast('Rule taken back'),
                })
              }
            >
              With a kind
            </Button>
            <Button onClick={() => toast('Could not undo', { tone: 'failure', description: 'Gmail answered 503.' })}>Failure</Button>
            <Button
              onClick={() => {
                toast('Could not undo', { tone: 'failure', description: 'Gmail answered 503.' });
                toast('Mail from deals@example.com: archive it', { kind: 'Rule added' });
                answer();
              }}
            >
              Several at once
            </Button>
          </div>
        </Section>
        <Section title="Toast, saying what a press did" meta="the mail it was done to, then what was done and the label it gave">
          <div className="flex flex-wrap gap-2">
            {(
              [
                [
                  'Archive, labelled',
                  'Dependabot: bump lodash to 4.17.21',
                  [
                    { action: 'archive', word: 'Archived' },
                    { action: 'label', word: 'Notifications' },
                  ],
                ],
                [
                  'To the digest',
                  '3 conversations',
                  [
                    { action: 'archive', word: 'Archived' },
                    { action: 'label', word: 'Build results' },
                    { action: 'digest', word: 'In the digest' },
                  ],
                ],
                [
                  'Answered, kept',
                  'Your electricity bill for November',
                  [
                    { action: 'keep', word: 'Kept' },
                    { action: 'label', word: 'Receipts' },
                  ],
                ],
                [
                  'Block',
                  '48 hours only: 30% off',
                  [
                    { action: 'block', word: 'Blocked deals@shop.example.com' },
                    { action: 'label', word: 'Cold outreach' },
                  ],
                ],
                ['No label', 'Lunch on Thursday?', [{ action: 'archive', word: 'Archived' }]],
              ] as const
            ).map(([press, subject, did]) => (
              <Button key={press} onClick={() => toast(subject, { did, undo: () => toast('Back in the inbox') })}>
                {press}
              </Button>
            ))}
            <Button
              onClick={() =>
                toast('Disk 91% full on db-2', {
                  did: [
                    { action: 'archive', word: 'Archived' },
                    { action: 'label', word: 'Notifications' },
                  ],
                  action: { label: 'Same for 2 more', onPress: () => toast('2 messages', { did: [{ action: 'archive', word: 'Archived' }] }) },
                  undo: () => toast('Back in the inbox'),
                })
              }
            >
              With more alike
            </Button>
          </div>
        </Section>
        <Section title="Menu, popover, notice and hover card">
          <div className="flex flex-wrap items-center gap-6">
            <Popover label="Why">
              <p>Your answer. Mild said: a bill from a utility you pay.</p>
              <p>A card under the press on a desktop; a sheet up from the bottom on a phone.</p>
            </Popover>
            <Menu
              label="Account, ada@example.org"
              trigger={<Avatar name="ada@example.org" />}
              heading={
                <>
                  <p className="text-muted-foreground">Signed in</p>
                  <p className="mt-1 font-medium">ada@example.org</p>
                </>
              }
              items={[
                { label: 'Sign out', onSelect: () => toast('Signed out') },
                { label: 'Disabled', note: 'With the reason under it.', disabled: true, onSelect: () => {} },
              ]}
            />
            <Menu
              label="Show"
              trigger={<span className="flex h-(--control) items-center px-2 font-semibold">Views, the one showing ticked</span>}
              items={[
                ['all', 'Everything'],
                ['needs', 'Needs you'],
                ['sorted', 'Sorted'],
              ].map(([key, text]) => ({ label: text, on: key === view, onSelect: () => setView(key) }))}
            />
            <Notice>Mild cannot be reached</Notice>
            <Notice tone="look" href="/system" action="Reconnect">
              Google sign-in expired
            </Notice>
            <p>
              Mail from{' '}
              <HoverCard
                href="/system"
                className="font-medium"
                card={
                  <div className="flex flex-col gap-2">
                    <p className="flex items-center gap-2">
                      <span className="name">Example News</span>
                      <ContactHint contact="one-way" />
                    </p>
                    <Facts>
                      <Fact term="Mail">42 messages</Fact>
                    </Facts>
                  </div>
                }
              >
                news@example.com
              </HoverCard>
            </p>
            <p>
              <HoverCard
                card={
                  <div className="flex flex-col gap-3">
                    <div>
                      <TextLink href="/system" className="name block">
                        Example News
                      </TextLink>
                      <p className="text-muted-foreground">news@example.com</p>
                    </div>
                    <ul className="flex flex-col gap-1">
                      <li>42 messages since Mar 3, 2026</li>
                      <li>Mostly Newsletters</li>
                    </ul>
                  </div>
                }
              >
                Example News
              </HoverCard>
              , in a row that opens something else
            </p>
            <p>
              Synced{' '}
              <Tooltip says="Nov 13, 2026, 3:21 PM" className="text-muted-foreground">
                11 h ago
              </Tooltip>
            </p>
          </div>
        </Section>
      </div>
    </>
  );
}
