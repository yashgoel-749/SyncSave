// SyncSpace Service Worker - Safe Caching Strategy for PWA and Offline Support
const CACHE_NAME = 'syncspace-static-v2';
const OFFLINE_URL = '/offline.html';

// Critical static assets to cache on installation
const PRECACHE_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/file.svg',
  '/globe.svg',
  '/window.svg',
  OFFLINE_URL,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(PRECACHE_ASSETS).catch((err) => {
          // Non-fatal if server is running without certain assets
          console.warn('[SW] Pre-caching warning:', err);
        });
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        return Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Only intercept GET requests
  if (req.method !== 'GET') {
    return;
  }

  // 2. Ignore non-http(s) schemes (e.g. chrome-extension, ws/wss)
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // 3. STRICT BYPASS: Never intercept or cache API, Auth, or dynamic data endpoints
  // This prevents accidentally caching private document data or authentication tokens
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.includes('/collab-token') ||
    url.pathname.includes('/next-auth')
  ) {
    return;
  }

  // 4. Cache-First for versioned immutable static assets (_next/static, public static icons/fonts)
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.webmanifest')
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((networkRes) => {
          if (networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return networkRes;
        });
      })
    );
    return;
  }

  // 5. Network-First with offline fallback for HTML navigation requests
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          // If successful navigation, cache the response for offline reload
          if (networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return networkRes;
        })
        .catch(async () => {
          // Check if requested page is in cache
          const cached = await caches.match(req);
          if (cached) return cached;

          // Otherwise return the offline page fallback
          const offlineFallback = await caches.match(OFFLINE_URL);
          if (offlineFallback) return offlineFallback;

          return new Response(
            '<!DOCTYPE html><html><head><title>Offline - SyncSpace</title><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="background:#090d16;color:#e2e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;padding:24px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;background:#0d121f;max-width:400px;"><h2 style="color:#60a5fa;margin-top:0;">You are Offline</h2><p style="color:#94a3b8;font-size:14px;">SyncSpace is running in offline mode. Your local document edits are preserved in IndexedDB and will sync once reconnected.</p><button onclick="window.location.reload()" style="background:#3b82f6;color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600;">Retry Connection</button></div></body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }
});
