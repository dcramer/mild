import { describe, expect, it, vi } from 'vitest';
import { chatgptPending, checkChatGPT, finishChatGPT, forgetChatGPT, startChatGPT } from '../src/app/chatgpt.ts';
import { memoryEphemeral } from '../src/ephemeral/ephemeral.ts';
import { memorySignIns } from './helpers.ts';

const DEVICE = '00000000-0000-4000-8000-000000000001';
const access = `x.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1' } })).toString('base64url')}.y`;

describe('a ChatGPT sign-in between requests', () => {
  it('is kept in the ephemeral store, and asked about once per interval by whichever request comes next', async () => {
    let entered = false;
    vi.stubGlobal('fetch', async (input: string) => {
      if (input.endsWith('/deviceauth/usercode')) return Response.json({ device_auth_id: 'da', user_code: 'ABCD-1234', interval: 5 });
      if (input.endsWith('/deviceauth/token'))
        return entered ? Response.json({ authorization_code: 'ac', code_verifier: 'cv' }) : new Response('', { status: 403 });
      return Response.json({ access_token: access, refresh_token: 'r', expires_in: 3600 });
    });
    const ephemeral = memoryEphemeral();
    const signIns = memorySignIns();
    const asked = () => polls;
    let polls = 0;
    const counting = fetch;
    vi.stubGlobal('fetch', async (input: string) => (input.endsWith('/deviceauth/token') && polls++, counting(input)));
    expect(await startChatGPT(ephemeral, 1, 'device-code', DEVICE)).toMatchObject({ code: 'ABCD-1234' });
    expect(await chatgptPending(ephemeral, 1)).toMatchObject({ code: 'ABCD-1234' });
    expect(await chatgptPending(ephemeral, 2)).toBeNull();

    // Not before OpenAI's interval, then once per interval.
    const start = Date.now();
    expect(await checkChatGPT(ephemeral, 1, signIns, start)).toBeNull();
    expect(asked()).toBe(0);
    expect(await checkChatGPT(ephemeral, 1, signIns, start + 6000)).toBeNull();
    expect(await checkChatGPT(ephemeral, 1, signIns, start + 7000)).toBeNull();
    expect(asked()).toBe(1);
    entered = true;
    expect(await checkChatGPT(ephemeral, 1, signIns, start + 12_000)).toBe('done');
    expect(signIns.stored.has('openai-codex')).toBe(true);
    expect(await chatgptPending(ephemeral, 1)).toBeNull();
    expect(await checkChatGPT(ephemeral, 1, signIns, start + 20_000)).toBeNull();
  });

  it('shows why it failed, and an expired one as expired', async () => {
    vi.stubGlobal('fetch', async (input: string) =>
      input.endsWith('/usercode') ? Response.json({ device_auth_id: 'da', user_code: 'C', interval: 5 }) : new Response('{}', { status: 500 }),
    );
    const ephemeral = memoryEphemeral();
    await startChatGPT(ephemeral, 1, 'device-code', DEVICE);
    expect(await chatgptPending(ephemeral, 1, Date.now() + 16 * 60_000)).toEqual({ error: 'That code expired. Start again.' });
    expect(await checkChatGPT(ephemeral, 1, memorySignIns(), Date.now() + 6000)).toBeNull();
    expect(await chatgptPending(ephemeral, 1)).toEqual({ error: 'OpenAI refused the sign-in (500). Start again.' });
    await forgetChatGPT(ephemeral, 1);
    expect(await chatgptPending(ephemeral, 1)).toBeNull();
  });

  it('finishes a Sign in with ChatGPT started in another request', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'openid resource.invoke chatgpt.tokens.use.direct' }),
    );
    const ephemeral = memoryEphemeral();
    const signIns = memorySignIns();
    await expect(finishChatGPT(ephemeral, 1, signIns, 'http://127.0.0.1:1455/auth/callback?code=c')).rejects.toThrow('No ChatGPT sign-in is waiting');
    const shown = await startChatGPT(ephemeral, 1, 'redirect', DEVICE);
    const state = new URL(shown.url).searchParams.get('state');
    await finishChatGPT(ephemeral, 1, signIns, `http://127.0.0.1:1455/auth/callback?code=c&state=${state}&client_id=oaiapp_x`);
    expect(signIns.stored.has('chatgpt')).toBe(true);
    expect(await chatgptPending(ephemeral, 1)).toBeNull();
  });
});
