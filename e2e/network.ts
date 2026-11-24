import type { Page, Route } from '@playwright/test';

/** Counts the requests the page sends to `path` from now: `requestsTo(page, '/api/feedback')`, the answers it sends. */
export function requestsTo(page: Page, path: string) {
  let sent = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === path) sent++;
  });
  return () => sent;
}

/**
 * The server's reply to an intercepted request. Sent again once if the connection was reset: Playwright reuses a connection
 * the server may be closing as the request goes out, after it sat idle the server's 5 s, which a browser also sends again.
 */
export const forward = (route: Route) => route.fetch({ maxRetries: 1 });

/** Answers requests to `url` with the server's own reply, its JSON as `change` makes it. */
export const patchJson = (page: Page, url: string, change: (json: any) => object) =>
  page.route(url, async (route) => {
    const response = await forward(route);
    await route.fulfill({ response, json: change(await response.json()) });
  });

/**
 * With the `chatgpt` variant, whose model is through a ChatGPT plan: what the provider lists, which no harness can sign
 * in to ask. Their model is `gpt-5.6-luna`, at $0.40 per 1,000.
 */
export async function throughChatGPT(page: Page) {
  const model = 'openai-codex/gpt-5.6-luna';
  await patchJson(page, '**/api/models*', (models) => ({ ...models, models: [model], shortlist: { 'openai-codex': [model] }, costs: { [model]: 0.4 } }));
}

/** The mailbox each read of `path` asked for, null for all of them, in the order asked. */
export function mailboxesAsked(page: Page, path: string) {
  const asked: (string | null)[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === path) asked.push(url.searchParams.get('mailbox'));
  });
  return asked;
}
