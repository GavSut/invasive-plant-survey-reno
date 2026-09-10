const CACHE_PREFIX = "invasive-transect-app-v";
const CACHE_NAME = "invasive-transect-app-v2.1.2";
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
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

function isBackendRequest(url) {
  return url.hostname.endsWith(".supabase.co");
}

function isOnlineGuideRequest(url) {
  if (url.origin !== self.location.origin) return false;
  const file = url.pathname.split("/").pop();
  return ["guide.html", "guide.js", "guide.css", "species_code_crosswalk.csv"].includes(file)
    || url.pathname.includes("/assets/species/");
}

function isInstructorRequest(url) {
  if (url.origin !== self.location.origin) return false;
  const file = url.pathname.split("/").pop();
  return /^instructor(?:[-.][a-z0-9-]+)*\.(?:html|css|js)$/i.test(file);
}

function offlineInstructorResponse() {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Instructor dashboard requires a connection</title><body style="font:18px system-ui;max-width:42rem;margin:3rem auto;padding:1rem"><h1>Instructor dashboard requires a connection</h1><p>The dashboard is online-only. Reconnect to review, curate, or download class data.</p><p>Student field-entry drafts remain available offline.</p><p><a href="./index.html">Return to the survey app</a></p></body></html>`, {
    status: 503,
    statusText: "Offline",
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function offlineGuideResponse() {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Guide unavailable offline</title><body style="font:18px system-ui;max-width:42rem;margin:3rem auto;padding:1rem"><h1>Species guide needs a connection</h1><p>The field survey, drafts, statuses, and photos still work offline. Reconnect to open the identification guide.</p><p><a href="./index.html">Return to the survey app</a></p></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
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
  if (isInstructorRequest(url)) {
    if (request.mode === "navigate") event.respondWith(fetch(request, { cache: "no-store" }).catch(offlineInstructorResponse));
    else event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }
  if (isOnlineGuideRequest(url)) {
    if (request.mode === "navigate") event.respondWith(fetch(request).catch(offlineGuideResponse));
    return;
  }
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
