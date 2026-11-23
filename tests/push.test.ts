import { describe, expect, it } from 'vitest';
import { fakeGoogle, startSift } from './fixtures.ts';
import { gmailPush, signedToken } from './google.ts';
import { ACCOUNT } from './helpers.ts';

const fake = fakeGoogle();

const TOPIC = 'projects/sift-test/topics/sift-gmail';
const AT = 'https://sift.example.com/api/gmail';
/** The account docs/hosted.md has Pub/Sub sign as, in the topic's project. */
const SIGNER = 'sift-push@sift-test.iam.gserviceaccount.com';

async function pushingSift() {
  const app = await startSift(fake.google, { env: { SIFT_GMAIL_TOPIC: TOPIC } });
  await app.settled(ACCOUNT);
  // The first pass, which watches the mailbox.
  await app.tick();
  return app;
}
const passes = (app: Awaited<ReturnType<typeof pushingSift>>) => app.queued.filter((piece) => piece.kind === 'pass');

describe('a push from Gmail', () => {
  it('is taken only where a topic is set', async () => {
    const app = await startSift(fake.google);
    expect((await app.sift.push(gmailPush(AT, ACCOUNT, SIGNER))).status).toBe(404);
  });

  it('is refused unless Google signed it for this address as Sift’s own subscription', async () => {
    const app = await pushingSift();
    const forged = [
      new Request(AT, { method: 'POST', body: '{}' }),
      gmailPush(AT, ACCOUNT, 'someone@other-project.iam.gserviceaccount.com'),
      gmailPush(AT, ACCOUNT, SIGNER, signedToken('https://elsewhere.example.com/api/gmail', SIGNER)),
      gmailPush(AT, ACCOUNT, SIGNER, `${signedToken(AT, SIGNER).slice(0, -6)}AAAAAA`),
    ];
    for (const request of forged) expect((await app.sift.push(request)).status).toBe(401);
    expect(passes(app)).toEqual([]);
  });

  it('has Sift look at once at the mailbox it names, beginning its pass for mail the tick would not look for yet', async () => {
    const app = await pushingSift();
    const gmail = fake.google.mailbox(ACCOUNT);
    expect(gmail.watching).toBe(TOPIC);
    gmail.deliver({ from: 'Ada <ada@example.org>', to: ACCOUNT, text: 'Lunch?' });
    await app.sift.tick();
    expect(passes(app)).toEqual([]);
    expect((await app.sift.push(gmailPush(AT, ACCOUNT, SIGNER))).status).toBe(204);
    expect(passes(app)).toHaveLength(1);

    // Gmail pushes up to one change a second: the look just made takes them in, and the tick after looks at the rest.
    app.queued.length = 0;
    const asked = gmail.requests.length;
    expect((await app.sift.push(gmailPush(AT, ACCOUNT, SIGNER))).status).toBe(204);
    expect(gmail.requests.slice(asked).map((r) => r.method)).toEqual([]);
    expect(passes(app)).toEqual([]);
  });

  it('for a mailbox no one has is taken and dropped, so Pub/Sub does not send it again', async () => {
    const app = await pushingSift();
    expect((await app.sift.push(gmailPush(AT, 'gone@example.com', SIGNER))).status).toBe(204);
    expect(app.queued).toEqual([]);
  });
});
