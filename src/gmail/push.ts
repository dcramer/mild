import { OAuth2Client } from 'google-auth-library';

/** The account Pub/Sub signs each push as: `sift-push` in the topic's project, as docs/hosted.md makes it. */
const pushAccount = (topic: string) => `sift-push@${topic.split('/')[1]}.iam.gserviceaccount.com`;

/**
 * The mailbox a push from Gmail names, once Google has signed it as `pushAccount` for this address; null for any other
 * request. It says only that something changed: what did is history's.
 */
export async function pushedMailbox(request: Request, topic: string): Promise<string | null> {
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return null;
  const url = new URL(request.url);
  try {
    // Pub/Sub's audience is the address it pushes to, unless the subscription names another.
    const claims = (await new OAuth2Client().verifyIdToken({ idToken: token, audience: `${url.origin}${url.pathname}` })).getPayload();
    if (claims?.email !== pushAccount(topic) || claims.email_verified !== true) return null;
    const { message } = (await request.json()) as { message?: { data?: unknown } };
    if (typeof message?.data !== 'string') return null;
    const { emailAddress } = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8')) as { emailAddress?: unknown };
    return typeof emailAddress === 'string' ? emailAddress.toLowerCase() : null;
  } catch {
    return null;
  }
}
