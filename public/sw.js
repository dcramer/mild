// The service worker: keeps the page and its files so the installed app opens when Sift cannot be reached,
// and then says so. It never keeps anything under /api/ or /auth/: that is private mail data and sign-in.

const CACHE = 'sift-shell';
/** The one page, as last fetched: every address is it. */
const PAGE = '/';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || /^\/(api|auth)\//.test(url.pathname)) return;

  // The server's copy when it answers, since it may be newer; kept, with its policy and the nonce it names.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) void caches.open(CACHE).then((cache) => cache.put(PAGE, response.clone()));
          return response;
        })
        .catch(async () => (await caches.match(PAGE, { cacheName: CACHE })) ?? Response.error()),
    );
    return;
  }

  // Built files are named by their content, so a kept one is never out of date.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const kept = await cache.match(request);
        if (kept) return kept;
        const response = await fetch(request);
        if (response.ok) void cache.put(request, response.clone());
        return response;
      }),
    );
  }
});
