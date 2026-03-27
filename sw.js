const CACHE_NAME = 'lamed-v8';
const APP_SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/styles.css',
  '/manifest.json',
  '/favicon.ico',
  '/js/app-core.js',
  '/js/app-storefront.js',
  '/js/app-cart-checkout.js',
  '/js/app-account-cart.js',
  '/js/app-operations.js'
];

const STATIC_FILE_PATTERN = /\.(?:css|js|png|jpg|jpeg|webp|svg|gif|ico|json|woff2?|ttf)$/i;
const STATIC_DESTINATIONS = new Set(['style', 'script', 'image', 'font']);

self.addEventListener('install', (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();

    await Promise.all(
      cacheNames.map((cacheName) => {
        if (cacheName !== CACHE_NAME) {
          return caches.delete(cacheName);
        }

        return Promise.resolve();
      })
    );

    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }

    await self.clients.claim();
  })());
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isStaticAsset(request, url) {
  if (APP_SHELL.includes(url.pathname)) return true;
  if (url.pathname.startsWith('/js/')) return true;
  if (STATIC_DESTINATIONS.has(request.destination)) return true;
  return STATIC_FILE_PATTERN.test(url.pathname);
}

async function putInCache(request, response) {
  if (!response || !response.ok) return response;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, preloadResponsePromise) {
  try {
    const preloadResponse = await preloadResponsePromise;
    if (preloadResponse) {
      return putInCache(request, preloadResponse);
    }

    const networkResponse = await fetch(request);
    return putInCache(request, networkResponse);
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;
    return caches.match('/offline.html');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  const networkPromise = fetch(request)
    .then((networkResponse) => putInCache(request, networkResponse))
    .catch(() => null);

  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  return caches.match('/offline.html');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, event.preloadResponse));
    return;
  }

  if (isStaticAsset(request, url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('notificationclick', (event) => {
  const targetUrl = event.notification?.data?.link || 'https://www.lamedvs.com.br/minha-conta.html#pedidos';
  event.notification.close();

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if ('focus' in client) {
        client.navigate(targetUrl).catch(() => {});
        return client.focus();
      }
    }

    if (self.clients.openWindow) {
      return self.clients.openWindow(targetUrl);
    }

    return undefined;
  })());
});

try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

  firebase.initializeApp({
    apiKey: 'AIzaSyCzB4_YotWCPVh1yaqWkhbB4LypPQYvV4U',
    authDomain: 'site-lamed.firebaseapp.com',
    databaseURL: 'https://site-lamed-default-rtdb.firebaseio.com',
    projectId: 'site-lamed',
    storageBucket: 'site-lamed.firebasestorage.app',
    messagingSenderId: '862756160215',
    appId: '1:862756160215:web:d0fded233682bf93eaa692',
    measurementId: 'G-BL1G961PGT'
  });

  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const notification = payload?.notification || {};
    const data = payload?.data || {};
    const title = String(notification.title || data.title || 'Lamed VS').slice(0, 120);
    const body = String(notification.body || data.body || 'Voce recebeu uma nova atualizacao.').slice(0, 240);
    const link = String(payload?.fcmOptions?.link || data.link || 'https://www.lamedvs.com.br/minha-conta.html#pedidos');
    const icon = String(notification.icon || data.icon || 'https://i.ibb.co/mr93jDHT/JM.png');

    self.registration.showNotification(title, {
      body,
      icon,
      data: {
        link
      }
    });
  });
} catch (error) {
  console.warn('[sw] Messaging indisponivel neste ambiente.', error);
}
