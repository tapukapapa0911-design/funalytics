const CACHE_NAME = "funalytics-live-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./src/styles.css",
  "./src/app.js",
  "./src/bootstrap.js",
  "./src/workbook-import.js",
  "./assets/vendor/jszip.min.js",
  "./constants/schema.js",
  "./utils/cache.js",
  "./utils/validation.js",
  "./services/calculations.js",
  "./services/apiClients.js",
  "./services/matcher.js",
  "./services/dataMapper.js",
  "./services/navResolver.js",
  "./services/dataProvider.js",
  "./mockData/excel-backup.js",
  "./mockData/excel-backup.json",
  "./manifest.json?v=live-1",
  "./manifest.webmanifest",
  "./icons/light-logo.png",
  "./icons/dark-logo.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting(); // 🔥 force update
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  if (!isSameOrigin) return;

  const isNavigation = request.mode === "navigate" || request.destination === "document";

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", clone));
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
