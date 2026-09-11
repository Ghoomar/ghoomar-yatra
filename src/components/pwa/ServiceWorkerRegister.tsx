'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        // Pre-warm the cache for /operations/gate if online
        if (navigator.onLine && window.caches) {
          window.caches.open('ghoomar-gate-v1').then((cache) => {
            fetch('/operations/gate', { credentials: 'same-origin' })
              .then((res) => {
                if (res.status === 200) {
                  cache.put('/operations/gate', res);
                }
              })
              .catch(() => {});
          });
        }
      })
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
  }, []);

  return null;
}
