// Ghoomar Yatra - Dedicated Offline Gate Counter Service Worker
const CACHE_NAME = 'ghoomar-gate-v1';

const PRECACHE_URLS = [
  '/operations/gate',
  '/manifest-gate.webmanifest',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/favicon-32x32.png',
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Precache the essential shell URLs
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('Precache partial failure (non-critical):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore non-GET requests
  if (request.method !== 'GET') return;

  // 1. Next.js Static Chunks (/_next/static/*) -> Cache First
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 2. Navigation Requests (mode: 'navigate')
  if (request.mode === 'navigate') {
    // Gate Counter route -> Network First, fallback to cached /operations/gate shell
    if (url.pathname === '/operations/gate' || url.pathname.startsWith('/operations/gate/')) {
      event.respondWith(
        fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put('/operations/gate', clone));
            }
            return networkResponse;
          })
          .catch(() => {
            return caches.match('/operations/gate').then((cached) => {
              if (cached) return cached;
              return new Response(
                '<!DOCTYPE html><html><body><h1>Gate Counter Offline</h1><p>Please open while online once to prime cache.</p></body></html>',
                { headers: { 'Content-Type': 'text/html' } }
              );
            });
          })
      );
      return;
    }

    // Root URL navigation -> Try network, fallback to cached gate shell if offline
    if (url.pathname === '/') {
      event.respondWith(
        fetch(request).catch(() => {
          return caches.match('/operations/gate').then((cached) => {
            if (cached) return cached;
            return caches.match('/');
          });
        })
      );
      return;
    }

    // All other administrative routes -> Normal network only (do not make admin offline)
    return;
  }

  // 3. Static icons & images
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/favicon') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.webmanifest')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Supabase API and other dynamic calls pass directly to network
});
