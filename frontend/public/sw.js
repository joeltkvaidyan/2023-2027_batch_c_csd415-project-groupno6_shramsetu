const CACHE_NAME = "shramsetu-v2";
const APP_SHELL = ["/", "/index.html", "/icon.svg", "/manifest.webmanifest"];

// Install — cache the app shell for offline startup
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

// Activate — purge every older cache immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

// Fetch — NETWORK-FIRST everywhere.
// The old v1 worker used stale-while-revalidate, which kept serving
// stale Vite dev modules (e.g. the old VoiceRecorder) from cache even
// after fixes. Network-first means the phone always gets the latest
// code when online, and only falls back to cache when offline.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never cache Vite HMR / dev websocket-ish or auth-sensitive paths.
  // API calls must always hit the network; fall back to a 503 when offline.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(JSON.stringify({ error: "Offline" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache successful, same-origin GET responses
        if (response && response.ok && url.origin === location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.mode === "navigate") {
            return caches.match("/index.html");
          }
          return new Response("", { status: 504, statusText: "Offline" });
        }),
      ),
  );
});
