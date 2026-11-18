import { OAuth2Client } from 'google-auth-library';
import { describe, expect, it } from 'vitest';
import { createGmailMailbox } from '../src/gmail/mailbox.ts';

type Label = { id: string; name: string };

/** A mailbox whose Gmail answers the labels endpoints as Gmail does, comparing names without case. Nothing leaves the machine. */
function withLabels(start: Label[]) {
  const labels = [...start];
  const requests: string[] = [];
  const auth = new OAuth2Client();
  auth.request = (async (options: { method?: string; data?: { name: string } }) => {
    const method = options.method ?? 'GET';
    requests.push(method);
    if (method === 'GET') return { status: 200, data: { labels }, headers: {} };
    const name = options.data!.name;
    if (labels.some((l) => l.name.toLowerCase() === name.toLowerCase())) throw Object.assign(new Error('Label name exists or conflicts'), { status: 409 });
    const label = { id: `Label_${labels.length + 1}`, name };
    labels.push(label);
    return { status: 200, data: label, headers: {} };
  }) as OAuth2Client['request'];
  return { box: createGmailMailbox(auth, async () => {}), labels, requests };
}

describe('ensureLabel', () => {
  it('uses a label whose case was changed in Gmail instead of making it again', async () => {
    const gmail = withLabels([{ id: 'Label_1', name: 'Sift/News' }]);
    expect(await gmail.box.ensureLabel('sift/news')).toBe('Label_1');
    expect(gmail.requests).toEqual(['GET']);
  });

  it('uses a label made since it read the list', async () => {
    const gmail = withLabels([]);
    expect(await gmail.box.ensureLabel('sift/other')).toBe('Label_1');
    gmail.labels.push({ id: 'Label_9', name: 'sift/did/archived' });
    expect(await gmail.box.ensureLabel('sift/did/archived')).toBe('Label_9');
    expect(gmail.requests).toEqual(['GET', 'POST', 'POST', 'GET']);
  });
});
