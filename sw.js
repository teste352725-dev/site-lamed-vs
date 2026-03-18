const CACHE_NAME = "lamed-v5"; // 🔥 MUDA ISSO A CADA ATUALIZAÇÃO

const URLS_TO_CACHE = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.json"
];

// INSTALAÇÃO
self.addEventListener("install", (event) => {
  self.skipWaiting(); // ativa imediatamente

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
});

// ATIVAÇÃO (AQUI LIMPA O CACHE ANTIGO 🔥)
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log("🧹 Deletando cache antigo:", cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// FETCH (ESTRATÉGIA INTELIGENTE)
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 🔥 NÃO CACHEAR FIREBASE (IMPORTANTE)
  if (req.url.includes("firestore.googleapis.com") || req.url.includes("firebase")) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((networkRes) => {
        return caches.open(CACHE_NAME).then((cache) => {
          // só cacheia GET
          if (req.method === "GET") {
            cache.put(req, networkRes.clone());
          }
          return networkRes;
        });
      });
    })
  );
});

// 🔥 FORÇA ATUALIZAÇÃO IMEDIATA
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
