const CACHE_NAME = "momentus-pwa-v8";
const APP_SHELL = [
  "/",
  "/login",
  "/signup",
  "/reset-password",
  "/onboarding",
  "/app",
  "/manifest.webmanifest",
  "/static/styles.css",
  "/static/app.js",
  "/static/landing.js",
  "/static/auth-pages.js",
  "/static/onboarding-config.js",
  "/static/router.js",
  "/static/state.js",
  "/static/storage.js",
  "/static/charts.js",
  "/static/calendar.js",
  "/static/assets/icon.svg",
  "/static/assets/Logo.png",
  "/static/assets/darkbg.jpg",
  "/static/assets/texture.jpeg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
    )
  );
});
