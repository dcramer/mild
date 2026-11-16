// The service worker: keeps the page's own files so the installed app opens when sift cannot be
// reached, and then says so. It never keeps anything under /api/: that is private mail data.
// The build (vite.config.ts) writes this file to /sw.js with SHELL and VERSION defined above it.

/* global SHELL, VERSION */

const CACHE = `sift-shell-${VERSION}`;
/** Mail data, sign-in and the dev routes always go to the server. */
const SERVER = /^\/(api|auth|dev)\//;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

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
  if (request.method !== 'GET' || url.origin !== self.location.origin || SERVER.test(url.pathname)) return;

  // Every path that is not a file is the one page. The server's copy when it answers, since it may be newer.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match('/index.html', { cacheName: CACHE })) ?? Response.error()));
    return;
  }

  // Built files are named by their content, so a kept one is never out of date.
  if (url.pathname.startsWith('/assets/')) {
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
