// The service worker: keeps the page and its files so the installed app opens when Sift cannot be reached,
// and then says so. It never keeps anything under /api/ or /auth/: that is private mail data and sign-in.

const CACHE = 'sift-shell';
/** Each screen's page is the same for everyone; a sender's and a domain's is one page for all of them. */
const pageOf = (url) => url.pathname.replace(/^\/(sender|domain)\/.*/, '/$1');

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

  // The server's copy when it answers, since it may be newer; without it, the one kept for that screen, or else For review.
  if (request.mode === 'navigate') {
    const page = pageOf(url);
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) void caches.open(CACHE).then((cache) => cache.put(page, response.clone()));
          return response;
        })
        .catch(async () => (await caches.match(page, { cacheName: CACHE })) ?? (await caches.match('/', { cacheName: CACHE })) ?? Response.error()),
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
