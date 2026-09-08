const CACHE_NAME = "invasive-transect-app-v1.0.1";
const CORE_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./protocol.js",
  "./storage.js",
  "./backend.js",
  "./config.js",
  "./species.js",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isBackendRequest(url) {
  return url.hostname.endsWith(".supabase.co");
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && request.method === "GET") {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isBackendRequest(url)) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request).catch(() => caches.match("./index.html")));
    return;
  }
  if (url.origin === self.location.origin && ["config.js", "species.js"].includes(url.pathname.split("/").pop())) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.origin === self.location.origin) event.respondWith(cacheFirst(request));
});
