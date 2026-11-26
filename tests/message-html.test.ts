import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FRAME_SCRIPT, INK } from '../src/dashboard/frame-script.ts';
import { cleanHtml, isLetter, mailDocument } from '../src/dashboard/mail-html.ts';
import { FRAME_POLICY, IMAGES_FRAME_POLICY } from '../src/dashboard/policy.ts';
import { readContent } from '../src/gmail/body.ts';
import { recordSync } from '../src/store/messages.ts';
import { readBodies } from '../src/store/query.ts';
import { people } from '../src/store/people.ts';
import type { Sql } from '../src/store/sql.ts';
import type { Store } from '../src/store/store.ts';
import { onePerson, startDashboard } from './fixtures.ts';
import { ACCOUNT, b64, facts } from './helpers.ts';

const MARKER = 'only-in-the-html-7f3a';
const HTML = `<!DOCTYPE html><html><head><title>Sale</title><meta http-equiv="refresh" content="0;url=https://tracker.example.com/"><base href="https://tracker.example.com/"></head>
<body style="margin:0"><table bgcolor="#ffffff"><tr><td style="color:#333;background:url(https://cdn.example.com/bg.png)">
<p>${MARKER}</p><img src="https://cdn.example.com/hero.png" width="600" alt="Hero"><img src="data:image/png;base64,iVBORw0KGgo=" alt="Logo">
<a href="https://shop.example.com/sale">Shop</a></td></tr></table><script>fetch('https://tracker.example.com/')</script></body></html>`;

/** As the frame is sent until the reader presses Show images. */
const clean = (html: string) => cleanHtml(html, false);

describe('cleaning a message for the frame', () => {
  it('removes scripts, frames, forms, base and meta, keeping what is inside a form', () => {
    const cleaned = clean(
      '<script>alert(1)</script><SCRIPT src="https://x.example.com/a.js"></SCRIPT><iframe src="https://x.example.com/"></iframe><object data="https://x.example.com/"></object><embed src="https://x.example.com/">' +
        '<form action="https://x.example.com/"><input name="q" formaction="https://x.example.com/"></form><base href="https://x.example.com/"><meta http-equiv="refresh" content="0;url=https://x.example.com/"><link rel="stylesheet" href="https://x.example.com/a.css">',
    );
    expect(cleaned).toBe('<input name="q">');
  });

  it('removes event handlers and javascript: addresses, however they are spelled', () => {
    expect(clean('<img src=x onerror="alert(1)" ONLOAD=alert(2) alt="a">')).toBe('<img alt="a">');
    for (const href of [
      'javascript:alert(1)',
      ' JaVaScRiPt:alert(1)',
      'jav&#x61;script:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '/relative',
      '#top',
    ])
      expect(clean(`<a href="${href}">x</a>`), href).toBe('<a>x</a>');
    expect(clean('<div style="x" onclick=alert(1)>y</div>')).toBe('<div style="x">y</div>');
  });

  it('opens every link in a new tab that is told nothing of where it came from', () => {
    expect(clean('<a href="https://example.com/a" target="_self" rel="opener">a</a>')).toBe(
      '<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">a</a>',
    );
    expect(clean("<a href='mailto:me@example.com'>m</a>")).toBe('<a href="mailto:me@example.com" target="_blank" rel="noopener noreferrer">m</a>');
  });

  it('drops remote images, marking where they were, and keeps inline ones; CSS is left to the frame policy', () => {
    expect(clean('<img src="https://cdn.example.com/a.png" srcset="https://cdn.example.com/b.png 2x" alt="A">')).toBe('<img alt="A" data-sift-remote>');
    expect(clean('<td background="http://cdn.example.com/bg.png">x</td>')).toBe('<td data-sift-remote>x</td>');
    // Mild keeps no picture sent inside the message, so Show images would bring nothing.
    expect(clean('<img src="cid:logo">')).toBe('<img>');
    expect(clean('<img src="data:image/png;base64,AAAA">')).toBe('<img src="data:image/png;base64,AAAA">');
    expect(clean('<style>p{color:red}</style>')).toBe('<style>p{color:red}</style>');
  });

  it('keeps images over HTTPS once the reader asks for them, and never plain HTTP ones', () => {
    expect(cleanHtml('<img src="https://cdn.example.com/a.png" srcset="https://cdn.example.com/b.png 2x" alt="A">', true)).toBe(
      '<img src="https://cdn.example.com/a.png" srcset="https://cdn.example.com/b.png 2x" alt="A">',
    );
    expect(cleanHtml('<td background="https://cdn.example.com/bg.png">x</td>', true)).toBe('<td background="https://cdn.example.com/bg.png">x</td>');
    expect(cleanHtml('<img src="http://cdn.example.com/a.png" alt="A">', true)).toBe('<img alt="A">');
    expect(cleanHtml('<img src="javascript:alert(1)" onerror="alert(2)">', true)).toBe('<img>');
  });

  it('reads mail as written for light, whatever the reader’s system is set to', () => {
    expect(clean('<style>@media (prefers-color-scheme: dark){p{color:#e8eaed}}@media not (PREFERS-COLOR-SCHEME:light){a{color:#8ab4f8}}</style>')).toBe(
      '<style>@media (grid:1){p{color:#e8eaed}}@media not (grid:0){a{color:#8ab4f8}}</style>',
    );
    expect(clean('<picture><source media="(prefers-color-scheme:dark)" srcset="data:image/png;base64,AAAA"></picture>')).toBe(
      '<picture><source media="(grid:1)" srcset="data:image/png;base64,AAAA"></picture>',
    );
  });

  it('writes out only the tags it read, so a malformed one cannot slip past', () => {
    expect(clean('<scr<script>alert(1)</script>ipt>alert(2)</script>')).toBe('alert(1)ipt>alert(2)');
    expect(clean('<img src="x" alt="never closed')).toBe('&lt;img src="x" alt="never closed');
    expect(clean('<svg><style><img src=x onerror=alert(1)></style></svg>after')).toBe('after');
    expect(clean('<p title="a>b" class=c>x</p>')).toBe('<p title="a>b" class="c">x</p>');
    expect(clean('<!-- <script>alert(1)</script> -->kept')).toBe('kept');
    // A tag that never ends is read once, not retried from every position: read again from each, this many
    // characters would take minutes, so the budget leaves a loaded machine plenty of room.
    const long = `<a ${'b'.repeat(200_000)}`;
    const started = performance.now();
    expect(clean(long)).toBe(long.replace('<', '&lt;'));
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('puts designed mail on white paper, marked as paper for the frame script to darken, after its doctype, with the frame script before the message', () => {
    const document = mailDocument(HTML, false);
    expect(document).toMatch(
      /^<!DOCTYPE html><style data-sift-paper>:root\{color-scheme:light;background:#fff;color:#000;[^<]*<\/style><script>\(\(\) => \{[\s\S]*\}\)\(\);<\/script><html>/,
    );
    expect(document.replace(`<script>${FRAME_SCRIPT}</script>`, '')).not.toMatch(/script|refresh|<base|<title|hero\.png|https:\/\/tracker/);
    expect(document).toContain('background:url(https://cdn.example.com/bg.png)');
  });

  it('reads a letter in the dashboard’s ink, and a design on its paper', () => {
    const gmail =
      '<div dir="ltr">See you then.<div><br></div></div><div class="gmail_quote"><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">Lunch?</blockquote></div>';
    const outlook =
      '<html><head><style>p.MsoNormal{margin:0}</style></head><body><div class="elementToProof" style="font-family:Aptos,sans-serif;font-size:12pt;color:rgb(0,0,0);background-color:rgb(255, 255, 255)">Works for me.</div><div id="appendonsend"></div><hr style="display:inline-block;width:98%"></body></html>';
    for (const letter of [gmail, outlook, '<p>Hi</p><img alt="Signature">', '<table width="100%" bgcolor="#ffffff"><tr><td>Hi</td></tr></table>'])
      expect(isLetter(clean(letter)), letter).toBe(true);
    for (const design of [
      HTML,
      '<div style="background:#f4efe6">Sale</div>',
      '<table width="600"><tr><td>Sale</td></tr></table>',
      '<div style="max-width: 600px">Sale</div>',
      '<style>@media (max-width:600px){td{display:block}}</style><p>Sale</p>',
      '<td style="background-image:url(https://cdn.example.com/a.png)">Sale</td>',
    ])
      expect(isLetter(clean(design)), design).toBe(false);
    expect(mailDocument(gmail, false)).toMatch(new RegExp(`^<style>:root\\{color-scheme:dark;background:transparent;color:${INK.foreground};`));
  });

  it('draws a letter in the colours the dashboard has', () => {
    const css = readFileSync(new URL('../web/src/index.css', import.meta.url), 'utf8');
    const token = (name: string) => new RegExp(`\\s--${name}:\\s*([^;]+);`).exec(css)?.[1];
    expect({ background: token('background'), foreground: token('foreground'), muted: token('supporting'), border: token('border') }).toEqual(INK);
  });

  it("reads a message's text and its HTML part, each as it is", () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64('plain') } },
        { mimeType: 'text/html', body: { data: b64('<p>café</p>') } },
      ],
    };
    expect(readContent(payload)).toMatchObject({ text: 'plain', html: '<p>café</p>' });
    expect(readContent({ mimeType: 'text/plain', body: { data: b64('plain') } }).html).toBeNull();
  });
});

describe('the frame route', () => {
  let store: Store;
  let db: Sql;

  beforeEach(async () => {
    ({ store, db } = await onePerson(ACCOUNT));
    await recordSync(
      db,
      ACCOUNT,
      ['m1', 'plain', 'unheld'].map((messageId) => facts({ messageId })),
      '2',
      1000,
    );
    await db.insert(readBodies).values([
      { accountId: ACCOUNT, messageId: 'm1', bodyText: 'Sale', bodyHtml: HTML, fetchedAt: 1000 },
      { accountId: ACCOUNT, messageId: 'plain', bodyText: 'Plain', bodyHtml: null, fetchedAt: 1000 },
    ]);
  });

  it('sends the HTML Mild holds, cleaned, under a strict policy of its own, in a sandbox, running only its own script and loading nothing', async () => {
    const { call } = await startDashboard(people(store));
    const reply = await call('GET', `/api/message/html?id=m1`);
    expect(reply.status).toBe(200);
    expect(reply.text).toContain(MARKER);
    expect(reply.text.replace(`<script>${FRAME_SCRIPT}</script>`, '')).not.toContain('<script');
    expect(reply.headers).toMatchObject({
      'content-security-policy': `default-src 'none'; script-src 'sha256-${createHash('sha256').update(FRAME_SCRIPT).digest('base64')}'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox`,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    // Mild's own script runs, by its hash alone, in a frame with no origin of its own that reaches nowhere.
    const policy = String(reply.headers['content-security-policy']);
    expect(policy).not.toMatch(/allow-same-origin|unsafe-eval|connect-src|https?:/);
    expect(/script-src ([^;]*)/.exec(policy)?.[1]).toMatch(/^'sha256-[\w+/]+=*'$/);
  });

  it('with Show images pressed, lets its images over HTTPS load, and still nothing else', async () => {
    const { call } = await startDashboard(people(store));
    const reply = await call('GET', `/api/message/html?id=m1&images=1`);
    expect(reply.status).toBe(200);
    expect(reply.text).toContain('<img src="https://cdn.example.com/hero.png"');
    expect(reply.headers['content-security-policy']).toBe(IMAGES_FRAME_POLICY);
    expect(reply.headers['referrer-policy']).toBe('no-referrer');
    const policy = new Map(IMAGES_FRAME_POLICY.split('; ').map((d) => [d.slice(0, d.indexOf(' ')), d]));
    expect(policy.get('img-src')).toBe('img-src data: https:');
    expect(IMAGES_FRAME_POLICY.replace(policy.get('img-src')!, '')).toBe(FRAME_POLICY.replace('img-src data:', ''));
    expect((await call('GET', `/api/message/html?id=m1`)).text).not.toContain('hero.png');
  });

  it('says so, in the frame, when Mild holds no HTML for it', async () => {
    const { call } = await startDashboard(people(store));
    for (const id of ['plain', 'unheld', 'unknown']) {
      const reply = await call('GET', `/api/message/html?id=${id}`);
      expect(reply.status, id).toBe(404);
      expect(reply.headers['content-security-policy']).toContain('sandbox');
    }
    expect((await call('GET', '/api/message/html?mailbox=other%40example.com&id=m1')).status).toBe(404);
  });

  it('tells the page whether Mild holds the HTML, so it never offers a frame with nothing in it', async () => {
    const { call } = await startDashboard(people(store));
    const open = async (id: string) => (await call('GET', `/api/message?id=${id}`)).body;
    expect(await open('m1')).toMatchObject({ body: 'Sale', hasHtml: true });
    expect(await open('plain')).toMatchObject({ body: 'Plain', hasHtml: false });
    expect(await open('unheld')).toMatchObject({ body: null, hasHtml: false });
  });
});
