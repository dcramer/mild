import { beforeEach, describe, expect, it } from 'vitest';
import type { Controls } from '../src/dashboard/controls.ts';
import { cleanHtml, mailDocument } from '../src/dashboard/mail-html.ts';
import { findHtml } from '../src/gmail/body.ts';
import { recordSync } from '../src/store/accounts.ts';
import { recordFacts } from '../src/store/messages.ts';
import { deriveFacts } from '../src/triage/facts.ts';
import { people } from '../src/store/people.ts';
import type { Sql } from '../src/store/sql.ts';
import type { Store } from '../src/store/store.ts';
import { onePerson, startDashboard, superuser } from './fixtures.ts';
import { facts } from './helpers.ts';

const ACCOUNT = 'me@example.org';
const MARKER = 'only-in-the-html-7f3a';
const HTML = `<!DOCTYPE html><html><head><title>Sale</title><meta http-equiv="refresh" content="0;url=https://tracker.example.com/"><base href="https://tracker.example.com/"></head>
<body style="margin:0"><table bgcolor="#ffffff"><tr><td style="color:#333;background:url(https://cdn.example.com/bg.png)">
<p>${MARKER}</p><img src="https://cdn.example.com/hero.png" width="600" alt="Hero"><img src="data:image/png;base64,iVBORw0KGgo=" alt="Logo">
<a href="https://shop.example.com/sale">Shop</a></td></tr></table><script>fetch('https://tracker.example.com/')</script></body></html>`;

describe('cleaning a message for the frame', () => {
  it('removes scripts, frames, forms, base and meta, keeping what is inside a form', () => {
    const cleaned = cleanHtml(
      '<script>alert(1)</script><SCRIPT src="https://x.example.com/a.js"></SCRIPT><iframe src="https://x.example.com/"></iframe><object data="https://x.example.com/"></object><embed src="https://x.example.com/">' +
        '<form action="https://x.example.com/"><input name="q" formaction="https://x.example.com/"></form><base href="https://x.example.com/"><meta http-equiv="refresh" content="0;url=https://x.example.com/"><link rel="stylesheet" href="https://x.example.com/a.css">',
    );
    expect(cleaned).toBe('<input name="q">');
  });

  it('removes event handlers and javascript: addresses, however they are spelled', () => {
    expect(cleanHtml('<img src=x onerror="alert(1)" ONLOAD=alert(2) alt="a">')).toBe('<img alt="a">');
    for (const href of [
      'javascript:alert(1)',
      ' JaVaScRiPt:alert(1)',
      'jav&#x61;script:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '/relative',
      '#top',
    ])
      expect(cleanHtml(`<a href="${href}">x</a>`), href).toBe('<a>x</a>');
    expect(cleanHtml('<div style="x" onclick=alert(1)>y</div>')).toBe('<div style="x">y</div>');
  });

  it('opens every link in a new tab that is told nothing of where it came from', () => {
    expect(cleanHtml('<a href="https://example.com/a" target="_self" rel="opener">a</a>')).toBe(
      '<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">a</a>',
    );
    expect(cleanHtml("<a href='mailto:me@example.com'>m</a>")).toBe('<a href="mailto:me@example.com" target="_blank" rel="noopener noreferrer">m</a>');
  });

  it('drops remote images and keeps inline ones; CSS is left to the frame policy', () => {
    expect(cleanHtml('<img src="https://cdn.example.com/a.png" srcset="https://cdn.example.com/b.png 2x" alt="A">')).toBe('<img alt="A">');
    expect(cleanHtml('<td background="https://cdn.example.com/bg.png">x</td>')).toBe('<td>x</td>');
    expect(cleanHtml('<img src="cid:logo">')).toBe('<img>');
    expect(cleanHtml('<img src="data:image/png;base64,AAAA">')).toBe('<img src="data:image/png;base64,AAAA">');
    expect(cleanHtml('<style>p{color:red}</style>')).toBe('<style>p{color:red}</style>');
  });

  it('writes out only the tags it read, so a malformed one cannot slip past', () => {
    expect(cleanHtml('<scr<script>alert(1)</script>ipt>alert(2)</script>')).toBe('alert(1)ipt>alert(2)');
    expect(cleanHtml('<img src="x" alt="never closed')).toBe('&lt;img src="x" alt="never closed');
    expect(cleanHtml('<svg><style><img src=x onerror=alert(1)></style></svg>after')).toBe('after');
    expect(cleanHtml('<p title="a>b" class=c>x</p>')).toBe('<p title="a>b" class="c">x</p>');
    expect(cleanHtml('<!-- <script>alert(1)</script> -->kept')).toBe('kept');
    // A tag that never ends is read once, not retried from every position.
    const long = `<a ${'b'.repeat(50_000)}`;
    const started = performance.now();
    expect(cleanHtml(long)).toBe(long.replace('<', '&lt;'));
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('puts the message on white paper, after its doctype', () => {
    const document = mailDocument(HTML);
    expect(document.startsWith('<!DOCTYPE html><style>:root{color-scheme:light;background:#fff;color:#000}</style><html>')).toBe(true);
    expect(document).not.toMatch(/script|refresh|<base|<title|hero\.png|https:\/\/tracker/);
    expect(document).toContain('background:url(https://cdn.example.com/bg.png)');
  });

  it("picks a message's HTML part out of its parts", () => {
    const b64 = (text: string) => Buffer.from(text).toString('base64url');
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64('plain') } },
        { mimeType: 'text/html', body: { data: b64('<p>café</p>') } },
      ],
    };
    expect(findHtml(payload)).toBe('<p>café</p>');
    expect(findHtml({ mimeType: 'text/plain', body: { data: b64('plain') } })).toBeNull();
  });
});

describe('the frame route', () => {
  let store: Store;
  let db: Sql;
  let asked: string[];
  const controls = {
    messageHtml: async (_db: Sql, account: string, id: string) => (asked.push(`${account} ${id}`), id === 'plain' ? null : HTML),
  } as unknown as Controls;

  beforeEach(async () => {
    ({ store, db } = await onePerson(ACCOUNT));
    asked = [];
    await recordSync(
      db,
      ACCOUNT,
      ['m1', 'plain'].map((messageId) => facts({ accountId: ACCOUNT, messageId })),
      '2',
      1000,
    );
  });

  it('sends the message under a strict policy of its own, in a sandbox, loading nothing', async () => {
    const { call } = await startDashboard(people(store), { controls });
    const reply = await call('GET', `/api/message/html?account=${encodeURIComponent(ACCOUNT)}&id=m1`);
    expect(reply.status).toBe(200);
    expect(reply.text).toContain(MARKER);
    expect(reply.text).not.toContain('<script');
    expect(reply.headers).toMatchObject({
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    const policy = String(reply.headers['content-security-policy']);
    expect(policy).not.toMatch(/allow-scripts|allow-same-origin|script-src|connect-src|https?:/);
  });

  it('says so, in the frame, when there is no HTML or no such message', async () => {
    const { call } = await startDashboard(people(store), { controls });
    const plain = await call('GET', `/api/message/html?account=${encodeURIComponent(ACCOUNT)}&id=plain`);
    expect(plain.status).toBe(404);
    expect(plain.text).toContain('This message has no HTML');
    expect(plain.headers['content-security-policy']).toContain('sandbox');
    // Not one sift has recorded: Gmail is not asked.
    expect((await call('GET', `/api/message/html?account=${encodeURIComponent(ACCOUNT)}&id=unknown`)).status).toBe(404);
    expect((await call('GET', '/api/message/html?account=other%40example.com&id=m1')).status).toBe(404);
    expect(asked).toEqual([`${ACCOUNT} plain`]);
  });

  it('stores nothing of what it fetched', async () => {
    const { call } = await startDashboard(people(store), { controls });
    const pg = await superuser();
    const { rows: tables } = await pg.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`,
    );
    const everything = async () =>
      (await Promise.all(tables.map(async ({ name }) => (await pg.query(`SELECT t::text AS row FROM "${name}" t`)).rows))).flat().map((r) => JSON.stringify(r));
    const before = await everything();
    expect((await call('GET', `/api/message/html?account=${encodeURIComponent(ACCOUNT)}&id=m1`)).status).toBe(200);
    const after = await everything();
    expect(after).toEqual(before);
    expect(after.join('\n')).not.toContain(MARKER);
  });

  it('tells the page whether a message has HTML, once sift has read it', async () => {
    const { call } = await startDashboard(people(store), { controls });
    const hasHtml = async (id: string) => (await call('GET', `/api/message?account=${encodeURIComponent(ACCOUNT)}&id=${id}`)).body['hasHtml'];
    expect(await hasHtml('m1')).toBeNull();
    const base = facts({ accountId: ACCOUNT, messageId: 'm1' });
    await recordFacts(db, ACCOUNT, 'm1', { ...deriveFacts(base, { hasAttachments: false }) });
    expect(await hasHtml('m1')).toBe(false);
    await recordFacts(db, ACCOUNT, 'm1', {
      ...deriveFacts(base, { hasAttachments: false, trackingPixel: false, linkHosts: 1, trackedLinks: false, linksOffDomain: false }),
    });
    expect(await hasHtml('m1')).toBe(true);
  });
});
