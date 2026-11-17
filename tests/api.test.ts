import { beforeEach, describe, expect, it } from 'vitest';
import type { Controls } from '../src/dashboard/controls.ts';
import { people } from '../src/store/people.ts';
import type { Store } from '../src/store/store.ts';
import { onePerson, startDashboard } from './fixtures.ts';
import { ACCOUNT } from './helpers.ts';

let store: Store;

beforeEach(async () => {
  ({ store } = await onePerson(ACCOUNT));
});

/** Controls whose `models` and ChatGPT sign-in answer with whatever a test gives them. */
const answering = (models: unknown, signIn: unknown = { code: 'C', url: 'https://auth.example/device', expiresAt: 1 }) =>
  ({
    models: async () => models,
    signInChatGPT: async () => signIn,
    checkNow: async () => {},
  }) as unknown as Controls;

describe('what the API accepts and sends', () => {
  it('refuses a body with a field the route does not name', async () => {
    const { call } = await startDashboard(people(store));
    const { status, body } = await call('POST', '/api/model', { model: 'p/small', also: 1 });
    expect(status).toBe(400);
    expect(body['error']).toContain('also');
  });

  it('names the field it refused, never what was in it', async () => {
    const { call } = await startDashboard(people(store));
    const { status, body } = await call('POST', '/api/standing/clear', { accountId: ACCOUNT, address: 'private words' });
    expect(status).toBe(400);
    expect(body['error']).toMatch(/^address: /);
    expect(body['error']).not.toContain('private words');
  });

  it('refuses a period the page does not offer, and ignores parameters no route names', async () => {
    const { call } = await startDashboard(people(store));
    expect(await call('GET', '/api/summary?days=5')).toMatchObject({ status: 400, body: { error: 'days: must be 1, 7, 30 or 90' } });
    expect((await call('GET', '/api/summary?days=30&whatever=1')).body).toMatchObject({ days: 30 });
  });

  it('sends only the fields a reply names', async () => {
    const { call } = await startDashboard(people(store), { controls: answering({ models: ['p/small'], shortlist: {}, costs: {}, token: 'sk-secret' }) });
    const { status, body, text } = await call('GET', '/api/models');
    expect(status).toBe(200);
    expect(body).toEqual({ models: ['p/small'], shortlist: {}, costs: {} });
    expect(text).not.toContain('sk-secret');
  });

  it('sends nothing of a reply that does not match what the route promised', async () => {
    const { call } = await startDashboard(people(store), {
      controls: answering({ models: 'p/small', shortlist: {}, costs: {} }, { code: 'all of them', url: 'not an address', expiresAt: 'soon' }),
    });
    const read = await call('GET', '/api/models');
    expect(read.status).toBe(500);
    expect(read.body['error']).toContain('models');
    expect(read.text).not.toContain('p/small');
    const written = await call('POST', '/api/model/chatgpt', {});
    expect(written.status).toBe(500);
    expect(written.text).not.toContain('all of them');
  });
});
