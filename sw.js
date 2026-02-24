// sw.js - FIX (evita quebrar imagens do Firebase Storage / ORB)
// Recomendado: cachear SOMENTE arquivos do seu domínio (same-origin).
// Não cacheie CDNs (tailwindcdn, jsdelivr, fontawesome) aqui.

const CACHE_NAME = "lamed-v4"; // aumente a versão quando mudar o SW
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.json",
  // coloque aqui apenas arquivos do seu domínio (opcional):
  // "/icons/icon-192.png",
  // "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // limpa caches antigos
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Só GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // ✅ MUITO IMPORTANTE:
  // Não interceptar requests fora do seu domínio (isso evita ORB com Storage/CDNs/APIs).
  if (url.origin !== self.location.origin) return;

  // Navegação (HTML): network-first (pra não ficar preso em versão antiga)
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
          return fresh;
        } catch (e) {
          const cached = await caches.match(req);
          return cached || caches.match("/index.html");
        }
      })()
    );
    return;
  }

  // Assets (css/js/imagens do seu domínio): cache-first
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      const res = await fetch(req);
      // só cacheia respostas OK e same-origin
      if (res && res.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
      }
      return res;
    })()
  );
});